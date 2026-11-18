// SPDX-License-Identifier: AGPL-3.0-or-later
// Compartir un artículo o una viñeta (ADR 0090): el botón «Compartir» despliega todas las formas de hacerlo. El enlace se
// comparte con el menú de compartir del sistema o, donde no lo hay (el ordenador con Linux, Firefox), se copia.
// La imagen (cabecera del diario, número y fecha, sección, titular, entradilla y dibujo) la dibuja el navegador
// de quien lee, con lo que ya hay en la página: no se guarda en el sitio ni se pide a ningún servidor. Se puede
// compartir (donde hay menú), copiar o guardar. La de la viñeta, en horizontal, con los tres paneles.
// Una página puede tener varios botones (un artículo y su viñeta) y cargar este archivo más de una vez.
(function () {
  if (window.__compartirDiario) return;
  window.__compartirDiario = true;
  var botones = document.querySelectorAll('button.abre-compartir');
  if (!botones.length || !window.HTMLCanvasElement) return;

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

  function carga(src) {
    return new Promise(function (ok) {
      var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src;
    });
  }

  // Un SVG puesto como imagen no ve las letras de la página: se le meten dentro (Newsreader, normal y cursiva)
  var letrasListas = null;
  function letrasSvg() {
    if (letrasListas) return letrasListas;
    var hoja = document.querySelector('link[href*="fuentes.css"]');
    letrasListas = !hoja ? Promise.resolve('') : Promise.all(['normal', 'italic'].map(function (estilo) {
      var u = new URL('fuentes/newsreader-' + estilo + '-latin.woff2', hoja.href).href;
      return fetch(u).then(function (r) { return r.blob(); }).then(enDataUrl).then(function (d) {
        return "@font-face{font-family:'Newsreader';font-style:" + estilo + ";font-weight:200 800;src:url(" + d + ") format('woff2')}";
      });
    })).then(function (ff) { return ff.join(''); }).catch(function () { return ''; });
    return letrasListas;
  }

  // Un SVG en texto, como imagen: con su tamaño y, dentro, las letras y los estilos que necesite
  function svgImagen(svg, css) {
    return letrasSvg().then(function (ff) {
      var vb = (svg.match(/viewBox="([\d.\s-]+)"/) || [])[1];
      var p = vb ? vb.trim().split(/\s+/).map(Number) : [0, 0, 600, 340];
      var estilo = (/Newsreader/.test(svg + css) ? ff : '') + (css || '');
      svg = svg.replace(/<\?xml[^>]*\?>/, '').replace(/<svg\b/, '<svg width="' + p[2] * 2 + '" height="' + p[3] * 2 + '"')
        .replace(/(<svg\b[^>]*>)/, '$1' + (estilo ? '<style>' + estilo + '</style>' : ''));
      var u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      return carga(u).then(function (im) { setTimeout(function () { URL.revokeObjectURL(u); }, 1000); return im; });
    });
  }

  // El dibujo de un artículo: una captura (PNG, JPG) o un SVG suelto
  function dibujo(ruta) {
    if (!ruta) return Promise.resolve(null);
    if (!/\.svg$/.test(ruta)) return carga(ruta);
    return fetch(ruta).then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function (svg) { return svgImagen(svg, ''); }).catch(function () { return null; });
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

  function letrasPagina() {
    return document.fonts ? Promise.all(['800 66px', '700 66px', '400 36px', 'italic 400 30px'].map(function (f) {
      return document.fonts.load(f + ' Newsreader');
    })).catch(function () {}) : Promise.resolve();
  }

  function enPng(cv, d) {
    return new Promise(function (ok) { cv.toBlob(function (b) { ok({ blob: b, d: d }); }, 'image/png'); });
  }

  function preparaArticulo() {
    var d = datos();
    return Promise.all([letrasPagina(), dibujo(d.imagen)]).then(function (r) { return enPng(tarjeta(d, r[1]), d); });
  }

  // ---------- La viñeta ----------

  // Los colores del tema claro, para los estilos de los paneles (comun.css), aunque quien lee tenga el oscuro
  var CLARO = {
    papel: PAPEL, 'papel-2': '#f1f2f4', tinta: TINTA, 'tinta-2': GRIS, filete: '#cfd2d8', azul: '#1c3faa',
    rojo: '#c8202c', verde: '#1a7f37', 'ilu-relleno': '#dfe5f7', 'ilu-tinta': TINTA, 'ilu-azul': '#1c3faa',
    'ilu-rojo': '#c8202c', tiza: '#ffffff', cara: TINTA
  };
  // Los paneles se dibujan con las reglas «.vineta …» de las hojas de la página: se copian dentro de cada SVG,
  // sin el «.vineta» de delante y con los colores claros
  var cssVinetaListo = null;
  function cssVineta() {
    if (cssVinetaListo !== null) return cssVinetaListo;
    var out = [];
    [].forEach.call(document.styleSheets, function (h) {
      var rs; try { rs = h.cssRules; } catch (_) { return; }
      [].forEach.call(rs || [], function (r) {
        if (r.type === 1 && /\.vineta\s/.test(r.selectorText)) out.push(r.selectorText.replace(/\.vineta\s+/g, '') + '{' + r.style.cssText + '}');
      });
    });
    cssVinetaListo = out.join('').replace(/var\(--([\w-]+)(?:,[^)]*)?\)/g, function (m, n) { return CLARO[n] || TINTA; });
    return cssVinetaListo;
  }

  function datosVineta(boton) {
    var sec = boton.closest('.vineta');
    return {
      diario: (document.querySelector('meta[property="og:site_name"]') || {}).content || '',
      titulo: boton.dataset.titulo, fecha: boton.dataset.fecha, url: boton.dataset.url, nombre: boton.dataset.nombre,
      origen: boton.dataset.origen || '',
      titular: boton.dataset.titulo + ' · ' + boton.dataset.fecha,
      paneles: [].slice.call(sec.querySelectorAll('.tira svg'))
    };
  }

  // En horizontal: la cabecera en una línea, los tres paneles en fila, de qué noticia sale (lo que sitúa la tira)
  // y el nombre del sitio al pie
  function tarjetaVineta(d, ims) {
    var VW = 1920, VM = 60, GAP = 30, n = ims.length || 1;
    var pw = (VW - 2 * VM - GAP * (n - 1)) / n, ph = 0;
    ims.forEach(function (im) { if (im) ph = Math.max(ph, pw * (im.naturalHeight || im.height) / (im.naturalWidth || im.width)); });
    ph = ph || pw * 0.9;
    var cv = document.createElement('canvas'), c = cv.getContext('2d');
    // «A partir de «titular».», en una o dos líneas, en redonda; más pequeño si no cabe
    var orig = null;
    if (d.origen) {
      for (var so = 32; so >= 24; so -= 2) {
        c.font = '400 ' + so + 'px ' + LETRA;
        var lo = lineas(c, d.origen, VW - 2 * VM);
        if (lo.length <= 2 || so === 24) { orig = { s: so, ls: lo.slice(0, 2) }; break; }
      }
    }
    var arriba = 170, bajo = arriba + ph + (orig ? 30 + orig.ls.length * orig.s * 1.35 : 0);
    var pie = bajo + 30, VH = pie + 98;
    cv.width = VW; cv.height = VH;
    c.fillStyle = PAPEL; c.fillRect(0, 0, VW, VH);
    c.fillStyle = TINTA; c.font = '800 46px ' + LETRA; c.textBaseline = 'alphabetic';
    c.fillText(d.diario, VM, 100);
    var izq = VM + c.measureText(d.diario).width + 40;
    // A la derecha, el título de la viñeta y la fecha, más pequeños si no caben
    for (var s = 30; s >= 20; s -= 2) {
      c.font = 'italic 400 ' + s + 'px ' + LETRA; var wf = c.measureText(' · ' + d.fecha).width;
      c.font = '700 ' + s + 'px ' + LETRA; var wt = c.measureText(d.titulo).width;
      if (VW - VM - wf - wt >= izq || s === 20) break;
    }
    c.textAlign = 'right';
    c.font = 'italic 400 ' + s + 'px ' + LETRA; c.fillStyle = GRIS; c.fillText(' · ' + d.fecha, VW - VM, 100);
    c.font = '700 ' + s + 'px ' + LETRA; c.fillStyle = SEC.vineta[0]; c.fillText(d.titulo, VW - VM - wf, 100);
    c.textAlign = 'left';
    c.fillStyle = TINTA; c.fillRect(VM, 124, VW - 2 * VM, 4); c.fillRect(VM, 133, VW - 2 * VM, 2);
    ims.forEach(function (im, i) { if (im) c.drawImage(im, VM + i * (pw + GAP), arriba, pw, ph); });
    if (orig) {
      c.font = '400 ' + orig.s + 'px ' + LETRA; c.fillStyle = GRIS;
      orig.ls.forEach(function (l, i) { c.fillText(l, VM, arriba + ph + 30 + (i + 1) * orig.s * 1.35 - orig.s * 0.35); });
    }
    c.fillStyle = TINTA; c.fillRect(VM, pie, VW - 2 * VM, 2);
    c.font = 'italic 400 28px ' + LETRA; c.fillStyle = GRIS;
    c.fillText(new URL(d.url).host, VM, pie + 50);
    return cv;
  }

  function preparaVineta(boton) {
    var d = datosVineta(boton), css = cssVineta();
    var ims = Promise.all(d.paneles.map(function (svg) {
      return svgImagen(new XMLSerializer().serializeToString(svg), css);
    }));
    return Promise.all([letrasPagina(), ims]).then(function (r) { return enPng(tarjetaVineta(d, r[1]), d); });
  }

  function descarga(blob, nombre) {
    var a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
  }

  // La imagen, al portapapeles, para pegarla donde se quiera
  function copia(blob) {
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && window.isSecureContext)) return Promise.reject();
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  // «Copiado», en la opción y para quien no lo ve (la misma región viva que el resto de la página)
  function hecho(op, t, cierra) {
    var r = op.querySelector('span'), antes = r.textContent;
    r.textContent = t; op.classList.add('hecho');
    var v = document.getElementById('aviso-lector');
    if (!v) { v = document.createElement('p'); v.id = 'aviso-lector'; v.className = 'solo-lector'; v.setAttribute('role', 'status'); document.body.appendChild(v); }
    v.textContent = ''; setTimeout(function () { v.textContent = t; }, 60);
    setTimeout(function () { r.textContent = antes; op.classList.remove('hecho'); cierra(); }, 1600);
  }

  // Copiar texto: el portapapeles o, si no lo deja (sin HTTPS), un campo oculto
  function copiaTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto);
    return new Promise(function (ok, mal) {
      var t = document.createElement('textarea'); t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select(); try { document.execCommand('copy') ? ok() : mal(); } catch (x) { mal(x); } t.remove();
    });
  }

  // Las opciones que salen dependen de lo que deja el navegador: compartir (el enlace o la imagen) solo donde hay
  // menú de compartir del sistema, y entonces no hace falta copiar el enlace; copiar la imagen, donde se puede.
  // Se cierra al pulsar fuera o con Escape, como «Para tu web»
  function monta(boton) {
    var menu = document.getElementById(boton.getAttribute('aria-controls'));
    if (!menu) return;
    var esVineta = !!boton.closest('.vineta');
    // Se prepara antes de que se pulse, cuando el botón está cerca de verse: Safari solo deja abrir el menú
    // de compartir justo al pulsar, sin esperas por medio
    var lista = null;
    function pide() { if (!lista) lista = esVineta ? preparaVineta(boton) : preparaArticulo(); return lista; }
    if ('IntersectionObserver' in window) {
      var ob = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { ob.disconnect(); pide(); }
      }, { rootMargin: '600px' });
      ob.observe(boton);
    }
    var op = function (a) { return menu.querySelector('[data-accion="' + a + '"]'); };
    if (navigator.share) { op('enlace').hidden = false; op('copiar-enlace').hidden = true; }
    if (navigator.canShare && window.File && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) op('imagen').hidden = false;
    if (!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && window.isSecureContext)) op('copiar-imagen').hidden = true;
    function cierra() { if (!menu.hidden) { menu.hidden = true; boton.setAttribute('aria-expanded', 'false'); } }
    boton.addEventListener('click', function (ev) {
      ev.stopPropagation(); pide();
      var abre = menu.hidden; menu.hidden = !abre; boton.setAttribute('aria-expanded', abre ? 'true' : 'false');
      if (abre) menu.querySelector('.compartir-op:not([hidden])').focus();
    });
    document.addEventListener('click', function (ev) { if (!menu.hidden && !menu.contains(ev.target) && !boton.contains(ev.target)) cierra(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !menu.hidden) { cierra(); boton.focus(); } });

    var d = null;
    function enlace() { if (!d) d = esVineta ? datosVineta(boton) : datos(); return d; }
    // Quien cierra el menú de compartir sin elegir nada no ha tenido un error
    function trasCompartir(e) { if (!e || e.name === 'AbortError') cierra(); }

    [].forEach.call(menu.querySelectorAll('.compartir-op'), function (b) {
      b.addEventListener('click', function () {
        var accion = b.dataset.accion, x = enlace();
        if (accion === 'enlace') { navigator.share({ title: x.titular || document.title, url: x.url }).then(cierra, trasCompartir); return; }
        if (accion === 'copiar-enlace') { copiaTexto(x.url).then(function () { hecho(b, b.dataset.hecho, cierra); }, cierra); return; }
        b.disabled = true;
        pide().then(function (r) {
          var nombre = 'diario-ia-educativa-' + r.d.nombre + '.png';
          if (accion === 'imagen') {
            var f = new File([r.blob], nombre, { type: 'image/png' });
            return navigator.share({ files: [f], title: r.d.titular, text: r.d.titular + '\n' + r.d.url })
              .then(cierra, function (e) { if (e && e.name === 'AbortError') cierra(); else { descarga(r.blob, nombre); cierra(); } });
          }
          if (accion === 'copiar-imagen') return copia(r.blob).then(function () { hecho(b, b.dataset.hecho, cierra); }, function () { descarga(r.blob, nombre); cierra(); });
          descarga(r.blob, nombre); cierra();
        }).catch(function () {}).then(function () { b.disabled = false; });
      });
    });
  }

  [].forEach.call(botones, monta);
})();
