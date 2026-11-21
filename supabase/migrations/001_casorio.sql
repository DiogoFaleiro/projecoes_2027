-- Schema do app Mayedi (casório Diogo & Maynara)
create schema if not exists casorio;

-- Membros do casal (usuários do Supabase Auth autorizados)
create table casorio.membros (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  criado_em timestamptz not null default now()
);

create or replace function casorio.is_membro()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from casorio.membros m where m.user_id = (select auth.uid())) $$;

create or replace function casorio.tocar_atualizado()
returns trigger language plpgsql set search_path = ''
as $$ begin new.atualizado_em := now(); return new; end $$;

-- Configurações gerais (linha única)
create table casorio.config (
  id int primary key default 1 check (id = 1),
  data_cha date,
  data_casamento date,
  orcamento_moveis numeric(12,2) not null default 0,
  orcamento_lua numeric(12,2) not null default 0,
  atualizado_em timestamptz not null default now()
);
insert into casorio.config (id) values (1);

create table casorio.moveis (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  url text,
  imagem text,
  descricao text,
  site text,
  preco numeric(12,2),
  quantidade int not null default 1 check (quantidade > 0),
  comodo text not null default 'Outros',
  status text not null default 'pesquisando' check (status in ('pesquisando','escolhido','comprado')),
  prioridade text not null default 'media' check (prioridade in ('alta','media','baixa')),
  notas text,
  criado_por uuid default auth.uid() references casorio.membros(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table casorio.destinos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  url text,
  imagem text,
  descricao text,
  site text,
  local text,
  custo numeric(12,2),
  dias int check (dias is null or dias > 0),
  status text not null default 'ideia' check (status in ('ideia','favorito','decidido')),
  notas text,
  criado_por uuid default auth.uid() references casorio.membros(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table casorio.convidados (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  lado text not null default 'ambos' check (lado in ('noivo','noiva','ambos')),
  acompanhantes int not null default 0 check (acompanhantes >= 0),
  presenca text not null default 'pendente' check (presenca in ('pendente','sim','nao')),
  evento text not null default 'casamento' check (evento in ('cha','casamento','ambos')),
  notas text,
  criado_por uuid default auth.uid() references casorio.membros(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table casorio.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references casorio.membros(user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

create index on casorio.moveis (criado_por);
create index on casorio.destinos (criado_por);
create index on casorio.convidados (criado_por);
create index on casorio.push_subs (user_id);

create trigger t_upd before update on casorio.config for each row execute function casorio.tocar_atualizado();
create trigger t_upd before update on casorio.moveis for each row execute function casorio.tocar_atualizado();
create trigger t_upd before update on casorio.destinos for each row execute function casorio.tocar_atualizado();
create trigger t_upd before update on casorio.convidados for each row execute function casorio.tocar_atualizado();

-- Segurança: só os membros do casal acessam
alter table casorio.membros enable row level security;
alter table casorio.config enable row level security;
alter table casorio.moveis enable row level security;
alter table casorio.destinos enable row level security;
alter table casorio.convidados enable row level security;
alter table casorio.push_subs enable row level security;

create policy membros_ler on casorio.membros for select to authenticated using ((select casorio.is_membro()));
create policy config_ler on casorio.config for select to authenticated using ((select casorio.is_membro()));
create policy config_editar on casorio.config for update to authenticated using ((select casorio.is_membro())) with check ((select casorio.is_membro()));
create policy moveis_tudo on casorio.moveis for all to authenticated using ((select casorio.is_membro())) with check ((select casorio.is_membro()));
create policy destinos_tudo on casorio.destinos for all to authenticated using ((select casorio.is_membro())) with check ((select casorio.is_membro()));
create policy convidados_tudo on casorio.convidados for all to authenticated using ((select casorio.is_membro())) with check ((select casorio.is_membro()));
create policy push_proprio on casorio.push_subs for all to authenticated
  using (user_id = (select auth.uid()) and (select casorio.is_membro()))
  with check (user_id = (select auth.uid()) and (select casorio.is_membro()));

grant usage on schema casorio to authenticated, service_role;
grant select on casorio.membros to authenticated;
grant select, update on casorio.config to authenticated;
grant select, insert, update, delete on casorio.moveis, casorio.destinos, casorio.convidados, casorio.push_subs to authenticated;
grant all on all tables in schema casorio to service_role;
revoke all on schema casorio from anon;
revoke execute on function casorio.is_membro() from public, anon;
grant execute on function casorio.is_membro() to authenticated;

-- Tempo real entre os dois celulares
alter publication supabase_realtime add table casorio.moveis, casorio.destinos, casorio.convidados, casorio.config;

-- Notificações: dispara a Edge Function quando algo é adicionado ou muda de status
create or replace function casorio.notificar()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_campo text := case when tg_table_name = 'convidados' then 'presenca' else 'status' end;
  v_secret text;
begin
  if tg_op = 'UPDATE' and (v_new ->> v_campo) is not distinct from (v_old ->> v_campo) then
    return new;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'casorio_push_secret';
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := 'https://xlqmkfgiadahxnqtqwmo.supabase.co/functions/v1/casorio-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-casorio-secret', v_secret),
    body := jsonb_build_object('tabela', tg_table_name, 'op', tg_op, 'record', v_new, 'old', v_old, 'actor', auth.uid())
  );
  return new;
end $$;
revoke execute on function casorio.notificar() from public, anon, authenticated;

create trigger t_notificar after insert or update on casorio.moveis for each row execute function casorio.notificar();
create trigger t_notificar after insert or update on casorio.destinos for each row execute function casorio.notificar();
create trigger t_notificar after insert or update on casorio.convidados for each row execute function casorio.notificar();
