// Lê um link (loja, hotel, destino) e devolve título, imagem, descrição e preço.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UAS = [
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Recorta um objeto JSON a partir de "{" respeitando strings
function objetoJson(s: string, i: number): any {
  if (i < 0) return null;
  let d = 0, str = false, esc = false;
  for (let j = i; j < s.length && j < i + 200_000; j++) {
    const c = s[j];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } } }
  }
  return null;
}

// Mercado Livre (links meli.la / páginas "social"): dados ficam nos "polycards"
function mercadoLivre(html: string) {
  const i = html.indexOf('"polycards":[');
  if (i < 0) return null;
  const card = objetoJson(html, html.indexOf("{", i));
  const comps: any[] = card?.components || [];
  const get = (t: string) => comps.find((c) => c.type === t)?.[t];
  const pr = get("price");
  const preco = Number(pr?.current_price?.value) || null;
  const partes: string[] = [];
  const vendedor = get("seller")?.text?.replace(/\{[^}]+\}/g, "").trim();
  if (vendedor) partes.push(vendedor + (/cockade/.test(JSON.stringify(get("seller"))) ? " (loja oficial)" : ""));
  const rev = get("review_compacted")?.alt_text;
  if (rev) partes.push(rev.replace(/\.$/, ""));
  if (pr?.previous_price?.value && preco) partes.push(`De ${brl(pr.previous_price.value)} por ${brl(preco)}${pr.discount_label?.text ? " (" + pr.discount_label.text + ")" : ""}`);
  const inst = pr?.installments;
  if (inst?.values) {
    const v = Object.fromEntries(inst.values.map((x: any) => [x.key, x.price ? brl(x.price.value) : x.label?.text || ""]));
    partes.push(inst.text.replace(/\{(\w+)\}/g, (_: string, k: string) => v[k] ?? "").replace(/\s+/g, " ").trim());
  }
  const frete = [].concat(get("shipping_v2") || []).map((x: any) => x?.text).filter(Boolean)[0] || get("shipping")?.text;
  if (frete) partes.push(frete);
  return { titulo: get("title")?.text || null, preco, descricao: partes.join(" · ") || null };
}

// Preço escrito no texto (ex.: "Geladeira X - R$ 4.278")
const precoNoTexto = (t?: string | null) => { const m = t?.match(/R\$\s?([\d.]+(?:,\d{1,2})?)/); return m ? numero(m[1]) : null; };
const limparTitulo = (t: string | null) => t?.replace(/\s*[-|–]\s*R\$\s?[\d.,]+\s*$/, "").trim() || null;
const limparDescricao = (d: string | null, titulo: string | null) => {
  if (!d) return null;
  let x = d.replace(/^Olha o que eu encontrei!\s*/i, "");
  if (titulo && x.startsWith(titulo)) x = x.slice(titulo.length).replace(/^\s*[-|–]\s*/, "");
  x = x.replace(/^R\$\s?[\d.,]+\s*(no|na)\s+[\w ]+\.?$/i, "").trim();
  return x.length > 3 ? x : null;
};

// ===== API oficial do Mercado Livre =====
const ehML = (h: string) => /(^|\.)(mercadoli[vb]re\.com(\.br)?|meli\.la)$/i.test(h);

function idsML(u: string) {
  let t = u;
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; } }
  const item = t.match(/item_id[:=](MLB\d{6,})/i)?.[1] || t.match(/[?&#]wid=(MLB\d{6,})/i)?.[1] || (t.match(/\/(MLB)-?(\d{6,})(?=[-_/?#]|$)/i) ? "MLB" + t.match(/\/MLB-?(\d{6,})(?=[-_/?#]|$)/i)![1] : null);
  const produto = t.match(/\/p\/(MLB\d{6,})/i)?.[1] || null;
  return { item, produto };
}

async function tokenML(): Promise<string | null> {
  const ID = Deno.env.get("ML_CLIENT_ID"), SECRET = Deno.env.get("ML_CLIENT_SECRET");
  if (!ID || !SECRET) return null;
  return await sql.begin(async (tx) => {
    const [t] = await tx`select access_token, refresh_token, expira_em from casorio.ml_token where id = 1 for update`;
    if (!t?.refresh_token && !t?.access_token) return null;
    if (t.access_token && t.expira_em && new Date(t.expira_em).getTime() > Date.now() + 120_000) return t.access_token;
    if (!t.refresh_token) return null;
    const r = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: ID, client_secret: SECRET, refresh_token: t.refresh_token }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { console.error("refresh ML falhou", r.status, j); return null; }
    await tx`update casorio.ml_token set access_token = ${j.access_token}, refresh_token = ${j.refresh_token ?? t.refresh_token},
      expira_em = now() + make_interval(secs => ${Number(j.expires_in) || 21600}), atualizado_em = now() where id = 1`;
    return j.access_token as string;
  });
}

