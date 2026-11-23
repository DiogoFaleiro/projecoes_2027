# Projeções 2027

App web instalável (PWA) para planejamento compartilhado: lista de móveis, ideias de viagem e lista de convidados, com prévia automática de links, painel de orçamento e notificações no Android.

## Estrutura

```
index.html              # app (sem build — HTML, CSS e JS puros)
css/app.css
js/app.js               # lógica do app (Supabase JS via esm.sh)
sw.js                   # service worker: cache offline + push
manifest.webmanifest    # PWA: instalação, atalhos e "Compartilhar → app"
icons/
supabase/
  migrations/001_casorio.sql   # schema "casorio" (tabelas, RLS, realtime, trigger de push)
  migrations/002_gastos.sql    # gastos (previsto/pago), crianças nos convites, orçamento e calculadora
  functions/casorio-preview    # lê um link e devolve título, imagem, descrição e preço
  functions/casorio-push       # envia Web Push para o outro membro
```

## Como funciona

- **Acesso:** dois usuários no Supabase Auth; o código de acesso é a senha, conferida no servidor (não fica no código).
- **Dados:** schema `casorio` no Supabase, com RLS — só os membros cadastrados em `casorio.membros` leem e escrevem.
- **Tempo real:** alterações aparecem na hora no outro celular (Supabase Realtime).
- **Prévia de links:** a função `casorio-preview` lê as meta tags (Open Graph / JSON-LD) da página. Algumas lojas bloqueiam leitura automática; nesses casos os campos são preenchidos à mão.
- **Notificações:** um trigger no banco chama `casorio-push` quando um item é adicionado ou muda de status/presença. As chaves VAPID e o segredo interno ficam no Supabase Vault.

- **Gastos e calculadora:** gastos com valor previsto e pago por categoria; calculadora de comida (churrasco, caseiro ou buffet) usando adultos e crianças da lista, com médias ajustáveis salvas em `config.calc`.

- **Mercado Livre:** o ML bloqueia leitura das páginas de produto por servidores; a função `casorio-ml` conecta a API oficial (OAuth + PKCE) e a prévia usa `/items/{id}` e `/items/{id}/description`. Credenciais em *Edge Functions → Secrets*: `ML_CLIENT_ID` e `ML_CLIENT_SECRET`. Redirect URI: `https://xlqmkfgiadahxnqtqwmo.supabase.co/functions/v1/casorio-ml`.

## Publicação

GitHub Pages servindo a branch `main` na raiz. Não há etapa de build.

Requisito no Supabase: o schema `casorio` precisa estar em **Settings → Data API → Exposed schemas**.
