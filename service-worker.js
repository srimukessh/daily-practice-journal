/* Offline app-shell cache. Bump CACHE when you change static files to force an update. */
const CACHE = "daily-practice-v12";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Web Push: show the reminder even when the app is closed.
self.addEventListener("push", (e) => {
  let payload = { title: "Daily Practice", body: "Time for your practice." };
  try { if (e.data) payload = { ...payload, ...e.data.json() }; } catch (_) {}
  e.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "daily-practice-reminder",
  }));
});

// Tapping a reminder focuses the app (or opens it).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow("./");
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never cache Supabase writes
  const url = new URL(req.url);
  // Supabase REST/auth calls: always go to network (data must be live)
  if (/supabase\.co$/.test(url.hostname)) return;

  // App shell + CDN lib: cache-first, then network, and refresh cache in background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok && (url.origin === location.origin || url.hostname.includes("jsdelivr"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
