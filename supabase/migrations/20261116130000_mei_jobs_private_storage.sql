-- Persistent MEI processing queue and private DAS storage.
-- This migration only adds new objects; it does not modify existing client/boleto rows.

create table if not exists public.mei_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  competencia text not null check (competencia ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'paid', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  storage_path text,
  boleto_id uuid references public.boletos(id) on delete set null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mei_jobs_user_created_idx
  on public.mei_jobs (user_id, created_at desc);
create index if not exists mei_jobs_pending_idx
  on public.mei_jobs (created_at)
  where status = 'pending';

alter table public.mei_jobs enable row level security;
grant select, insert on public.mei_jobs to authenticated;
grant all on public.mei_jobs to service_role;

drop policy if exists "Usuario visualiza seus jobs MEI" on public.mei_jobs;
create policy "Usuario visualiza seus jobs MEI"
  on public.mei_jobs for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Usuario solicita seus jobs MEI" on public.mei_jobs;
create policy "Usuario solicita seus jobs MEI"
  on public.mei_jobs for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and attempts = 0
    and exists (
      select 1 from public.clientes c
      where c.id = cliente_id and c.user_id = auth.uid()
    )
  );

-- Workers claim one pending task atomically; concurrent workers cannot claim the same row.
create or replace function public.claim_mei_job()
returns setof public.mei_jobs
language sql
security definer
set search_path = public
as $$
  with next_job as (
    select id
    from public.mei_jobs
    where status = 'pending' and attempts < max_attempts
    order by created_at
    for update skip locked
    limit 1
  )
  update public.mei_jobs j
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now(),
      error_message = null
  from next_job
  where j.id = next_job.id
  returning j.*;
$$;

revoke all on function public.claim_mei_job() from public, anon, authenticated;
grant execute on function public.claim_mei_job() to service_role;

-- Finalization creates the boleto row and completes the job in one DB transaction.
-- The CNPJ and competence extracted from the PDF are checked again against the job/client.
create or replace function public.complete_mei_job(
  p_job_id uuid,
  p_storage_path text,
  p_pdf_cnpj text,
  p_pdf_competencia text,
  p_valor numeric,
  p_vencimento date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.mei_jobs%rowtype;
  v_cliente_cnpj text;
  v_boleto_id uuid;
begin
  select * into v_job
  from public.mei_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Job MEI não encontrado';
  end if;

  if v_job.status = 'completed' and v_job.boleto_id is not null then
    return v_job.boleto_id;
  end if;

  if v_job.status <> 'processing' then
    raise exception 'Job não está em processamento';
  end if;

  if p_storage_path is null or length(p_storage_path) = 0 then
    raise exception 'Caminho do PDF não informado';
  end if;

  select regexp_replace(c.cnpj, '\\D', '', 'g')
    into v_cliente_cnpj
  from public.clientes c
  where c.id = v_job.cliente_id and c.user_id = v_job.user_id;

  if v_cliente_cnpj is null then
    raise exception 'Cliente não pertence ao usuário do job';
  end if;

  if regexp_replace(coalesce(p_pdf_cnpj, ''), '\\D', '', 'g') <> v_cliente_cnpj then
    raise exception 'CNPJ do PDF não corresponde ao cliente';
  end if;

  if p_pdf_competencia <> v_job.competencia then
    raise exception 'Competência do PDF não corresponde ao job';
  end if;

  if p_valor is null or p_valor < 0 or p_vencimento is null then
    raise exception 'Dados financeiros do DAS inválidos';
  end if;

  insert into public.boletos (
    user_id, cliente_id, competencia, valor, vencimento, arquivo_path
  ) values (
    v_job.user_id, v_job.cliente_id, v_job.competencia, p_valor, p_vencimento, p_storage_path
  )
  returning id into v_boleto_id;

  update public.mei_jobs
  set status = 'completed',
      storage_path = p_storage_path,
      boleto_id = v_boleto_id,
      completed_at = now(),
      locked_at = null,
      updated_at = now(),
      result = jsonb_build_object(
        'cnpj', v_cliente_cnpj,
        'competencia', v_job.competencia,
        'valor', p_valor,
        'vencimento', p_vencimento
      )
  where id = p_job_id;

  return v_boleto_id;
end;
$$;

revoke all on function public.complete_mei_job(uuid, text, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.complete_mei_job(uuid, text, text, text, numeric, date) to service_role;

create or replace function public.fail_mei_job(
  p_job_id uuid,
  p_error text,
  p_retry boolean default true
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update public.mei_jobs
  set status = case
        when p_retry and attempts < max_attempts then 'pending'
        else 'failed'
      end,
      error_message = left(coalesce(p_error, 'Falha não especificada'), 2000),
      locked_at = null,
      updated_at = now()
  where id = p_job_id and status = 'processing'
  returning status into v_status;

  if v_status is null then
    raise exception 'Job não encontrado ou não está em processamento';
  end if;

  return v_status;
end;
$$;

revoke all on function public.fail_mei_job(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_mei_job(uuid, text, boolean) to service_role;

-- Private bucket. Only authenticated users can read objects inside their own user_id folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boletos-mei', 'boletos-mei', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Usuario le seus PDFs MEI" on storage.objects;
create policy "Usuario le seus PDFs MEI"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'boletos-mei'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

