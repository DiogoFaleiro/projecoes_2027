// Envia notificação push para o outro membro do casal.
// Chamada pelo trigger casorio.notificar() via pg_net (header x-casorio-secret).
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const STATUS: Record<string, string> = {
  pesquisando: "Pesquisando 🔎", escolhido: "Escolhido ⭐", comprado: "Comprado ✅",
  ideia: "Ideia 💭", favorito: "Favorito ❤️", decidido: "Decidido ✈️",
};
const EVENTO: Record<string, string> = { cha: "chá de panela", casamento: "casamento", ambos: "chá e casamento" };

function mensagem(tabela: string, op: string, r: any, quem: string) {
  if (tabela === "moveis") {
    return op === "INSERT"
      ? { title: "🛋️ Novo móvel na lista", body: `${quem} adicionou: ${r.titulo}`, url: "./#moveis" }
      : { title: "🛋️ Móvel atualizado", body: `${r.titulo} → ${STATUS[r.status] || r.status} (por ${quem})`, url: "./#moveis" };
  }
  if (tabela === "destinos") {
    return op === "INSERT"
      ? { title: "✈️ Novo destino de lua de mel", body: `${quem} sugeriu: ${r.titulo}`, url: "./#lua" }
      : { title: "✈️ Lua de mel atualizada", body: `${r.titulo} → ${STATUS[r.status] || r.status} (por ${quem})`, url: "./#lua" };
  }
  if (tabela === "convidados") {
    if (op === "INSERT") return { title: "💌 Novo convidado", body: `${quem} adicionou ${r.nome} (${EVENTO[r.evento] || r.evento})`, url: "./#convidados" };
    const p = r.presenca === "sim" ? "confirmou presença 🎉" : r.presenca === "nao" ? "não vai poder ir" : "voltou para pendente";
    return { title: "💌 Lista de convidados", body: `${r.nome} ${p}`, url: "./#convidados" };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("método", { status: 405 });
  const rows = await sql`select name, decrypted_secret from vault.decrypted_secrets where name like 'casorio_%'`;
  const s = Object.fromEntries(rows.map((r) => [r.name, r.decrypted_secret]));
  if (!s.casorio_push_secret || req.headers.get("x-casorio-secret") !== s.casorio_push_secret) {
    return new Response("não autorizado", { status: 401 });
  }

  const { tabela, op, record, actor } = await req.json();
  const [m] = actor ? await sql`select nome from casorio.membros where user_id = ${actor}` : [];
  const msg = mensagem(tabela, op, record, m?.nome || "Alguém");
  if (!msg) return new Response(JSON.stringify({ enviados: 0 }));

  webpush.setVapidDetails("mailto:contato@projecoes2027.app", s.casorio_vapid_public, s.casorio_vapid_private);
  const subs = actor
    ? await sql`select * from casorio.push_subs where user_id <> ${actor}`
    : await sql`select * from casorio.push_subs`;

  let enviados = 0;
  const payload = JSON.stringify({ ...msg, tag: `${tabela}-${record?.id}` });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
      enviados++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await sql`delete from casorio.push_subs where id = ${sub.id}`;
      else console.error("push falhou", e?.statusCode, e?.body);
    }
  }));
  return new Response(JSON.stringify({ enviados, total: subs.length }), { headers: { "Content-Type": "application/json" } });
});