async function apiML(path: string, token: string) {
  const r = await fetch(`https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!r.ok) { console.error("API ML", path, r.status, (await r.text()).slice(0, 200)); return null; }
  return await r.json();
}

async function dadosML(urls: string[]) {
  const token = await tokenML();
  if (!token) return null;
  let ids = { item: null as string | null, produto: null as string | null };
  for (const u of urls) { const x = idsML(u); ids = { item: ids.item || x.item, produto: ids.produto || x.produto }; }
  const res: { titulo?: string; preco?: number; imagem?: string; descricao?: string } = {};
  if (ids.item) {
    const [it, de] = await Promise.all([apiML(`/items/${ids.item}`, token), apiML(`/items/${ids.item}/description`, token)]);
    if (it) {
      res.titulo = it.title; res.preco = Number(it.price) || undefined;
      res.imagem = it.pictures?.[0]?.secure_url || it.thumbnail?.replace(/^http:/, "https:");
    }
    const txt = (de?.plain_text || "").trim();
    if (txt) res.descricao = txt;
  }
  if (ids.produto && (!res.titulo || !res.preco || !res.descricao)) {
    const pr = await apiML(`/products/${ids.produto}`, token);
    if (pr) {
      res.titulo ||= pr.name;
      res.preco ||= Number(pr.buy_box_winner?.price) || undefined;
      res.imagem ||= pr.pictures?.[0]?.url;
      res.descricao ||= (pr.short_description?.content || "").trim() || undefined;
      if (!res.descricao && Array.isArray(pr.main_features)) res.descricao = pr.main_features.map((f: any) => "• " + f.text).join("\n") || undefined;
    }
  }
  return res.titulo || res.preco ? res : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function userFromJwt(req: Request): string | null {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub || null;
  } catch { return null; }
}

function urlSegura(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0" || h.includes(":")) return null;
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return null;
  }
  return u;
}

function decode(s?: string | null): string | null {
  if (!s) return null;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim() || null;
}

function metas(html: string) {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = (n: string) => tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    const key = attr("property") || attr("name") || attr("itemprop");
    const val = attr("content");
    if (key && val) {
      const k = (key[2] ?? key[3]).toLowerCase();
      if (!(k in out)) out[k] = val[2] ?? val[3];
    }
  }
  return out;
}

function numero(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
  let s = String(v).replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc > -1) s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (ld > -1 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : null;
}

function jsonLd(html: string) {
  const res: { preco?: number; titulo?: string; imagem?: string; descricao?: string } = {};
  const blocos = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const visitar = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(visitar);
    const tipo = [].concat(o["@type"] || []).join(",");
    if (/Product|Hotel|LodgingBusiness|Offer|TouristTrip|Accommodation/i.test(tipo)) {
      res.titulo ??= o.name;
      res.descricao ??= o.description;
      const img = Array.isArray(o.image) ? o.image[0] : o.image;
      res.imagem ??= typeof img === "string" ? img : img?.url;
      const ofertas = [].concat(o.offers || []);
      for (const oferta of ofertas as any[]) {
        const p = numero(oferta?.price ?? oferta?.lowPrice ?? oferta?.priceSpecification?.price);
        if (p && !res.preco) res.preco = p;
      }
      if (!res.preco) res.preco = numero(o.price) ?? undefined;
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") visitar(v);
  };
  for (const b of blocos) {
    try { visitar(JSON.parse(b.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim())); } catch { /* ignora */ }
  }
  return res;
}

async function baixar(u: URL, ua: string): Promise<{ html: string; final: URL } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(u, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7" },
    });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 2_000_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); total += value.length;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(total);
    let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
    const charset = (r.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1] || "utf-8";
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); } catch { html = new TextDecoder().decode(buf); }
    return { html, final: new URL(r.url || u.toString()) };
  } catch { return null; } finally { clearTimeout(t); }
}

function extrair(html: string, final: URL) {
  const m = metas(html);
  const ld = jsonLd(html);
  const tituloTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const titulo = decode(m["og:title"] || m["twitter:title"] || ld.titulo || tituloTag);
  let imagem = m["og:image:secure_url"] || m["og:image"] || m["twitter:image"] || m["twitter:image:src"] || ld.imagem ||
    html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/i)?.[1] || null;
  if (imagem) { try { imagem = new URL(decode(imagem)!, final).toString(); } catch { imagem = null; } }
  const descBruta = decode(m["og:description"] || m["twitter:description"] || m["description"] || ld.descricao);
  const ml = /mercadoli[vb]re|meli\.la/i.test(final.hostname) ? mercadoLivre(html) : null;
  const tituloLimpo = limparTitulo(ml?.titulo || titulo);
  const preco = ml?.preco ?? numero(m["product:price:amount"] || m["og:price:amount"] || m["price"] || m["product:sale_price:amount"]) ?? ld.preco ?? precoNoTexto(titulo) ?? precoNoTexto(descBruta) ?? null;
  const descricao = (ml?.descricao || limparDescricao(descBruta, tituloLimpo))?.slice(0, 600) ?? null;
  const site = decode(m["og:site_name"]) || final.hostname.replace(/^www\./, "");
  return { titulo: tituloLimpo, imagem, descricao, preco, site, url: final.toString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método" }, 405);

  const uid = userFromJwt(req);
  if (!uid) return json({ erro: "não autorizado" }, 401);
  const [m] = await sql`select 1 from casorio.membros where user_id = ${uid}`;
  if (!m) return json({ erro: "não autorizado" }, 403);

  const { url } = await req.json().catch(() => ({}));
  const alvo = urlSegura(String(url || ""));
  if (!alvo) return json({ erro: "link inválido" }, 400);

  let melhor: ReturnType<typeof extrair> | null = null;
  const finais: string[] = [alvo.toString()];
  let bloqueado = false;
  for (const ua of UAS) {
    const pag = await baixar(alvo, ua);
    if (!pag) continue;
    finais.push(pag.final.toString());
    if (/account-verification|\/gz\/|captcha/i.test(pag.final.pathname)) { bloqueado = true; continue; }
    const dados = extrair(pag.html, pag.final);
    const nota = (d: typeof dados) => (d.titulo ? 1 : 0) + (d.imagem ? 1 : 0) + (d.preco ? 2 : 0) + (d.descricao ? 1 : 0);
    if (!melhor || nota(dados) > nota(melhor)) melhor = dados;
    if (melhor.titulo && melhor.imagem && melhor.preco && melhor.descricao) break;
  }
  // Mercado Livre: API oficial completa preço e descrição (quando conectada)
  if (finais.some((u) => { try { return ehML(new URL(u).hostname); } catch { return false; } }) && (!melhor?.preco || !melhor?.descricao || (melhor.descricao || "").startsWith("Por "))) {
    const api = await dadosML(finais).catch((e) => { console.error(e); return null; });
    if (api) {
      melhor = {
        titulo: api.titulo || melhor?.titulo || null, imagem: api.imagem || melhor?.imagem || null,
        descricao: (api.descricao || melhor?.descricao || null)?.slice(0, 2000) ?? null,
        preco: api.preco ?? melhor?.preco ?? null, site: "Mercado Livre", url: alvo.toString(),
      };
    } else if (!melhor) {
      return json({ ok: false, ml: true, url: alvo.toString(), site: "Mercado Livre" });
    }
  }
  if (!melhor) return json({ ok: false, bloqueado, url: alvo.toString(), site: alvo.hostname.replace(/^www\./, "") });
  return json({ ok: true, ...melhor });
});
