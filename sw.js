// SPDX-License-Identifier: AGPL-3.0-or-later
// Lectura sin conexión (ADR 0042). Con conexión se lee siempre lo publicado: primero la red y, solo si
// no responde, lo guardado. Se guarda lo que se abre y, cada vez que llega una portada nueva, las piezas
// que enlaza, para que el último número se pueda leer entero sin conexión. Solo lo de este sitio: ni el
// contador, ni los comentarios, ni los vídeos, ni el buscador. Nada sale del dispositivo.
const CACHE = 'diario-v1';
const MAX = 400;                      // páginas y archivos guardados; se quitan primero los más antiguos
const IDIOMAS = ['ca', 'gl', 'eu', 'en'];
const FIJOS = ['/sin-conexion.html', ...IDIOMAS.map(i => `/${i}/sin-conexion.html`)];
const NO_GUARDAR = /^\/(pagefind|videos)\/|\.(mp4|webm|mp3|m4a)$/;

// La dirección sin consulta: «?v=» de las hojas, «?grupo=» o «?nocontar=» no hacen otra página
function clave(url) {
  const u = new URL(url);
  return u.origin + u.pathname.replace(/\/index\.html$/, '/');
}

function idioma(path) {
  const i = path.split('/')[1];
  return IDIOMAS.includes(i) ? i : '';
}

function esPortada(path) {
  return path === '/' || IDIOMAS.some(i => path === `/${i}/`);
}

async function guardar(cache, url, resp) {
  await cache.put(clave(url), resp);
}

// Quita lo más antiguo pasado el máximo (put coloca al final lo que se vuelve a guardar)
async function recortar(cache) {
  const claves = (await cache.keys()).filter(r => !FIJOS.some(f => r.url.endsWith(f)));
  for (const r of claves.slice(0, Math.max(0, claves.length - MAX))) await cache.delete(r);
}

// Las piezas de una portada y sus dibujos, en segundo plano y sin repetir lo ya guardado
async function guardarPortada(url, html) {
  const cache = await caches.open(CACHE);
  const base = new URL(url);
  const piezas = new Set();
  for (const m of html.matchAll(/href="([^"#?]*\d{4}-\d{2}-\d{2}\/[^"#?]+\.html)"/g)) {
    const u = new URL(m[1], base);
    if (u.origin === base.origin) piezas.add(u.href);
  }
  for (const p of piezas) {
    if (await cache.match(clave(p))) continue;
    try {
      const r = await fetch(p, { credentials: 'same-origin' });
      if (!r.ok) continue;
      const texto = await r.clone().text();
      await guardar(cache, p, r);
      for (const m of texto.matchAll(/src="([^"#]+\.(?:svg|png|jpe?g|webp))"/g)) {
        const img = new URL(m[1], p);
        if (img.origin !== base.origin || await cache.match(clave(img.href))) continue;
        const ri = await fetch(img.href).catch(() => null);
        if (ri && ri.ok) await guardar(cache, img.href, ri);
      }
    } catch (_) { /* sin red a medias: se guardará otro día */ }
  }
  await recortar(cache);
}

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(FIJOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('diario-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// La primera visita se carga antes de que haya service worker: la página le pasa entonces lo que ya ha
// cargado (ella misma, las hojas, la letra, los dibujos) y él lo guarda, con la portada de su idioma y sus
// piezas. Sin esto, la primera vez no quedaría nada para leer sin conexión.
self.addEventListener('message', ev => {
  const urls = ev.data && Array.isArray(ev.data.guardar) ? ev.data.guardar : null;
  if (!urls) return;
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of urls.slice(0, 80)) {
      const url = new URL(u, location.origin);
      if (url.origin !== location.origin || NO_GUARDAR.test(url.pathname) || await cache.match(clave(url.href))) continue;
      try {
        const r = await fetch(url.href);
        if (r.ok && r.type === 'basic') await guardar(cache, url.href, r);
      } catch (_) { /* se guardará al volver a abrirla */ }
    }
    const i = idioma(new URL(urls[0], location.origin).pathname);
    const portada = `${location.origin}/${i ? i + '/' : ''}`;
    try {
      const r = await fetch(portada);
      if (r.ok) {
        const html = await r.clone().text();
        await guardar(cache, portada, r);
        await guardarPortada(portada, html);
      }
    } catch (_) { /* sin red a medias */ }
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || NO_GUARDAR.test(url.pathname)
      || req.headers.has('range')) return;
  ev.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp.type === 'error') throw new TypeError('sin red');   // Firefox, a veces, sin conexión
      if (resp.ok && resp.type === 'basic') {
        const copia = resp.clone();
        ev.waitUntil((async () => {
          const cache = await caches.open(CACHE);
          if (req.mode === 'navigate' && esPortada(url.pathname)) {
            const html = await copia.clone().text();
            await guardar(cache, req.url, copia);
            await guardarPortada(req.url, html);
          } else {
            await guardar(cache, req.url, copia);
            await recortar(cache);
          }
        })().catch(() => {}));
      }
      return resp;
    } catch (err) {
      const guardada = await caches.match(clave(req.url));
      if (guardada) return guardada;
      if (req.mode === 'navigate') {
        const i = idioma(url.pathname);
        const aviso = await caches.match(clave(`${location.origin}/${i ? i + '/' : ''}sin-conexion.html`));
        if (aviso) return aviso;
      }
      throw err;
    }
  })());
});
