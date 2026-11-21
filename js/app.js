import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Configuração =====
const SUPABASE_URL = "https://xlqmkfgiadahxnqtqwmo.supabase.co";
const SUPABASE_KEY = "sb_publishable_R-kMSvuH62UkR3sVWK0rQg_YLbq2Xj1"; // chave pública (segura para o navegador)
const VAPID_PUBLIC = "BM8WEwrMZVNrSJ4bwOcNvsr2lf11t4GpzLOlB5seqeIYbRbnM7DspCYqZP4rKkbiGRMTqjEo3uIgI2qBIljvbZg";
const PESSOAS = {
  diogo: { email: "diogo@projecoes2027.app", nome: "Diogo", emoji: "🤵", foto: "./img/diogo.jpg" },
  may: { email: "may@projecoes2027.app", nome: "May", emoji: "👰", foto: "./img/may.jpg" },
};
const COMODOS = ["Sala", "Quarto", "Cozinha", "Banheiro", "Lavanderia", "Área externa", "Escritório", "Decoração", "Eletros", "Outros"];
const ST_MOVEL = { pesquisando: ["🔎", "Pesquisando"], escolhido: ["⭐", "Escolhido"], comprado: ["✅", "Comprado"] };
const ST_DEST = { ideia: ["💭", "Ideia"], favorito: ["❤️", "Favorito"], decidido: ["✈️", "Decidido"] };
const LADO = { noivo: "Noivo", noiva: "Noiva", ambos: "Ambos" };
const EVENTO = { cha: "Chá de panela", casamento: "Casamento", ambos: "Chá + Casamento" };
const PRES = { sim: ["✓", "Confirmou"], pendente: ["?", "Pendente"], nao: ["✗", "Não vai"] };

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: "casorio" },
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "mayedi-auth" },
});

// ===== Estado =====
const S = {
  user: null, nome: "", config: {}, moveis: [], destinos: [], convidados: [],
  aba: "painel",
  f: { moveis: "todos", lua: "todos", evento: "todos", presenca: "todos", lado: "todos", busca: "" },
  installPrompt: null, compartilhado: null, canal: null,
};

