// SPDX-License-Identifier: AGPL-3.0-or-later
// Compartir un artículo como imagen (ADR 0090). La tarjeta (cabecera del diario, número y fecha, sección,
// titular, entradilla y dibujo) la dibuja el navegador de quien lee, con lo que ya hay en la página: no se
// guarda en el sitio ni se pide a ningún servidor. El botón ofrece copiarla, guardarla y, donde el dispositivo
// tiene menú de compartir (el móvil, la app), compartirla con el titular y el enlace.
(function () {
  var boton = document.querySelector('button.como-imagen');
  if (!boton || !window.HTMLCanvasElement) return;

  var W = 1080, H = 1350, M = 72, ANCHO = W - 2 * M;
  var TINTA = '#16181d', GRIS = '#4f5562', ROJO = '#c42b1c', PAPEL = '#fbfbf9';
  // Los colores de cada sección en el tema claro (comun.css), aunque quien lee tenga el oscuro
  var SEC = {
    herramientas: ['#1c3faa', '#e6ebf8'], debates: ['#b04f0c', '#fbeadb'], vibecoding: ['#1d7547', '#e2f1e8'],
    multimedia: ['#a8206f', '#fae4f0'], novedades: ['#6a3d9e', '#eee6f7'], vineta: ['#8a6400', '#fff3c4'],
    reportaje: ['#1c3faa', '#eef1fa'], biblioteca: ['#0b6e79', '#e0f2f3'], 'hace-un-ano': ['#7a4f2a', '#f6ede3']
  };
  var LETRA = "Newsreader, Georgia, serif";

  function texto(sel, dentro) {
    var n = (dentro || document).querySelector(sel);
    return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function datos() {
    var art = document.querySelector('main article') || document;
    var clase = (art.className || '').match(/sec-([\w-]+)/);
    var col = SEC[clase && clase[1]] || ['#1c3faa', '#f1f2f4'];
    var num = document.querySelector('.edicion-num .numero');
    var imagen = art.querySelector('[data-pagefind-meta^="imagen:"]');
    var canon = document.querySelector('link[rel="canonical"]');
    var url = canon ? canon.href : location.href.split(/[?#]/)[0];
    return {
      diario: (document.querySelector('meta[property="og:site_name"]') || {}).content || '',
      num: num ? texto('[aria-hidden]', num) + ' ' + texto('b', num) : '',
      fecha: texto('.cabecera .cuando'),
      seccion: texto('.seccion a', art) || texto('.antetitulo', art),
      titular: texto('h1.titular', art),
      entradilla: texto('.entradilla', art),
      imagen: imagen ? imagen.getAttribute('data-pagefind-meta').slice(7) : '',
      color: col[0], tinte: col[1], url: url,
      nombre: url.replace(/\.html$/, '').split('/').slice(-2).join('-')
    };
  }

  // Parte un texto en líneas que caben en el ancho, con la letra que ya tiene puesta el lienzo
  function lineas(c, t, ancho) {
    var res = [], l = '';
    t.split(' ').forEach(function (p) {
      var prueba = l ? l + ' ' + p : p;
      if (!l || c.measureText(prueba).width <= ancho) l = prueba; else { res.push(l); l = p; }
    });
    if (l) res.push(l);
    return res;
  }

  // El tamaño más grande, entre dos, con el que el texto no pasa de unas líneas
  function ajusta(c, t, peso, mayor, menor, max) {
    for (var s = mayor; s >= menor; s -= 2) {
      c.font = peso + ' ' + s + 'px ' + LETRA;
      var ls = lineas(c, t, ANCHO);
      if (ls.length <= max || s === menor) return { s: s, ls: ls, peso: peso };
    }
  }

  function enDataUrl(blob) {
    return new Promise(function (ok, mal) {
      var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = mal; r.readAsDataURL(blob);
    });
  }

  // El dibujo. Un SVG puesto como imagen no ve las letras de la página: se le meten dentro, si las usa
  function dibujo(ruta) {
    if (!ruta) return Promise.resolve(null);
    var carga = function (src) {
      return new Promise(function (ok) {
        var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src;
      });
    };
    if (!/\.svg$/.test(ruta)) return carga(ruta);
    return fetch(ruta).then(function (r) { return r.ok ? r.text() : Promise.reject(); }).then(function (svg) {
      var hoja = document.querySelector('link[href*="fuentes.css"]');
      var letras = hoja && /Newsreader/.test(svg) ? Promise.all(['normal', 'italic'].map(function (estilo) {
        var u = new URL('fuentes/newsreader-' + estilo + '-latin.woff2', hoja.href).href;
        return fetch(u).then(function (r) { return r.blob(); }).then(enDataUrl).then(function (d) {
          return "@font-face{font-family:'Newsreader';font-style:" + estilo + ";font-weight:200 800;src:url(" + d + ") format('woff2')}";
        });
      })).catch(function () { return []; }) : Promise.resolve([]);
      return letras.then(function (ff) {
        var vb = (svg.match(/viewBox="([\d.\s-]+)"/) || [])[1];
        var p = vb ? vb.trim().split(/\s+/).map(Number) : [0, 0, 600, 340];
        svg = svg.replace(/<\?xml[^>]*\?>/, '').replace(/<svg\b/, '<svg width="' + p[2] * 2 + '" height="' + p[3] * 2 + '"')
          .replace(/(<svg\b[^>]*>)/, '$1' + (ff.length ? '<style>' + ff.join('') + '</style>' : ''));
        var u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        return carga(u).then(function (im) { setTimeout(function () { URL.revokeObjectURL(u); }, 1000); return im; });
      });
    }).catch(function () { return null; });
  }

  function tarjeta(d, im) {
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = PAPEL; c.fillRect(0, 0, W, H);
    c.textBaseline = 'alphabetic';
    var y = M;
    // Cabecera: el nombre del diario, el filete doble y el número con la fecha
    c.fillStyle = TINTA; c.font = '800 66px ' + LETRA;
    c.fillText(d.diario, M, y + 52); y += 52 + 26;
    c.fillRect(M, y, ANCHO, 4); c.fillRect(M, y + 9, ANCHO, 2); y += 11 + 42;
    c.font = '700 30px ' + LETRA; c.fillStyle = ROJO; c.fillText(d.num, M, y);
    var x = M + c.measureText(d.num).width;
    c.font = 'italic 400 30px ' + LETRA; c.fillStyle = GRIS;
    c.fillText((d.num ? ' · ' : '') + d.fecha, x, y); y += 64;
    // Sección, titular y entradilla
    if (d.seccion) {
      c.font = '700 25px ' + LETRA; c.fillStyle = d.color;
      if ('letterSpacing' in c) c.letterSpacing = '2px';
      c.fillText(d.seccion.toLocaleUpperCase(document.documentElement.lang || undefined), M, y + 22);
      if ('letterSpacing' in c) c.letterSpacing = '0px';
      y += 22 + 30;
    }
    var tit = ajusta(c, d.titular, '700', 66, 44, 5);
    var ent = d.entradilla ? ajusta(c, d.entradilla, '400', 36, 28, 6) : null;
    var pie = H - M - 30;   // la línea de la dirección
    // Si no cabe todo, se acorta la entradilla; el titular, nunca
    var altoTit = tit.ls.length * tit.s * 1.12, li = ent ? ent.s * 1.42 : 0;
    var queda = pie - 60 - (y + altoTit + 28);
    if (ent && ent.ls.length * li > queda) {
      var n = Math.max(1, Math.floor(queda / li));
      c.font = ent.peso + ' ' + ent.s + 'px ' + LETRA;
      while (ent.ls.length > n) ent.ls.pop();
      var u = ent.ls[n - 1];
      while (u && c.measureText(u + '…').width > ANCHO) u = u.replace(/\s*\S+$/, '');
      ent.ls[n - 1] = u + '…';
    }
    c.fillStyle = TINTA;
    c.font = tit.peso + ' ' + tit.s + 'px ' + LETRA;
    tit.ls.forEach(function (l) { y += tit.s * 1.12; c.fillText(l, M, y - tit.s * 0.22); });
    if (ent) {
      y += 28; c.font = ent.peso + ' ' + ent.s + 'px ' + LETRA;
      ent.ls.forEach(function (l) { y += li; c.fillText(l, M, y - li * 0.3); });
    }
    // El dibujo, en el hueco que quede, sobre el tinte de su sección
    var arriba = y + 40, abajo = pie - 56, hueco = abajo - arriba;
    if (im && hueco >= 220) {
      var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      var pad = 24, k = Math.min((ANCHO - 2 * pad) / iw, (hueco - 2 * pad) / ih);
      var dw = iw * k, dh = ih * k, cx = M + (ANCHO - dw) / 2 - pad, ch = dh + 2 * pad;
      var cy = arriba + (hueco - ch) / 2;
      c.fillStyle = d.tinte; c.fillRect(cx, cy, dw + 2 * pad, ch);
      c.drawImage(im, cx + pad, cy + pad, dw, dh);
    }
    // Pie: la dirección del diario
    c.fillStyle = TINTA; c.fillRect(M, pie - 28, ANCHO, 2);
    c.font = 'italic 400 28px ' + LETRA; c.fillStyle = GRIS;
    c.fillText(new URL(d.url).host, M, pie + 12);
    return cv;
  }

  function prepara() {
    var d = datos();
    var letras = document.fonts ? Promise.all(['800 66px', '700 66px', '400 36px', 'italic 400 30px'].map(function (f) {
      return document.fonts.load(f + ' Newsreader');
    })).catch(function () {}) : Promise.resolve();
    return Promise.all([letras, dibujo(d.imagen)]).then(function (r) {
      var cv = tarjeta(d, r[1]);
      return new Promise(function (ok) { cv.toBlob(function (b) { ok({ blob: b, d: d }); }, 'image/png'); });
    });
  }

  function descarga(blob, nombre) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }

  // Se prepara antes de que se pulse, cuando el botón está cerca de verse: Safari solo deja abrir el menú
  // de compartir justo al pulsar, sin esperas por medio
  var lista = null;
  function pide() { if (!lista) lista = prepara(); return lista; }
  if ('IntersectionObserver' in window) {
    var ob = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { ob.disconnect(); pide(); }
    }, { rootMargin: '600px' });
    ob.observe(boton);
  }

  // La imagen, al portapapeles, para pegarla donde se quiera
  function copia(blob) {
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && window.isSecureContext)) return Promise.reject();
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  // «Imagen copiada», en la opción y para quien no lo ve (la misma región viva que el resto de la página)
  function hecho(op, t) {
    var r = op.querySelector('span'), antes = r.textContent;
    r.textContent = t; op.classList.add('hecho');
    var v = document.getElementById('aviso-lector');
    if (!v) { v = document.createElement('p'); v.id = 'aviso-lector'; v.className = 'solo-lector'; v.setAttribute('role', 'status'); document.body.appendChild(v); }
    v.textContent = ''; setTimeout(function () { v.textContent = t; }, 60);
    setTimeout(function () { r.textContent = antes; op.classList.remove('hecho'); cierra(); }, 1600);
  }

  // El botón despliega tres opciones: compartir (solo donde el dispositivo tiene menú de compartir: el móvil, la
  // app), copiar y guardar. Se cierra al pulsar fuera o con Escape, como «Para tu web»
  var menu = document.getElementById('menu-imagen');
  if (!menu) return;
  var opCompartir = menu.querySelector('[data-accion="compartir"]');
  if (navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) opCompartir.hidden = false;
  if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && window.isSecureContext))
    menu.querySelector('[data-accion="copiar"]').hidden = true;
  function cierra() { if (!menu.hidden) { menu.hidden = true; boton.setAttribute('aria-expanded', 'false'); } }
  boton.addEventListener('click', function (ev) {
    ev.stopPropagation(); pide();
    var abre = menu.hidden; menu.hidden = !abre; boton.setAttribute('aria-expanded', abre ? 'true' : 'false');
    if (abre) menu.querySelector('.imagen-op:not([hidden])').focus();
  });
  document.addEventListener('click', function (ev) { if (!menu.hidden && !menu.contains(ev.target) && !boton.contains(ev.target)) cierra(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !menu.hidden) { cierra(); boton.focus(); } });

  [].forEach.call(menu.querySelectorAll('.imagen-op'), function (op) {
    op.addEventListener('click', function () {
      op.disabled = true;
      pide().then(function (r) {
        var nombre = 'diario-ia-educativa-' + r.d.nombre + '.png';
        var accion = op.dataset.accion;
        if (accion === 'compartir') {
          var f = new File([r.blob], nombre, { type: 'image/png' });
          return navigator.share({ files: [f], title: r.d.titular, text: r.d.titular + '\n' + r.d.url })
            .then(cierra, function (e) { if (e && e.name === 'AbortError') cierra(); else descarga(r.blob, nombre); });
        }
        if (accion === 'copiar') return copia(r.blob).then(function () { hecho(op, op.dataset.hecho); }, function () { descarga(r.blob, nombre); cierra(); });
        descarga(r.blob, nombre); cierra();
      }).catch(function () {}).then(function () { op.disabled = false; });
    });
  });
})();
