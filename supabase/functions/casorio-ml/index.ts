// Conexão com a API oficial do Mercado Livre (OAuth 2 + PKCE).
// POST (app, com login): { acao: "status" | "iniciar" | "desconectar" }
// GET  (retorno do Mercado Livre): ?code=...&state=...
// Credenciais: secrets ML_CLIENT_ID e ML_CLIENT_SECRET (Supabase → Edge Functions → Secrets)
import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const APP_URL = "https://diogofaleiro.github.io/projecoes_2027/";
const REDIRECT_URI = "https://xlqmkfgiadahxnqtqwmo.supabase.co/functions/v1/casorio-ml";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const voltar = (r: string) => Response.redirect(`${APP_URL}?ml=${r}#painel`, 302);

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatorio = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function membro(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data } = await sb.auth.getUser(token);
  if (!data?.user) return null;
  const [m] = await sql`select user_id from casorio.membros where user_id = ${data.user.id}`;
  return m ? data.user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const ID = Deno.env.get("ML_CLIENT_ID"), SECRET = Deno.env.get("ML_CLIENT_SECRET");
  const url = new URL(req.url);

  // Retorno do Mercado Livre depois que o usuário autoriza
  if (req.method === "GET") {
    if (url.searchParams.get("error")) return voltar("negado");
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state || !ID || !SECRET) return voltar("erro");
    const [t] = await sql`select state, verifier, state_em from casorio.ml_token where id = 1`;
    if (!t?.state || t.state !== state || Date.now() - new Date(t.state_em).getTime() > 15 * 60_000) return voltar("expirado");
    const r = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: ID, client_secret: SECRET, code, redirect_uri: REDIRECT_URI, code_verifier: t.verifier }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { console.error("troca de código falhou", r.status, j); return voltar("erro"); }
    await sql`update casorio.ml_token set access_token = ${j.access_token}, refresh_token = ${j.refresh_token ?? null},
      expira_em = now() + make_interval(secs => ${Number(j.expires_in) || 21600}), state = null, verifier = null, atualizado_em = now() where id = 1`;
    return voltar(j.refresh_token ? "ok" : "sem-offline");
  }

  if (req.method !== "POST") return json({ erro: "método" }, 405);
  const uid = await membro(req);
  if (!uid) return json({ erro: "não autorizado" }, 401);
  const { acao } = await req.json().catch(() => ({}));

  if (acao === "status") {
    const [t] = await sql`select refresh_token is not null as conectado, atualizado_em from casorio.ml_token where id = 1`;
    return json({ configurado: !!(ID && SECRET), conectado: !!t?.conectado, atualizado_em: t?.atualizado_em });
  }
  if (acao === "iniciar") {
    if (!ID || !SECRET) return json({ erro: "Credenciais do Mercado Livre ainda não cadastradas no Supabase." }, 400);
    const state = aleatorio(24), verifier = aleatorio(48);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    await sql`update casorio.ml_token set state = ${state}, verifier = ${verifier}, state_em = now(), conectado_por = ${uid} where id = 1`;
    const auth = new URL("https://auth.mercadolivre.com.br/authorization");
    auth.search = new URLSearchParams({ response_type: "code", client_id: ID, redirect_uri: REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    return json({ url: auth.toString() });
  }
  if (acao === "desconectar") {
    await sql`update casorio.ml_token set access_token = null, refresh_token = null, expira_em = null, atualizado_em = now() where id = 1`;
    return json({ ok: true });
  }
  return json({ erro: "ação inválida" }, 400);
});
