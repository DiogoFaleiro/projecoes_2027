// Service worker do Mayedi: cache do app + notificações push
const CACHE = "mayedi-v8";
const ARQUIVOS = ["./", "./index.html", "./css/app.css", "./js/app.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/badge-96.png", "./img/diogo.jpg", "./img/may.jpg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Nunca cachear a API do Supabase
  if (url.hostname.endsWith("supabase.co")) return;
  const mesmoSite = url.origin === self.location.origin;
  const libs = ["esm.sh", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname);
  if (!mesmoSite && !libs) return;
  // Rede primeiro para o app (sempre a versão mais nova), cache como reserva offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((r) => r || caches.match("./index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Mayedi", body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Mayedi", {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-96.png",
    tag: d.tag,
    renotify: !!d.tag,
    vibrate: [80, 40, 80],
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ("focus" in c) { c.navigate(alvo).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(alvo);
  }));
});
