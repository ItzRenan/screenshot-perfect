-- Persistent queue and transactional DAS registration for MEI Fácil.
-- Apply through the connected Lovable/Supabase project after confirming the
-- existing private Storage bucket "boletos-mei" is present and unchanged.

create unique index if not exists clientes_id_user_id_mei_fk_idx
  on public.clientes (id, user_id);

create table if not exists public.mei_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  competencia text not null check (competencia ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'paid', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  locked_at timestamptz,
  error_message text,
  result jsonb not null default '{}'::jsonb,
  storage_path text,
  boleto_id uuid references public.boletos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint mei_jobs_cliente_usuario_fk
    foreign key (cliente_id, user_id)
    references public.clientes(id, user_id)
    deferrable initially immediate
);

create index if not exists mei_jobs_queue_idx
  on public.mei_jobs (status, created_at)
  where status in ('pending', 'processing');

create index if not exists mei_jobs_owner_idx
  on public.mei_jobs (user_id, created_at desc);

create unique index if not exists mei_jobs_unique_competencia_idx
  on public.mei_jobs (user_id, cliente_id, competencia)
  where status in ('pending', 'processing', 'completed', 'paid');

alter table public.mei_jobs enable row level security;

grant select, insert on public.mei_jobs to authenticated;
grant all on public.mei_jobs to service_role;

drop policy if exists "Usuario consulta seus jobs MEI" on public.mei_jobs;
create policy "Usuario consulta seus jobs MEI"
  on public.mei_jobs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Usuario cria jobs MEI para seus clientes" on public.mei_jobs;
create policy "Usuario cria jobs MEI para seus clientes"
  on public.mei_jobs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.clientes c
      where c.id = cliente_id and c.user_id = (select auth.uid())
    )
  );

create or replace function public.claim_mei_job()
returns setof public.mei_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.mei_jobs
  set status = 'failed',
      locked_at = null,
      error_message = coalesce(error_message, 'Limite de tentativas excedido após perda da sessão do worker.'),
      completed_at = now(),
      updated_at = now()
  where status = 'processing'
    and locked_at < now() - interval '15 minutes'
    and attempts >= max_attempts;

  return query
  with candidate as (
    select id
    from public.mei_jobs
    where attempts < max_attempts
      and (
        status = 'pending'
        or (status = 'processing' and locked_at < now() - interval '15 minutes')
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update public.mei_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      error_message = null,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.*;
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  v_job public.mei_jobs%rowtype;
  v_cliente public.clientes%rowtype;
  v_boleto_id uuid;
  v_cnpj text;
begin
  select * into v_job
  from public.mei_jobs
  where id = p_job_id
  for update;

  if not found then raise exception 'Solicitação MEI não encontrada.'; end if;
  if v_job.status <> 'processing' then raise exception 'Solicitação não está em processamento.'; end if;

  select * into v_cliente
  from public.clientes
  where id = v_job.cliente_id and user_id = v_job.user_id;

  if not found then raise exception 'Cliente não pertence ao usuário da solicitação.'; end if;

  v_cnpj := regexp_replace(coalesce(v_cliente.cnpj, ''), '[^0-9]', '', 'g');
  if length(v_cnpj) <> 14 or regexp_replace(coalesce(p_pdf_cnpj, ''), '[^0-9]', '', 'g') <> v_cnpj then
    raise exception 'CNPJ do PDF não corresponde ao cliente selecionado.';
  end if;
  if p_pdf_competencia is distinct from v_job.competencia then
    raise exception 'Competência do PDF não corresponde à solicitação.';
  end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Valor do DAS inválido.'; end if;
  if p_vencimento is null then raise exception 'Vencimento do DAS não identificado.'; end if;
  if p_storage_path is null or p_storage_path not like v_job.user_id::text || '/' || v_job.id::text || '/%' then
    raise exception 'Caminho do PDF não corresponde à solicitação.';
  end if;

  if exists (
    select 1 from public.boletos
    where cliente_id = v_job.cliente_id and competencia = v_job.competencia
  ) then
    raise exception 'Já existe boleto cadastrado para este cliente e competência.';
  end if;

  insert into public.boletos (
    user_id, cliente_id, competencia, valor, vencimento, arquivo_path, status
  ) values (
    v_job.user_id, v_job.cliente_id, v_job.competencia, p_valor, p_vencimento, p_storage_path, 'pendente'
  )
  returning id into v_boleto_id;

  update public.mei_jobs
  set status = 'completed',
      storage_path = p_storage_path,
      boleto_id = v_boleto_id,
      error_message = null,
      locked_at = null,
      completed_at = now(),
      updated_at = now(),
      result = jsonb_build_object('stage', 'completed', 'boletoId', v_boleto_id)
  where id = p_job_id;

  return v_boleto_id;
end;
$$;

create or replace function public.fail_mei_job(
  p_job_id uuid,
  p_error text,
  p_retry boolean default true
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.mei_jobs%rowtype;
  v_status text;
begin
  select * into v_job
  from public.mei_jobs
  where id = p_job_id
  for update;

  if not found then raise exception 'Solicitação MEI não encontrada.'; end if;
  if v_job.status in ('completed', 'paid', 'failed') then return v_job.status; end if;

  v_status := case
    when p_retry and v_job.attempts < v_job.max_attempts then 'pending'
    else 'failed'
  end;

  update public.mei_jobs
  set status = v_status,
      error_message = left(coalesce(p_error, 'Falha não especificada.'), 1000),
      locked_at = null,
      completed_at = case when v_status = 'failed' then now() else null end,
      updated_at = now(),
      result = jsonb_build_object('stage', v_status)
  where id = p_job_id;

  return v_status;
end;
$$;

revoke all on function public.claim_mei_job() from public, anon, authenticated;
revoke all on function public.complete_mei_job(uuid, text, text, text, numeric, date) from public, anon, authenticated;
revoke all on function public.fail_mei_job(uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.claim_mei_job() to service_role;
grant execute on function public.complete_mei_job(uuid, text, text, text, numeric, date) to service_role;
grant execute on function public.fail_mei_job(uuid, text, boolean) to service_role;
