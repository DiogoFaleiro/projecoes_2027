-- Gastos do casamento, crianças nos convites, orçamento do casamento e calculadora de comida
alter table casorio.convidados add column criancas int not null default 0 check (criancas >= 0);
comment on column casorio.convidados.acompanhantes is 'Acompanhantes adultos (além do convidado principal)';

alter table casorio.config
  add column orcamento_casamento numeric(12,2) not null default 0,
  add column calc jsonb not null default '{}'::jsonb;

create table casorio.gastos (
  id uuid primary key default gen_random_uuid(),
  categoria text not null default 'Outros',
  titulo text not null,
  fornecedor text,
  previsto numeric(12,2) not null default 0 check (previsto >= 0),
  pago numeric(12,2) not null default 0 check (pago >= 0),
  vencimento date,
  notas text,
  criado_por uuid default auth.uid() references casorio.membros(user_id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on casorio.gastos (criado_por);
create trigger t_upd before update on casorio.gastos for each row execute function casorio.tocar_atualizado();

alter table casorio.gastos enable row level security;
create policy gastos_tudo on casorio.gastos for all to authenticated
  using ((select casorio.is_membro())) with check ((select casorio.is_membro()));
grant select, insert, update, delete on casorio.gastos to authenticated;
grant all on casorio.gastos to service_role;

alter publication supabase_realtime add table casorio.gastos;

-- Notifica: convidados → presença; gastos → valor pago; móveis/destinos → status
create or replace function casorio.notificar()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_campo text := case tg_table_name when 'convidados' then 'presenca' when 'gastos' then 'pago' else 'status' end;
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

create trigger t_notificar after insert or update on casorio.gastos for each row execute function casorio.notificar();