// ===== Utilidades =====
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const urlOk = (u) => { try { const x = new URL(u); return ["http:", "https:"].includes(x.protocol) ? x.toString() : null; } catch { return null; } };
const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: (Number(n) || 0) % 1 ? 2 : 0 });
const num = (v) => {
  if (v == null || v === "") return null;
  let s = String(v).replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
};
const fmtNum = (n) => (n == null ? "" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const dias = (d) => { if (!d) return null; const a = new Date(d + "T00:00:00"); const h = new Date(); h.setHours(0, 0, 0, 0); return Math.round((a - h) / 864e5); };
const dataBR = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "");
const iniciais = (n) => n.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const extrairUrl = (t) => (String(t || "").match(/https?:\/\/[^\s<>"']+/i) || [])[0] || null;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2600);
}
function img(url, fallback) {
  const u = urlOk(url);
  return u ? `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
}

// ===== Compartilhar (Android: "Compartilhar → Mayedi") =====
(function lerCompartilhamento() {
  const p = new URLSearchParams(location.search);
  if (!p.has("url") && !p.has("text") && !p.has("title")) return;
  const url = urlOk(p.get("url")) || extrairUrl(p.get("text")) || extrairUrl(p.get("title"));
  if (url) S.compartilhado = { url, titulo: p.get("title") || "" };
  history.replaceState(null, "", location.pathname + location.hash);
})();

// ===== PWA =====
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.error);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; if (S.user && S.aba === "painel") render(); });
window.addEventListener("appinstalled", () => { S.installPrompt = null; toast("App instalado! 💜"); render(); });
const instalado = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function b64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function ativarNotificacoes(silencioso = false) {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (!silencioso) toast("Este navegador não suporta notificações. Use o Chrome.");
    return false;
  }
  const perm = silencioso ? Notification.permission : await Notification.requestPermission();
  if (perm !== "granted") { if (!silencioso) toast("Permissão negada. Libere nas configurações do Chrome."); return false; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC) });
  const j = sub.toJSON();
  await sb.from("push_subs").delete().eq("endpoint", j.endpoint);
  const { error } = await sb.from("push_subs").insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) { console.error(error); if (!silencioso) toast("Não consegui ativar: " + error.message); return false; }
  if (!silencioso) { toast("Notificações ativadas 🔔"); render(); }
  return true;
}

// ===== Dados =====
async function carregar(tabela) {
  const ordem = tabela === "convidados" ? "nome" : "criado_em";
  const { data, error } = await sb.from(tabela).select("*").order(ordem, { ascending: tabela === "convidados" });
  if (error) { console.error(error); toast("Erro ao carregar " + tabela); return; }
  S[tabela] = data;
}
async function carregarTudo() {
  const [{ data: cfg }] = await Promise.all([
    sb.from("config").select("*").eq("id", 1).maybeSingle(),
    carregar("moveis"), carregar("destinos"), carregar("convidados"),
  ]);
  S.config = cfg || {};
}
function tempoReal() {
  if (S.canal) sb.removeChannel(S.canal);
  let fila = {};
  const agendar = (t) => { clearTimeout(fila[t]); fila[t] = setTimeout(async () => {
    if (t === "config") { const { data } = await sb.from("config").select("*").eq("id", 1).maybeSingle(); S.config = data || {}; }
    else await carregar(t);
    if (!$(".sheet-bg")) render();
  }, 250); };
  S.canal = sb.channel("casorio");
  for (const t of ["moveis", "destinos", "convidados", "config"]) {
    S.canal.on("postgres_changes", { event: "*", schema: "casorio", table: t }, () => agendar(t));
  }
  S.canal.subscribe();
}
async function salvar(tabela, dados, id) {
  const q = id ? sb.from(tabela).update(dados).eq("id", id) : sb.from(tabela).insert(dados);
  const { error } = await q;
  if (error) { console.error(error); toast("Erro ao salvar: " + error.message); return false; }
  await carregar(tabela);
  return true;
}
async function excluir(tabela, id) {
  const { error } = await sb.from(tabela).delete().eq("id", id);
  if (error) { toast("Erro ao excluir"); return false; }
  await carregar(tabela); return true;
}

// ===== Login =====
function telaLogin(erro = "") {
  let quem = localStorage.getItem("mayedi-quem") || "";
  $("#app").innerHTML = `
  <div class="login">
    <div class="logo"><img src="./icons/icon-192.png" alt=""></div>
    <h1 class="serif">Projeções 2027</h1>
    <p>Quem está entrando?</p>
    <div class="quem">
      ${Object.entries(PESSOAS).map(([k, p]) => `<button data-quem="${k}" class="${quem === k ? "on" : ""}"><img class="avatar" src="${p.foto}" alt="">${p.nome}</button>`).join("")}
    </div>
    <label class="campo"><span>Código de acesso</span>
      <input id="codigo" class="inp" type="password" autocomplete="current-password" autocapitalize="characters" placeholder="••••••••"></label>
    <div class="erro" id="erro">${esc(erro)}</div>
    <button class="btn prim bloco" id="entrar">Entrar</button>
  </div>`;
  $("#app").querySelectorAll("[data-quem]").forEach((b) => b.onclick = () => {
    quem = b.dataset.quem; $("#app").querySelectorAll("[data-quem]").forEach((x) => x.classList.toggle("on", x === b));
    $("#codigo").focus();
  });
  const entrar = async () => {
    const codigo = $("#codigo").value.trim().toUpperCase();
    if (!quem) return ($("#erro").textContent = "Escolha quem está entrando.");
    if (!codigo) return ($("#erro").textContent = "Digite o código.");
    const b = $("#entrar"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    const { error } = await sb.auth.signInWithPassword({ email: PESSOAS[quem].email, password: codigo });
    if (error) { b.disabled = false; b.textContent = "Entrar"; $("#erro").textContent = "Código incorreto."; return; }
    localStorage.setItem("mayedi-quem", quem);
  };
  $("#entrar").onclick = entrar;
  $("#codigo").onkeydown = (e) => e.key === "Enter" && entrar();
}

// ===== Render principal =====
function render() {
  if (!S.user) return telaLogin();
  const abas = [["painel", "💜", "Painel"], ["moveis", "🛋️", "Móveis"], ["lua", "✈️", "Lua de mel"], ["convidados", "💌", "Convidados"]];
  const titulo = { painel: "Diogo & Maynara", moveis: "Nossa casa", lua: "Lua de mel", convidados: "Convidados" }[S.aba];
  const sub = { painel: subtituloPainel(), moveis: `${S.moveis.length} itens na lista`, lua: `${S.destinos.length} destinos`, convidados: `${totPessoas(S.convidados)} pessoas no total` }[S.aba];
  const semNotif = "Notification" in window && Notification.permission !== "granted";
  const corpo = { painel: vPainel, moveis: vMoveis, lua: vLua, convidados: vConvidados }[S.aba]();
  const y = window.scrollY;
  $("#app").innerHTML = `
    <header class="topo">
      <div class="tit"><h1 class="serif">${titulo}</h1><small>${esc(sub)}</small></div>
      <button class="icone-btn" data-a="config" aria-label="Configurações">⚙️${semNotif ? '<span class="ponto"></span>' : ""}</button>
    </header>
    <main>${corpo}</main>
    ${S.aba !== "painel" ? '<button class="fab" data-a="novo" aria-label="Adicionar">+</button>' : ""}
    <nav class="abas">${abas.map(([k, i, n]) => `<button data-aba="${k}" class="${S.aba === k ? "on" : ""}"><i>${i}</i>${n}</button>`).join("")}</nav>`;
  window.scrollTo(0, y);
}
function subtituloPainel() {
  const d = dias(S.config.data_casamento);
  if (d == null) return `Olá, ${S.nome}! 💍`;
  if (d > 0) return `Faltam ${d} dias para o grande dia`;
  if (d === 0) return "É hoje! 💍";
  return "Casados! 💍";
}
const totPessoas = (l) => l.reduce((s, c) => s + 1 + (c.acompanhantes || 0), 0);
const doEvento = (ev) => S.convidados.filter((c) => c.evento === ev || c.evento === "ambos");

// ===== Painel =====
function vPainel() {
  const c = S.config;
  const contagem = (rot, data) => {
    const d = dias(data);
    const n = d == null ? "—" : d > 0 ? d : d === 0 ? "Hoje" : "✓";
    const leg = d == null ? "Toque para definir a data" : d > 0 ? `dias · ${dataBR(data)}` : dataBR(data);
    return `<div class="card grad contagem" data-a="config"><small>${rot}</small><div class="num">${n}</div><small>${leg}</small></div>`;
  };
  // Móveis
  const tot = (st) => S.moveis.filter((m) => !st || m.status === st).reduce((s, m) => s + (Number(m.preco) || 0) * (m.quantidade || 1), 0);
  const comprado = tot("comprado"), escolhido = tot("escolhido"), pesquisando = tot("pesquisando"), total = comprado + escolhido + pesquisando;
  const orc = Number(c.orcamento_moveis) || 0;
  const base = Math.max(orc, total) || 1;
  const nComp = S.moveis.filter((m) => m.status === "comprado").length;
  const pct = (v) => Math.min(100, (v / base) * 100).toFixed(1);
  // Lua de mel
  const decidido = S.destinos.find((d) => d.status === "decidido");
  const favs = S.destinos.filter((d) => d.status === "favorito");
  const orcLua = Number(c.orcamento_lua) || 0;
  // Convidados
  const blocoEv = (ev) => {
    const l = doEvento(ev);
    const p = (st) => l.filter((x) => x.presenca === st).reduce((s, x) => s + 1 + (x.acompanhantes || 0), 0);
    const tt = totPessoas(l) || 0;
    const w = (v) => (tt ? ((v / tt) * 100).toFixed(1) : 0);
    return `<div class="card" data-aba="convidados" data-ev="${ev}">
      <div class="secao-tit" style="margin:0 0 4px"><h2>${ev === "cha" ? "🫖 Chá de panela" : "💍 Casamento"}</h2><span>${tt} pessoas</span></div>
      <div class="barra"><i class="b1" style="width:${w(p("sim"))}%"></i><i class="b2" style="width:${w(p("pendente"))}%"></i><i class="b3" style="width:${w(p("nao"))}%"></i></div>
      <div class="legenda"><span><em style="background:var(--verde)"></em>${p("sim")} confirmados</span><span><em style="background:var(--amarelo)"></em>${p("pendente")} pendentes</span><span><em style="background:#6b6a8a"></em>${p("nao")} não vão</span></div>
    </div>`;
  };

  let avisos = "";
  if (!instalado()) {
    avisos += `<div class="card vidro aviso"><div class="emo">📲</div><div class="txt"><b>Instale o app</b>${S.installPrompt ? "Fica na tela inicial, como um app normal." : "No Chrome: menu ⋮ → <b style='display:inline'>Instalar app</b>."}</div>${S.installPrompt ? '<button class="btn prim peq" data-a="instalar">Instalar</button>' : ""}</div>`;
  }
  if ("Notification" in window && Notification.permission !== "granted") {
    avisos += `<div class="card vidro aviso"><div class="emo">🔔</div><div class="txt"><b>Ative as notificações</b>Saiba quando o outro adicionar algo ou mudar um status.</div><button class="btn prim peq" data-a="notif">Ativar</button></div>`;
  }

  return `
    ${avisos}
    <div class="grade2" style="margin-top:${avisos ? 12 : 0}px">${contagem("🫖 Chá de panela", c.data_cha)}${contagem("💍 Casamento", c.data_casamento)}</div>

    <div class="secao-tit"><h2>🛋️ Móveis</h2><span>${nComp} de ${S.moveis.length} comprados</span></div>
    <div class="card" data-aba="moveis">
      <div class="grade3">
        <div class="kpi"><small>Orçamento</small><strong style="font-size:17px">${orc ? brl(orc) : "—"}</strong></div>
        <div class="kpi"><small>Comprado</small><strong style="font-size:17px;color:#6ee79a">${brl(comprado)}</strong></div>
        <div class="kpi"><small>${orc ? "Saldo" : "Falta"}</small><strong style="font-size:17px">${brl(orc ? orc - comprado : escolhido + pesquisando)}</strong></div>
      </div>
      <div class="barra"><i class="b1" style="width:${pct(comprado)}%"></i><i class="b2" style="width:${pct(escolhido)}%"></i><i class="b3" style="width:${pct(pesquisando)}%"></i></div>
      <div class="legenda"><span><em style="background:var(--verde)"></em>Comprado</span><span><em style="background:var(--amarelo)"></em>Escolhido ${brl(escolhido)}</span><span><em style="background:#6b6a8a"></em>Pesquisando ${brl(pesquisando)}</span></div>
      ${orc && total > orc ? `<div class="mini" style="color:#ff8b9b;margin-top:8px">⚠️ A lista completa (${brl(total)}) passa do orçamento em ${brl(total - orc)}.</div>` : ""}
    </div>

    <div class="secao-tit"><h2>✈️ Lua de mel</h2><span>${S.destinos.length} destinos</span></div>
    <div class="card" data-aba="lua">
      ${decidido
        ? `<div class="linha-kv"><span>Destino decidido</span><b>${esc(decidido.titulo)}</b></div><div class="linha-kv"><span>Custo estimado</span><b>${decidido.custo ? brl(decidido.custo) : "—"}</b></div>`
        : `<div class="linha-kv"><span>Favoritos</span><b>${favs.length ? esc(favs.map((f) => f.titulo).slice(0, 2).join(", ")) + (favs.length > 2 ? "…" : "") : "nenhum ainda"}</b></div>`}
      <div class="linha-kv"><span>Orçamento</span><b>${orcLua ? brl(orcLua) : "—"}</b></div>
      ${orcLua && decidido?.custo ? `<div class="barra"><i class="bg" style="width:${Math.min(100, (decidido.custo / orcLua) * 100)}%"></i></div><div class="mini">${decidido.custo > orcLua ? "⚠️ Acima do orçamento em " + brl(decidido.custo - orcLua) : "Dentro do orçamento · sobra " + brl(orcLua - decidido.custo)}</div>` : ""}
    </div>

    <div class="secao-tit"><h2>💌 Convidados</h2><span>${S.convidados.length} convites</span></div>
    ${blocoEv("cha")}${blocoEv("casamento")}
  `;
}

// ===== Móveis =====
function vMoveis() {
  const f = S.f.moveis, b = S.f.busca.toLowerCase();
  const cont = (st) => S.moveis.filter((m) => st === "todos" || m.status === st).length;
  let l = S.moveis.filter((m) => (f === "todos" || m.status === f) && (!b || `${m.titulo} ${m.comodo} ${m.site}`.toLowerCase().includes(b)));
  const chips = `<div class="chips">${["todos", ...Object.keys(ST_MOVEL)].map((k) => `<button class="chip ${f === k ? "on" : ""}" data-fm="${k}">${k === "todos" ? "Todos" : ST_MOVEL[k][0] + " " + ST_MOVEL[k][1]}<b>${cont(k)}</b></button>`).join("")}</div>`;
  const busca = `<input class="inp busca" data-busca placeholder="🔍 Buscar móvel, cômodo ou loja" value="${esc(S.f.busca)}">`;
  if (!S.moveis.length) return chips + `<div class="vazio"><span class="emo">🛋️</span>Nenhum móvel ainda.<br>Toque no <b>+</b> e cole o link da loja.</div>`;
  const grupos = {};
  for (const m of l) (grupos[m.comodo] ||= []).push(m);
  const ordem = Object.keys(grupos).sort((a, b) => (COMODOS.indexOf(a) + 99 * (COMODOS.indexOf(a) < 0)) - (COMODOS.indexOf(b) + 99 * (COMODOS.indexOf(b) < 0)));
  return chips + busca + (ordem.length ? ordem.map((g) => {
    const st = grupos[g].reduce((s, m) => s + (Number(m.preco) || 0) * (m.quantidade || 1), 0);
    return `<div class="grupo-tit">${esc(g)}<span>${grupos[g].length} · ${brl(st)}</span></div><div class="lista-moveis">${grupos[g].map(cardMovel).join("")}</div>`;
  }).join("") : `<div class="vazio">Nada encontrado com esse filtro.</div>`);
}
function cardMovel(m) {
  const pr = Number(m.preco) || 0;
  return `<div class="item ${m.status}" data-editar="moveis" data-id="${m.id}">
    <div class="foto">${img(m.imagem) || "🛋️"}</div>
    <div class="corpo">
      <h3>${esc(m.titulo)}</h3>
      <div class="meta">${esc(m.site || "")}${m.prioridade === "alta" ? " · 🔥 prioridade" : ""}</div>
      <div class="preco">${pr ? brl(pr * (m.quantidade || 1)) : "<small>sem preço</small>"}${m.quantidade > 1 ? ` <small>(${m.quantidade}× ${brl(pr)})</small>` : ""}</div>
      <div class="status-mini">${Object.entries(ST_MOVEL).map(([k, [e, n]]) => `<button class="${m.status === k ? "on" : ""}" data-st="moveis" data-id="${m.id}" data-v="${k}" aria-label="${n}">${e}</button>`).join("")}</div>
    </div>
  </div>`;
}

// ===== Lua de mel =====
function vLua() {
  const f = S.f.lua;
  const cont = (st) => S.destinos.filter((d) => st === "todos" || d.status === st).length;
  const ord = { decidido: 0, favorito: 1, ideia: 2 };
  const l = S.destinos.filter((d) => f === "todos" || d.status === f).sort((a, b) => ord[a.status] - ord[b.status]);
  const chips = `<div class="chips" style="margin-bottom:12px">${["todos", ...Object.keys(ST_DEST)].map((k) => `<button class="chip ${f === k ? "on" : ""}" data-fl="${k}">${k === "todos" ? "Todos" : ST_DEST[k][0] + " " + ST_DEST[k][1]}<b>${cont(k)}</b></button>`).join("")}</div>`;
  if (!S.destinos.length) return chips + `<div class="vazio"><span class="emo">🏝️</span>Nenhum destino ainda.<br>Toque no <b>+</b> e cole o link do hotel, pacote ou lugar.</div>`;
  return chips + (l.map((d) => `
    <div class="destino" data-editar="destinos" data-id="${d.id}">
      <div class="capa">${img(d.imagem)}🏝️<span class="selo">${ST_DEST[d.status][0]} ${ST_DEST[d.status][1]}</span></div>
      <div class="info">
        <h3>${esc(d.titulo)}</h3>
        <div class="mini">${esc([d.local, d.site].filter(Boolean).join(" · "))}</div>
        ${d.descricao ? `<div class="desc">${esc(d.descricao)}</div>` : ""}
        <div class="linha-kv"><span>${d.dias ? d.dias + " dias" : "Custo estimado"}</span><b>${d.custo ? brl(d.custo) : "—"}</b></div>
        <div class="status-mini">${Object.entries(ST_DEST).map(([k, [e, n]]) => `<button class="${d.status === k ? "on" : ""}" data-st="destinos" data-id="${d.id}" data-v="${k}">${e} <small style="font-size:12px">${n}</small></button>`).join("")}</div>
      </div>
    </div>`).join("") || `<div class="vazio">Nada nesse filtro.</div>`);
}

// ===== Convidados =====
function vConvidados() {
  const { evento, presenca, lado } = S.f, b = S.f.busca.toLowerCase();
  const base = evento === "todos" ? S.convidados : doEvento(evento);
  const l = base.filter((c) => (presenca === "todos" || c.presenca === presenca) && (lado === "todos" || c.lado === lado) && (!b || c.nome.toLowerCase().includes(b)));
  const pess = (st) => base.filter((c) => c.presenca === st).reduce((s, c) => s + 1 + (c.acompanhantes || 0), 0);
  const chipsEv = `<div class="chips">${[["todos", "Todos"], ["cha", "🫖 Chá"], ["casamento", "💍 Casamento"]].map(([k, n]) => `<button class="chip ${evento === k ? "on" : ""}" data-fe="${k}">${n}</button>`).join("")}</div>`;
  const resumo = `<div class="grade3" style="margin:12px 0">
    ${[["sim", "Confirmados", "#6ee79a"], ["pendente", "Pendentes", "#ffd27a"], ["nao", "Não vão", "#ff8b9b"]].map(([k, n, cor]) => `<button class="card kpi ${presenca === k ? "vidro" : ""}" style="text-align:left;padding:12px" data-fp="${presenca === k ? "todos" : k}"><small>${n}</small><strong style="color:${cor}">${pess(k)}</strong></button>`).join("")}
  </div>`;
  const chipsLado = `<div class="chips">${[["todos", "Todos os lados"], ["noivo", "🤵 Noivo"], ["noiva", "👰 Noiva"], ["ambos", "💜 Ambos"]].map(([k, n]) => `<button class="chip ${lado === k ? "on" : ""}" data-fla="${k}">${n}</button>`).join("")}</div>`;
  const busca = `<input class="inp busca" data-busca placeholder="🔍 Buscar convidado" value="${esc(S.f.busca)}">`;
  const acoes = `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn peq" data-a="varios">➕ Vários de uma vez</button><button class="btn peq" data-a="csv">⬇️ Exportar</button></div>`;
  if (!S.convidados.length) return chipsEv + `<div class="vazio"><span class="emo">💌</span>Nenhum convidado ainda.<br>Toque no <b>+</b> ou adicione vários de uma vez.</div>` + acoes;
  return chipsEv + resumo + chipsLado + busca + acoes + (l.map((c) => `
    <div class="conv" data-editar="convidados" data-id="${c.id}">
      <div class="av ${c.lado}">${esc(iniciais(c.nome))}</div>
      <div class="corpo">
        <div class="nome">${esc(c.nome)}${c.acompanhantes ? ` <span class="mini">+${c.acompanhantes}</span>` : ""}</div>
        <div class="meta">${LADO[c.lado]} · ${EVENTO[c.evento]}</div>
      </div>
      <div class="presenca">${Object.entries(PRES).map(([k, [s, n]]) => `<button class="${k} ${c.presenca === k ? "on" : ""}" data-pres="${k}" data-id="${c.id}" aria-label="${n}">${s}</button>`).join("")}</div>
    </div>`).join("") || `<div class="vazio">Ninguém nesse filtro.</div>`);
}

// ===== Formulários (sheet) =====
function abrirSheet(html, aoMontar) {
  fecharSheet();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet"><div class="pega"></div>${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) fecharSheet(); });
  $("#sheet-root").appendChild(bg);
  aoMontar?.(bg);
}
function fecharSheet() { $("#sheet-root").innerHTML = ""; render(); }
const opcoes = (nome, mapa, atual) => `<div class="opcoes" data-grupo="${nome}">${Object.entries(mapa).map(([k, v]) => `<button type="button" class="chip ${atual === k ? "on" : ""}" data-val="${k}">${Array.isArray(v) ? v[0] + " " + v[1] : v}</button>`).join("")}</div><input type="hidden" name="${nome}" value="${esc(atual)}">`;
function ligarOpcoes(el) {
  el.querySelectorAll("[data-grupo]").forEach((g) => g.addEventListener("click", (e) => {
    const b = e.target.closest("[data-val]"); if (!b) return;
    g.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    el.querySelector(`input[name="${g.dataset.grupo}"]`).value = b.dataset.val;
  }));
}
function botaoExcluir(el, tabela, id) {
  const b = el.querySelector("[data-excluir]"); if (!b) return;
  b.onclick = async () => {
    if (!b.dataset.conf) { b.dataset.conf = 1; b.textContent = "Toque de novo para excluir"; return; }
    if (await excluir(tabela, id)) { toast("Excluído"); fecharSheet(); }
  };
}

function formLink(tabela, item = {}) {
  const ehMovel = tabela === "moveis";
  const novo = !item.id;
  const stMap = ehMovel ? ST_MOVEL : ST_DEST;
  const comodoAtual = item.comodo || "Sala";
  abrirSheet(`
    <h2>${novo ? (ehMovel ? "Novo móvel" : "Novo destino") : "Editar"}</h2>
    <label class="campo"><span>Link (opcional) — cole e toque em Buscar</span>
      <div class="com-botao"><input class="inp" name="url" inputmode="url" placeholder="https://..." value="${esc(item.url)}"><button type="button" class="btn" data-buscar>Buscar</button></div></label>
    <div id="previa"></div>
    <label class="campo"><span>${ehMovel ? "Nome do móvel" : "Destino / hotel"}</span><input class="inp" name="titulo" value="${esc(item.titulo)}" placeholder="${ehMovel ? "Ex.: Sofá retrátil 3 lugares" : "Ex.: Porto de Galinhas – Resort"}"></label>
    ${ehMovel ? `
      <div class="linha2">
        <label class="campo"><span>Preço (unidade)</span><input class="inp" name="preco" inputmode="decimal" placeholder="0,00" value="${fmtNum(item.preco)}"></label>
        <label class="campo"><span>Quantidade</span><input class="inp" name="quantidade" type="number" min="1" value="${item.quantidade || 1}"></label>
      </div>
      <label class="campo"><span>Cômodo</span><select class="inp" name="comodo">${[...new Set([...COMODOS, comodoAtual])].map((c) => `<option ${c === comodoAtual ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label class="campo"><span>Prioridade</span>${opcoes("prioridade", { alta: "🔥 Alta", media: "Média", baixa: "Baixa" }, item.prioridade || "media")}</label>
    ` : `
      <label class="campo"><span>Local</span><input class="inp" name="local" value="${esc(item.local)}" placeholder="Cidade, estado ou país"></label>
      <div class="linha2">
        <label class="campo"><span>Custo estimado (total)</span><input class="inp" name="custo" inputmode="decimal" placeholder="0,00" value="${fmtNum(item.custo)}"></label>
        <label class="campo"><span>Dias</span><input class="inp" name="dias" type="number" min="1" value="${item.dias || ""}"></label>
      </div>
    `}
    <label class="campo"><span>Status</span>${opcoes("status", stMap, item.status || (ehMovel ? "pesquisando" : "ideia"))}</label>
    <label class="campo"><span>Descrição</span><textarea class="inp" name="descricao" placeholder="Detalhes, medidas, o que está incluso...">${esc(item.descricao)}</textarea></label>
    <label class="campo"><span>Notas do casal</span><textarea class="inp" name="notas" style="min-height:60px" placeholder="Ex.: ver ao vivo na loja, cor preferida...">${esc(item.notas)}</textarea></label>
    <input type="hidden" name="imagem" value="${esc(item.imagem)}"><input type="hidden" name="site" value="${esc(item.site)}">
    <div class="acoes">
      ${item.url ? `<a class="btn" href="${esc(urlOk(item.url) || "#")}" target="_blank" rel="noopener">🔗 Abrir</a>` : ""}
      <button class="btn prim" data-salvar>${novo ? "Adicionar" : "Salvar"}</button>
    </div>
    ${novo ? "" : `<button class="btn perigo bloco" style="margin-top:12px" data-excluir>Excluir</button>`}
  `, (el) => {
    ligarOpcoes(el);
    const v = (n) => el.querySelector(`[name="${n}"]`);
    const mostrarPrevia = () => {
      const t = v("titulo").value, im = v("imagem").value, s = v("site").value;
      el.querySelector("#previa").innerHTML = im || s ? `<div class="previa"><div class="foto">${img(im) || (ehMovel ? "🛋️" : "🏝️")}</div><div><div class="t">${esc(t || "Sem título")}</div><div class="s">${esc(s)}</div></div></div>` : "";
    };
    mostrarPrevia();
    const buscar = async () => {
      const bruto = v("url").value.trim();
      const url = urlOk(bruto) || extrairUrl(bruto);
      if (!url) return toast("Cole um link válido");
      v("url").value = url;
      const b = el.querySelector("[data-buscar]"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try {
        const { data, error } = await sb.functions.invoke("casorio-preview", { body: { url } });
        if (error) throw error;
        if (data?.ok) {
          if (data.titulo && (!v("titulo").value || !item.id)) v("titulo").value = data.titulo.slice(0, 160);
          if (data.imagem) v("imagem").value = data.imagem;
          v("site").value = data.site || "";
          if (data.descricao && !v("descricao").value) v("descricao").value = data.descricao;
          if (data.preco) v(ehMovel ? "preco" : "custo").value = fmtNum(data.preco);
          toast(data.preco ? "Informações encontradas ✨" : "Achei o produto, mas não o preço — preencha à mão");
        } else {
          v("site").value = data?.site || "";
          toast("A loja bloqueou a leitura automática. Preencha à mão 🙂");
        }
        mostrarPrevia();
      } catch (e) { console.error(e); toast("Não consegui ler o link agora"); }
      b.disabled = false; b.textContent = "Buscar";
    };
    el.querySelector("[data-buscar]").onclick = buscar;
    v("url").addEventListener("paste", () => setTimeout(buscar, 50));
    el.querySelector("[data-salvar]").onclick = async (e) => {
      const titulo = v("titulo").value.trim();
      if (!titulo) return toast("Dê um nome");
      const dados = {
        titulo, url: urlOk(v("url").value.trim()), imagem: urlOk(v("imagem").value) , site: v("site").value || null,
        descricao: v("descricao").value.trim() || null, notas: v("notas").value.trim() || null, status: v("status").value,
      };
      if (ehMovel) Object.assign(dados, { preco: num(v("preco").value), quantidade: Math.max(1, parseInt(v("quantidade").value) || 1), comodo: v("comodo").value, prioridade: v("prioridade").value });
      else Object.assign(dados, { local: v("local").value.trim() || null, custo: num(v("custo").value), dias: parseInt(v("dias").value) || null });
      e.target.disabled = true;
      if (await salvar(tabela, dados, item.id)) { toast(novo ? "Adicionado 💜" : "Salvo"); fecharSheet(); }
      else e.target.disabled = false;
    };
    botaoExcluir(el, tabela, item.id);
    if (novo && item.url && !item.titulo) buscar();
  });
}

function formConvidado(c = {}) {
  const novo = !c.id;
  abrirSheet(`
    <h2>${novo ? "Novo convidado" : "Editar convidado"}</h2>
    <label class="campo"><span>Nome</span><input class="inp" name="nome" value="${esc(c.nome)}" placeholder="Ex.: Tia Lúcia" autocomplete="off"></label>
    <label class="campo"><span>Lado</span>${opcoes("lado", { noivo: "🤵 Noivo", noiva: "👰 Noiva", ambos: "💜 Ambos" }, c.lado || "ambos")}</label>
    <label class="campo"><span>Evento</span>${opcoes("evento", { cha: "🫖 Chá", casamento: "💍 Casamento", ambos: "Os dois" }, c.evento || (S.f.evento !== "todos" ? S.f.evento : "casamento"))}</label>
    <label class="campo"><span>Acompanhantes</span>
      <div class="com-botao"><button type="button" class="btn" data-menos>−</button><input class="inp" name="acompanhantes" type="number" min="0" value="${c.acompanhantes || 0}" style="text-align:center"><button type="button" class="btn" data-mais>+</button></div></label>
    <label class="campo"><span>Presença</span>${opcoes("presenca", { sim: "✓ Confirmou", pendente: "? Pendente", nao: "✗ Não vai" }, c.presenca || "pendente")}</label>
    <label class="campo"><span>Notas</span><input class="inp" name="notas" value="${esc(c.notas)}" placeholder="Telefone, restrição alimentar..."></label>
    <div class="acoes"><button class="btn prim" data-salvar>${novo ? "Adicionar" : "Salvar"}</button></div>
    ${novo ? "" : `<button class="btn perigo bloco" style="margin-top:12px" data-excluir>Excluir</button>`}
  `, (el) => {
    ligarOpcoes(el);
    const v = (n) => el.querySelector(`[name="${n}"]`);
    el.querySelector("[data-menos]").onclick = () => (v("acompanhantes").value = Math.max(0, (+v("acompanhantes").value || 0) - 1));
    el.querySelector("[data-mais]").onclick = () => (v("acompanhantes").value = (+v("acompanhantes").value || 0) + 1);
    if (novo) setTimeout(() => v("nome").focus(), 250);
    el.querySelector("[data-salvar]").onclick = async (e) => {
      const nome = v("nome").value.trim();
      if (!nome) return toast("Digite o nome");
      e.target.disabled = true;
      const dados = { nome, lado: v("lado").value, evento: v("evento").value, presenca: v("presenca").value, acompanhantes: Math.max(0, parseInt(v("acompanhantes").value) || 0), notas: v("notas").value.trim() || null };
      if (await salvar("convidados", dados, c.id)) { toast(novo ? "Convidado adicionado 💌" : "Salvo"); fecharSheet(); }
      else e.target.disabled = false;
    };
    botaoExcluir(el, "convidados", c.id);
  });
}

function formVarios() {
  abrirSheet(`
    <h2>Adicionar vários</h2>
    <label class="campo"><span>Um nome por linha (use "+2" no fim para acompanhantes)</span>
      <textarea class="inp" name="lista" style="min-height:160px" placeholder="João Silva +1&#10;Maria Souza&#10;Família Pereira +3"></textarea></label>
    <label class="campo"><span>Lado</span>${opcoes("lado", { noivo: "🤵 Noivo", noiva: "👰 Noiva", ambos: "💜 Ambos" }, "ambos")}</label>
    <label class="campo"><span>Evento</span>${opcoes("evento", { cha: "🫖 Chá", casamento: "💍 Casamento", ambos: "Os dois" }, S.f.evento !== "todos" ? S.f.evento : "casamento")}</label>
    <div class="acoes"><button class="btn prim" data-salvar>Adicionar todos</button></div>
  `, (el) => {
    ligarOpcoes(el);
    const v = (n) => el.querySelector(`[name="${n}"]`);
    el.querySelector("[data-salvar]").onclick = async (e) => {
      const linhas = v("lista").value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!linhas.length) return toast("Digite pelo menos um nome");
      const regs = linhas.map((l) => {
        const m = l.match(/\s*\+\s*(\d+)\s*$/);
        return { nome: m ? l.slice(0, m.index).trim() : l, acompanhantes: m ? +m[1] : 0, lado: v("lado").value, evento: v("evento").value };
      }).filter((r) => r.nome);
      e.target.disabled = true;
      if (await salvar("convidados", regs)) { toast(`${regs.length} convidados adicionados 💌`); fecharSheet(); }
      else e.target.disabled = false;
    };
  });
}

function formConfig() {
  const c = S.config;
  const notif = !("Notification" in window) ? "Não suportado neste navegador" : Notification.permission === "granted" ? "Ativadas ✅" : Notification.permission === "denied" ? "Bloqueadas (libere no Chrome)" : "Desativadas";
  abrirSheet(`
    <h2>Configurações</h2>
    <div class="linha2">
      <label class="campo"><span>🫖 Data do chá</span><input class="inp" type="date" name="data_cha" value="${esc(c.data_cha)}"></label>
      <label class="campo"><span>💍 Data do casamento</span><input class="inp" type="date" name="data_casamento" value="${esc(c.data_casamento)}"></label>
    </div>
    <div class="linha2">
      <label class="campo"><span>Orçamento móveis</span><input class="inp" name="orcamento_moveis" inputmode="decimal" value="${fmtNum(c.orcamento_moveis || "")}" placeholder="0,00"></label>
      <label class="campo"><span>Orçamento lua de mel</span><input class="inp" name="orcamento_lua" inputmode="decimal" value="${fmtNum(c.orcamento_lua || "")}" placeholder="0,00"></label>
    </div>
    <button class="btn prim bloco" data-salvar>Salvar</button>
    <div class="card" style="margin-top:16px">
      <div class="linha-kv"><span>Conectado como</span><b>${esc(S.nome)}</b></div>
      <div class="linha-kv"><span>Notificações</span><b>${notif}</b></div>
    </div>
    <div class="acoes" style="margin-top:12px">
      ${"Notification" in window && Notification.permission !== "granted" ? '<button class="btn" data-a="notif">🔔 Ativar notificações</button>' : ""}
      <button class="btn" data-sair>Sair</button>
    </div>
  `, (el) => {
    const v = (n) => el.querySelector(`[name="${n}"]`);
    el.querySelector("[data-salvar]").onclick = async () => {
      const dados = { data_cha: v("data_cha").value || null, data_casamento: v("data_casamento").value || null, orcamento_moveis: num(v("orcamento_moveis").value) || 0, orcamento_lua: num(v("orcamento_lua").value) || 0 };
      const { data, error } = await sb.from("config").update(dados).eq("id", 1).select().maybeSingle();
      if (error) return toast("Erro ao salvar");
      S.config = data; toast("Salvo"); fecharSheet();
    };
    el.querySelector("[data-a='notif']")?.addEventListener("click", async () => { await ativarNotificacoes(); fecharSheet(); });
    el.querySelector("[data-sair]").onclick = async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
      await sb.auth.signOut(); $("#sheet-root").innerHTML = "";
    };
  });
}

function escolherDestinoCompartilhado() {
  const { url, titulo } = S.compartilhado; S.compartilhado = null;
  abrirSheet(`
    <h2>Salvar link em…</h2>
    <div class="previa"><div class="foto">🔗</div><div><div class="t">${esc(titulo || url)}</div><div class="s">${esc(new URL(url).hostname)}</div></div></div>
    <div class="grade2"><button class="btn prim" data-para="moveis">🛋️ Móveis</button><button class="btn prim" data-para="destinos">✈️ Lua de mel</button></div>
  `, (el) => el.querySelectorAll("[data-para]").forEach((b) => b.onclick = () => {
    const t = b.dataset.para; S.aba = t === "moveis" ? "moveis" : "lua"; location.hash = S.aba; formLink(t, { url });
  }));
}

function exportarCsv() {
  const linhas = [["Nome", "Lado", "Evento", "Acompanhantes", "Presença", "Notas"], ...S.convidados.map((c) => [c.nome, LADO[c.lado], EVENTO[c.evento], c.acompanhantes, PRES[c.presenca][1], c.notas || ""])];
  const csv = "﻿" + linhas.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "convidados.csv"; a.click();
}

// ===== Eventos (delegação) =====
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-aba],[data-a],[data-fm],[data-fl],[data-fe],[data-fp],[data-fla],[data-st],[data-pres],[data-editar]");
  if (!t || t.closest(".sheet") && !t.matches("[data-a]")) return;
  if (t.closest(".sheet") && t.matches("[data-a='notif']")) return; // tratado no formulário
  const d = t.dataset;
  if (d.st) {
    e.stopPropagation();
    const lista = S[d.st]; const it = lista.find((x) => x.id === d.id);
    if (!it || it.status === d.v) return;
    it.status = d.v; render();
    await salvar(d.st, { status: d.v }, d.id); render();
    return;
  }
  if (d.pres) {
    const it = S.convidados.find((x) => x.id === d.id);
    if (!it || it.presenca === d.pres) return;
    it.presenca = d.pres; render();
    await salvar("convidados", { presenca: d.pres }, d.id); render();
    return;
  }
  if (d.aba) {
    if (d.ev) S.f.evento = d.ev;
    S.aba = d.aba; S.f.busca = ""; location.hash = d.aba; window.scrollTo(0, 0); render(); return;
  }
  if (d.fm) { S.f.moveis = d.fm; return render(); }
  if (d.fl) { S.f.lua = d.fl; return render(); }
  if (d.fe) { S.f.evento = d.fe; return render(); }
  if (d.fp) { S.f.presenca = d.fp; return render(); }
  if (d.fla) { S.f.lado = d.fla; return render(); }
  if (d.editar) {
    const it = S[d.editar].find((x) => x.id === d.id); if (!it) return;
    return d.editar === "convidados" ? formConvidado(it) : formLink(d.editar, it);
  }
  switch (d.a) {
    case "config": return formConfig();
    case "notif": return ativarNotificacoes();
    case "instalar": if (S.installPrompt) { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; render(); } return;
    case "novo": return S.aba === "convidados" ? formConvidado() : formLink(S.aba === "moveis" ? "moveis" : "destinos");
    case "varios": return formVarios();
    case "csv": return exportarCsv();
  }
});
document.addEventListener("input", (e) => {
  if (!e.target.matches("[data-busca]")) return;
  S.f.busca = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const n = $("[data-busca]"); n.focus(); n.setSelectionRange(pos, pos);
});
window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (["painel", "moveis", "lua", "convidados"].includes(h) && h !== S.aba) { S.aba = h; render(); }
});
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && S.user) { await carregarTudo(); if (!$(".sheet-bg")) render(); }
});

// ===== Início =====
async function entrou(session) {
  S.user = session.user;
  const { data: m } = await sb.from("membros").select("nome").eq("user_id", S.user.id).maybeSingle();
  if (!m) { await sb.auth.signOut(); return telaLogin("Este usuário não tem acesso."); }
  S.nome = m.nome;
  const h = location.hash.slice(1);
  if (["painel", "moveis", "lua", "convidados"].includes(h)) S.aba = h;
  await carregarTudo();
  render();
  tempoReal();
  ativarNotificacoes(true).catch(() => {});
  if (S.compartilhado) escolherDestinoCompartilhado();
}

let iniciado = false;
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "SIGNED_OUT" || !session) { S.user = null; iniciado = false; if (S.canal) sb.removeChannel(S.canal); return telaLogin(); }
  if ((ev === "INITIAL_SESSION" || ev === "SIGNED_IN") && !iniciado) { iniciado = true; setTimeout(() => entrou(session), 0); }
});
