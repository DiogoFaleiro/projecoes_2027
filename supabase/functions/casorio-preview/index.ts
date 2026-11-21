// Lê um link (loja, hotel, destino) e devolve título, imagem, descrição e preço.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

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
  const descricao = decode(m["og:description"] || m["twitter:description"] || m["description"] || ld.descricao)?.slice(0, 500) ?? null;
  const preco = numero(m["product:price:amount"] || m["og:price:amount"] || m["price"] || m["product:sale_price:amount"]) ?? ld.preco ?? null;
  const site = decode(m["og:site_name"]) || final.hostname.replace(/^www\./, "");
  return { titulo, imagem, descricao, preco, site, url: final.toString() };
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
  for (const ua of UAS) {
    const pag = await baixar(alvo, ua);
    if (!pag) continue;
    const dados = extrair(pag.html, pag.final);
    const nota = (d: typeof dados) => (d.titulo ? 1 : 0) + (d.imagem ? 1 : 0) + (d.preco ? 2 : 0);
    if (!melhor || nota(dados) > nota(melhor)) melhor = dados;
    if (melhor.titulo && melhor.imagem && melhor.preco) break;
  }
  if (!melhor) return json({ ok: false, url: alvo.toString(), site: alvo.hostname.replace(/^www\./, "") });
  return json({ ok: true, ...melhor });
});
