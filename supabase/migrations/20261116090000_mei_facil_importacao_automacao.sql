-- MEI Fácil: suporte aditivo para importação em lote e envio rastreável.
-- Aplicar somente após backup e conferência do schema no Supabase SQL Editor.

create table if not exists public.mei_import_lotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  nome text,
  total_itens integer not null default 0 check (total_itens >= 0),
  status text not null default 'recebido'
    check (status in ('recebido','processando','concluido','concluido_com_erros')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mei_import_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.mei_import_lotes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  arquivo_path text not null,
  status text not null default 'aguardando_leitura'
    check (status in ('aguardando_leitura','lendo','revisao','cliente_nao_identificado','aguardando_aprovacao','aprovado','importado','duplicado','erro')),
  cliente_id uuid references public.clientes(id) on delete set null,
  boleto_id uuid references public.boletos(id) on delete set null,
  extraido_json jsonb,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.envios
  add column if not exists whatsapp_message_id text,
  add column if not exists erro text,
  add column if not exists entregue_em timestamptz,
  add column if not exists lido_em timestamptz,
  add column if not exists tentativas integer not null default 0;

create index if not exists idx_mei_import_itens_status_created
  on public.mei_import_itens(status, created_at);
create index if not exists idx_mei_import_itens_user
  on public.mei_import_itens(user_id);
create index if not exists idx_mei_import_itens_lote
  on public.mei_import_itens(lote_id);
create index if not exists idx_envios_message_id
  on public.envios(whatsapp_message_id) where whatsapp_message_id is not null;
create index if not exists idx_envios_status_created
  on public.envios(status, created_at);

alter table public.mei_import_lotes enable row level security;
alter table public.mei_import_itens enable row level security;

drop policy if exists "mei_import_lotes_owner_all" on public.mei_import_lotes;
create policy "mei_import_lotes_owner_all" on public.mei_import_lotes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "mei_import_itens_owner_all" on public.mei_import_itens;
create policy "mei_import_itens_owner_all" on public.mei_import_itens
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.mei_import_lotes to authenticated;
grant select, insert, update, delete on public.mei_import_itens to authenticated;
grant all on public.mei_import_lotes to service_role;
grant all on public.mei_import_itens to service_role;
grant all on public.envios to service_role;

create or replace function public.claim_mei_import_items(p_limit integer default 10)
returns setof public.mei_import_itens
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id
    from public.mei_import_itens
    where status = 'aguardando_leitura'
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update public.mei_import_itens i
  set status = 'lendo', updated_at = now()
  from picked
  where i.id = picked.id
  returning i.*;
$$;

create or replace function public.claim_mei_approved_sends(p_limit integer default 10)
returns setof public.envios
language sql
security definer
set search_path = public
as $$
  with picked as (
    select id
    from public.envios
    where status = 'aprovado'
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update public.envios e
  set status = 'processando', tentativas = coalesce(tentativas, 0) + 1
  from picked
  where e.id = picked.id
  returning e.*;
$$;

revoke all on function public.claim_mei_import_items(integer) from public, anon, authenticated;
revoke all on function public.claim_mei_approved_sends(integer) from public, anon, authenticated;
grant execute on function public.claim_mei_import_items(integer) to service_role;
grant execute on function public.claim_mei_approved_sends(integer) to service_role;

create or replace function public.touch_mei_import_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mei_import_lotes_touch on public.mei_import_lotes;
create trigger mei_import_lotes_touch before update on public.mei_import_lotes
for each row execute function public.touch_mei_import_updated_at();
drop trigger if exists mei_import_itens_touch on public.mei_import_itens;
create trigger mei_import_itens_touch before update on public.mei_import_itens
for each row execute function public.touch_mei_import_updated_at();


-- Aprovação atômica: cria boleto + envio e conclui o item na mesma transação.
create or replace function public.approve_mei_import_item(
  p_item_id uuid,
  p_cliente_id uuid,
  p_cnpj text,
  p_competencia text,
  p_valor numeric,
  p_vencimento date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.mei_import_itens%rowtype;
  v_cliente public.clientes%rowtype;
  v_boleto_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;

  select * into v_item from public.mei_import_itens
    where id = p_item_id and user_id = auth.uid() for update;
  if not found then raise exception 'Item de importação não encontrado'; end if;
  if v_item.boleto_id is not null then return v_item.boleto_id; end if;
  if v_item.status not in ('revisao','cliente_nao_identificado','aguardando_aprovacao','erro') then
    raise exception 'Item não está disponível para aprovação';
  end if;

  -- Serializa aprovações do mesmo cliente para evitar duplicidade concorrente.
  select * into v_cliente from public.clientes
    where id = p_cliente_id and user_id = auth.uid() for update;
  if not found then raise exception 'Cliente não encontrado'; end if;

  if regexp_replace(coalesce(v_cliente.cnpj,''), '\D', '', 'g') <>
     regexp_replace(coalesce(p_cnpj,''), '\D', '', 'g') then
    raise exception 'CNPJ não corresponde ao cliente selecionado';
  end if;
  if p_competencia is null
     or p_competencia !~ '^(0[1-9]|1[0-2])/[0-9]{4}$'
     or p_valor is null or p_valor <= 0
     or p_vencimento is null
     or length(regexp_replace(coalesce(p_cnpj,''), '\D', '', 'g')) <> 14 then
    raise exception 'Dados do DAS inválidos';
  end if;

  if exists (
    select 1 from public.boletos b
    where b.user_id = auth.uid()
      and b.cliente_id = p_cliente_id
      and b.competencia = p_competencia
  ) then
    raise exception 'Já existe boleto para este cliente e competência';
  end if;

  insert into public.boletos(user_id, cliente_id, competencia, valor, vencimento, arquivo_path, status)
  values (auth.uid(), p_cliente_id, p_competencia, p_valor, p_vencimento, v_item.arquivo_path, 'pendente')
  returning id into v_boleto_id;

  insert into public.envios(user_id, boleto_id, status)
  values (auth.uid(), v_boleto_id, 'aprovado');

  update public.mei_import_itens
    set status = 'importado', cliente_id = p_cliente_id, boleto_id = v_boleto_id, erro = null
    where id = p_item_id;

  return v_boleto_id;
end;
$$;

revoke all on function public.approve_mei_import_item(uuid, uuid, text, text, numeric, date) from public, anon;
grant execute on function public.approve_mei_import_item(uuid, uuid, text, text, numeric, date) to authenticated;
