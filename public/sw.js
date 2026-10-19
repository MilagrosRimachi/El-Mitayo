/* ============================================================
   Service worker de El Mitayo
   Guarda en el equipo lo necesario para que la pantalla de Vender
   abra y funcione sin internet:
   * la pantalla de Vender (la última vez que se abrió con internet)
   * los archivos del programa (/_next/static) y el logo
   Todo lo demás va siempre a internet.
   ============================================================ */

const VERSION = "mitayo-v3";
const PAGINAS = `${VERSION}-paginas`;
const ARCHIVOS = `${VERSION}-archivos`;
const MAX_ARCHIVOS = 600;

// Pantallas que se guardan para abrir sin internet
const PAGINAS_OFFLINE = ["/protected/vender", "/protected/ventas"];

const PRECARGA = [
  "/offline.html",
  "/logo-emblema.png",
  "/icons/icon-192.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ARCHIVOS)
      .then((c) => Promise.all(PRECARGA.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((n) => !n.startsWith(`${VERSION}-`)).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

/* Evita que el almacenamiento crezca sin fin (borra los archivos más antiguos) */
async function recortar() {
  const c = await caches.open(ARCHIVOS);
  const claves = await c.keys();
  if (claves.length <= MAX_ARCHIVOS) return;
  await Promise.all(claves.slice(0, claves.length - MAX_ARCHIVOS).map((k) => c.delete(k)));
}

function esArchivoEstatico(url) {
  return url.pathname.startsWith("/_next/static/");
}

function esImagenPublica(url) {
  return /\.(png|svg|ico|jpg|jpeg|webp)$/i.test(url.pathname) || PRECARGA.includes(url.pathname);
}

/* Navegación con internet primero; si no hay (o tarda), la copia guardada */
async function navegar(request) {
  const url = new URL(request.url);
  const guardable = PAGINAS_OFFLINE.includes(url.pathname);

  try {
    const respuesta = await Promise.race([
      fetch(request),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("tiempo")), guardable ? 7000 : 20000)),
    ]);

    // Solo se guarda una pantalla completa y sin redirección (si la sesión venció, va al login)
    if (
      guardable &&
      respuesta.ok &&
      !respuesta.redirected &&
      (respuesta.headers.get("content-type") || "").includes("text/html")
    ) {
      const copia = respuesta.clone();
      caches.open(PAGINAS).then((c) => c.put(url.pathname, copia));
    }

    return respuesta;
  } catch (e) {
    if (guardable) {
      const guardada = await caches.match(url.pathname, { cacheName: PAGINAS });
      if (guardada) return guardada;
    }

    const offline = await caches.match("/offline.html");
    return offline || Response.error();
  }
}

/* Archivos del programa: nunca cambian (tienen su huella en el nombre) */
async function archivo(request) {
  const guardado = await caches.match(request, { cacheName: ARCHIVOS });
  if (guardado) return guardado;

  const respuesta = await fetch(request);

  if (respuesta.ok) {
    const copia = respuesta.clone();
    caches.open(ARCHIVOS).then((c) => c.put(request, copia)).then(recortar);
  }

  return respuesta;
}

/* Logo, íconos: se usa lo guardado y se actualiza por detrás */
async function imagen(request) {
  const guardado = await caches.match(request, { cacheName: ARCHIVOS });

  const red = fetch(request)
    .then((r) => {
      if (r.ok) {
        const copia = r.clone();
        caches.open(ARCHIVOS).then((c) => c.put(request, copia));
      }
      return r;
    })
    .catch(() => null);

  return guardado || (await red) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navegar(request));
    return;
  }

  if (esArchivoEstatico(url)) {
    event.respondWith(archivo(request));
    return;
  }

  // El aviso de conexión consulta el manifiesto: siempre a internet
  if (url.searchParams.has("ping")) return;

  if (esImagenPublica(url)) {
    event.respondWith(imagen(request));
  }
});

/* La plataforma avisa qué archivos ya cargó, para guardarlos también */
self.addEventListener("message", (event) => {
  const datos = event.data || {};

  if (datos.tipo !== "guardar") return;

  event.waitUntil(
    (async () => {
      const c = await caches.open(ARCHIVOS);

      for (const u of datos.urls || []) {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || !esArchivoEstatico(url)) continue;
          if (await c.match(url.href)) continue;
          const r = await fetch(url.href);
          if (r.ok) await c.put(url.href, r);
        } catch (e) {
          // se intentará la próxima vez
        }
      }

      for (const p of datos.paginas || []) {
        try {
          if (!PAGINAS_OFFLINE.includes(p)) continue;
          if (await caches.match(p, { cacheName: PAGINAS })) continue;
          const r = await fetch(p, { credentials: "same-origin" });
          if (r.ok && !r.redirected && (r.headers.get("content-type") || "").includes("text/html")) {
            await (await caches.open(PAGINAS)).put(p, r);
          }
        } catch (e) {
          // nada
        }
      }

      await recortar();
    })()
  );
});
