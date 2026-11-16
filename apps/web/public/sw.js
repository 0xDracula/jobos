const VERSION = "v1";
const PAGES = `jobbos-pages-${VERSION}`;
const STATIC = "jobbos-static";
const API = `jobbos-api-${VERSION}`;
const ART = "jobbos-art";
const OFFLINE = "jobbos-offline-v1";
const ROUTES = ["/", "/search/", "/library/", "/playlist/", "/album/", "/artist/", "/settings/"];
const ART_LIMIT = 800;
const API_TIMEOUT_MS = 8000;

const CACHED_API = [
  /^\/api\/playlists\/?$/,
  /^\/api\/playlists\/[0-9a-f-]+$/,
  /^\/api\/likes(\/ids)?$/,
  /^\/api\/hidden(\/ids)?$/,
  /^\/api\/history\/(recent|top)$/,
  /^\/api\/albums\/[0-9a-f-]+$/,
  /^\/api\/artists\/[0-9a-f-]+$/,
  /^\/api\/tracks\/[0-9a-f-]+(\/lyrics)?$/,
  /^\/api\/me$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll(ROUTES))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC, API, ART, OFFLINE]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/media/")) return event.respondWith(media(req, path));
  if (path.startsWith("/api/")) {
    if (CACHED_API.some((re) => re.test(path))) event.respondWith(networkFirst(req, API, req.url));
    return;
  }
  if (path.startsWith("/_next/static/")) return event.respondWith(cacheFirst(req, STATIC));
  if (req.mode === "navigate") return event.respondWith(page(req, path));
  url.searchParams.delete("_rsc");
  event.respondWith(networkFirst(req, PAGES, url.toString()));
});

async function media(req, path) {
  const offline = await caches.open(OFFLINE);
  const hit = await offline.match(path);
  if (hit) return path.endsWith(".m4a") ? ranged(req, hit) : hit;
  if (path.endsWith(".jpg")) return artwork(req);
  return fetch(req);
}

async function ranged(req, res) {
  const blob = await res.blob();
  const type = res.headers.get("Content-Type") || "audio/mp4";
  const size = blob.size;
  const range = req.headers.get("Range");
  const base = { "Content-Type": type, "Accept-Ranges": "bytes" };
  if (!range) return new Response(blob, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) return new Response(blob, { status: 200, headers: { ...base, "Content-Length": String(size) } });
  let start;
  let end;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}

async function artwork(req) {
  const cache = await caches.open(ART);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - ART_LIMIT))) await cache.delete(key);
  }
  return res;
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function networkFirst(req, name, key) {
  const cache = await caches.open(name);
  try {
    const res = await withTimeout(fetch(req), API_TIMEOUT_MS);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function page(req, path) {
  const cache = await caches.open(PAGES);
  try {
    const res = await withTimeout(fetch(req), API_TIMEOUT_MS);
    if (res.ok) await cache.put(path, res.clone());
    return res;
  } catch {
    return (await cache.match(path)) || (await cache.match("/")) || Response.error();
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Jobbos", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
