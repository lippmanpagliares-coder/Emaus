const CACHE_NAME = "emaus-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { title: "Emaús", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(dados.title || "Emaús", {
      body: dados.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: dados.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((lista) => {
      for (const cliente of lista) {
        if ("focus" in cliente) return cliente.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(event.notification.data?.url || "/");
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    // "no-store" força ir sempre até a rede de verdade, ignorando o cache HTTP do
    // navegador — sem isso, o navegador podia devolver uma versão antiga da própria
    // página sem a gente perceber, mesmo com internet normal.
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
