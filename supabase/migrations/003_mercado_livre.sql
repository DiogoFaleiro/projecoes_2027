-- Autorização da API oficial do Mercado Livre (token guardado só no servidor)
create table casorio.ml_token (
  id int primary key default 1 check (id = 1),
  access_token text,
  refresh_token text,
  expira_em timestamptz,
  state text,
  verifier text,
  state_em timestamptz,
  conectado_por uuid references casorio.membros(user_id) on delete set null,
  atualizado_em timestamptz not null default now()
);
insert into casorio.ml_token (id) values (1);
alter table casorio.ml_token enable row level security;
-- Sem políticas e sem grants: nenhum usuário lê os tokens pela API; só as Edge Functions (conexão direta)
revoke all on casorio.ml_token from anon, authenticated;
