# SPDX-License-Identifier: AGPL-3.0-or-later
"""Aviso por Telegram de un comentario nuevo del diario (ADR 0030 del repositorio diarioiaeducativa/periodico).

Lo lanza .github/workflows/avisar-comentario.yml. Lee el comentario del evento, pide a GitHub su texto ya
convertido a HTML (el Markdown lo interpreta GitHub, no una regla nuestra) y se queda con lo que Telegram
sabe mostrar: negrita, cursiva, subrayado, tachado, enlaces, código y citas. Las listas salen como líneas
con viñeta; una imagen, como enlace. Si GitHub no da el HTML, va el texto tal cual.

El comentario va entero: si no cabe en un mensaje, en varios, con la cabecera en el primero y los enlaces
en el último. A nadie se le avisa de lo que escribe él.
"""
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

WEB = "https://diarioiaeducativa.github.io/"
LARGO = 3500   # caracteres visibles por mensaje (Telegram admite 4.096 tras quitar el formato)
DESTINOS = [("JUANJO_CHAT", "jjdeharo"), ("RAUL_CHAT", "raultorres-ia")]   # (chat, su cuenta de GitHub)


class ATelegram(HTMLParser):
    """HTML de GitHub → bloques en el HTML que admite Telegram."""
    SIMPLES = {"b": "b", "strong": "b", "i": "i", "em": "i", "u": "u", "ins": "u",
               "s": "s", "del": "s", "strike": "s", "code": "code"}
    BLOQUES = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "details", "pre", "blockquote", "hr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.bloques, self.actual, self.pila, self.listas = [], [], [], []
        self.pre = self.cita = 0
        self.celda = False

    def nueva_linea(self):
        if self.actual and not "".join(self.actual).endswith("\n"):
            self.actual.append("\n")

    def cerrar_bloque(self):
        if self.pre or self.cita:   # dentro de un código o una cita, el párrafo es solo un salto de línea
            return self.nueva_linea()
        t = limpiar("".join(self.actual))
        if t:
            self.bloques.append(t)
        self.actual = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cierre = None
        if tag in self.SIMPLES and not self.pre:
            self.actual.append(f"<{self.SIMPLES[tag]}>")
            cierre = f"</{self.SIMPLES[tag]}>"
        elif tag == "a" and (a.get("href") or "").startswith("https://camo.githubusercontent.com/"):
            pass   # el enlace que GitHub pone alrededor de una imagen: la imagen ya sale como enlace
        elif tag == "a" and a.get("href") and not self.pre:
            self.actual.append(f'<a href="{html.escape(a["href"])}">')
            cierre = "</a>"
        elif tag == "pre":
            self.cerrar_bloque()
            self.actual.append("<pre>")
            self.pre += 1
            cierre = "</pre>"
        elif tag == "blockquote":
            self.cerrar_bloque()
            self.actual.append("<blockquote>")
            self.cita += 1
            cierre = "</blockquote>"
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.cerrar_bloque()
            self.actual.append("<b>")
            cierre = "</b>"
        elif tag in ("ul", "ol"):
            if not self.listas:
                self.cerrar_bloque()
            self.listas.append(0 if tag == "ol" else None)
        elif tag == "li":
            self.nueva_linea()
            sangria = "  " * (len(self.listas) - 1)
            if self.listas and self.listas[-1] is not None:
                self.listas[-1] += 1
                self.actual.append(f"{sangria}{self.listas[-1]}. ")
            else:
                self.actual.append(f"{sangria}• ")
        elif tag == "br":
            self.actual.append("\n")
        elif tag == "img":
            src, alt = a.get("data-canonical-src") or a.get("src") or "", (a.get("alt") or "").strip()
            if src:
                self.actual.append(f'<a href="{html.escape(src)}">[{html.escape(alt or "imagen")}]</a>')
        elif tag == "input" and a.get("type") == "checkbox":
            self.actual.append("☑ " if "checked" in a else "☐ ")
        elif tag == "hr":
            self.cerrar_bloque()
            self.bloques.append("———")
        elif tag == "tr":
            self.nueva_linea()
            self.celda = False
        elif tag in ("td", "th"):
            if self.celda:
                self.actual.append(" | ")
            self.celda = True
        elif tag in ("p", "div", "table", "details", "summary"):
            self.cerrar_bloque()
        self.pila.append((tag, cierre))

    def handle_endtag(self, tag):
        # Se cierra lo abierto hasta esa etiqueta, aunque el HTML venga mal anidado
        if not any(t == tag for t, _ in self.pila):
            return
        while self.pila:
            t, cierre = self.pila.pop()
            if cierre:
                self.actual.append(cierre)
            if t == "pre":
                self.pre -= 1
            if t == "blockquote":
                self.cita -= 1
            if t in ("ul", "ol") and self.listas:
                self.listas.pop()
            if t == tag:
                break
        if tag in self.BLOQUES and not (tag in ("ul", "ol") and self.listas):
            self.cerrar_bloque()
        elif tag == "summary":
            self.nueva_linea()

    def handle_data(self, data):
        if not self.pre:
            data = re.sub(r"\s+", " ", data)
            if not self.actual or "".join(self.actual).endswith(("\n", "• ", ". ")):
                data = data.lstrip()
        if data:
            self.actual.append(html.escape(data, quote=False))

    def resultado(self):
        while self.pila:   # lo que quedara abierto
            self.handle_endtag(self.pila[-1][0])
        self.cerrar_bloque()
        return [b for b in self.bloques if b]


def limpiar(s):
    """Sin espacios sobrantes al principio o al final de cada línea ni repetidos, salvo en el código."""
    partes = re.split(r"(<pre>.*?</pre>)", s, flags=re.S)
    for i in range(0, len(partes), 2):
        x = re.sub(r"(?<=\S) {2,}", " ", partes[i])
        x = re.sub(r"[ \t]+\n", "\n", x)
        x = re.sub(r"(<blockquote>)\s+", r"\1", x)
        x = re.sub(r"\s+(</blockquote>)", r"\1", x)
        partes[i] = re.sub(r"\n{3,}", "\n\n", x)
    return "".join(partes).strip()


def visible(s):
    return len(html.unescape(re.sub(r"<[^>]+>", "", s)))


def partir_plano(texto, largo=LARGO):
    """Un texto sin formato, partido por párrafos, líneas o espacios."""
    trozos, resto = [], texto
    while len(resto) > largo:
        corte = max(resto.rfind("\n\n", 0, largo), resto.rfind("\n", 0, largo), resto.rfind(" ", 0, largo))
        corte = corte if corte > largo // 3 else largo
        trozos.append(resto[:corte].rstrip())
        resto = resto[corte:].lstrip()
    return trozos + [resto]


def bloques_del_comentario(cuerpo_md, cuerpo_html):
    """Los bloques del comentario en HTML de Telegram; sin HTML de GitHub, el texto escapado."""
    if cuerpo_html:
        try:
            p = ATelegram()
            p.feed(cuerpo_html)
            bloques = p.resultado()
            if bloques:
                return bloques
        except Exception as e:  # noqa: BLE001 — si falla la conversión, va el texto tal cual
            print(f"conversión del HTML: {e}", file=sys.stderr)
    return [html.escape(x, quote=False) for x in partir_plano(cuerpo_md.strip() or "(sin texto)")]


def mensajes(cabecera, bloques, enlaces):
    """Los bloques agrupados en mensajes que caben; un bloque que no cabe solo, partido sin formato."""
    piezas = []
    for b in bloques:
        if visible(b) <= LARGO:
            piezas.append(b)
        else:
            plano = html.unescape(re.sub(r"<[^>]+>", "", b))
            piezas += [html.escape(x, quote=False) for x in partir_plano(plano)]
    salida, actual = [], ""
    for p in piezas:
        junto = f"{actual}\n\n{p}" if actual else p
        if actual and visible(junto) > LARGO:
            salida.append(actual)
            actual = p
        else:
            actual = junto
    salida.append(actual)
    salida[0] = cabecera + salida[0]
    salida[-1] += enlaces
    return salida


def html_de_github(node_id):
    token = os.environ.get("GITHUB_TOKEN")
    if not token or not node_id:
        return ""
    consulta = json.dumps({"query": "query($id:ID!){node(id:$id){... on DiscussionComment{bodyHTML}}}",
                           "variables": {"id": node_id}}).encode()
    pet = urllib.request.Request("https://api.github.com/graphql", consulta,
                                 {"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(pet, timeout=20))
        return ((r.get("data") or {}).get("node") or {}).get("bodyHTML") or ""
    except Exception as e:  # noqa: BLE001
        print(f"HTML de GitHub: {e}", file=sys.stderr)
        return ""


def titular(pieza, termino):
    try:   # el titular, de la propia página
        pagina = urllib.request.urlopen(pieza, timeout=20).read().decode("utf-8")
        m = re.search(r"<title>(.*?) \| ", pagina)
        if m:
            return html.unescape(m.group(1))
    except Exception:  # noqa: BLE001
        pass
    return termino


def main():
    ev = json.load(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8"))
    c, d = ev["comment"], ev["discussion"]
    autor = c["user"]["login"]
    termino = d["title"].strip()   # giscus titula cada hilo con la ruta de la pieza: AAAA-MM-DD/id
    pieza = WEB + termino + ".html" if re.fullmatch(r"\d{4}-\d{2}-\d{2}/[\w-]+", termino) else WEB
    tipo = "Respuesta nueva" if c.get("parent_id") else "Comentario nuevo"
    cabecera = (f"<b>Diario de IA Educativa</b>\n\n<b>{tipo}</b> de {html.escape(autor)} en "
                f"«{html.escape(titular(pieza, termino))}»:\n\n")
    enlaces = f'\n\n<a href="{pieza}#t-comentarios">Ver en el diario</a> · <a href="{c["html_url"]}">Ver en GitHub</a>'
    lista = mensajes(cabecera, bloques_del_comentario(c.get("body") or "", html_de_github(c.get("node_id"))), enlaces)

    tok, fallos = os.environ["BOT_IAEDUCATIVA_TOKEN"], []
    for chat, cuenta in DESTINOS:
        if autor.lower() == cuenta or not os.environ.get(chat):
            continue
        for m in lista:
            datos = urllib.parse.urlencode({"chat_id": os.environ[chat], "text": m, "parse_mode": "HTML",
                                            "disable_web_page_preview": "true"}).encode()
            try:
                r = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", datos, timeout=30))
            except urllib.error.HTTPError as e:   # HTML que Telegram no acepta: el mismo mensaje sin formato
                print(f"{chat}: {e.code} {e.read()[:300]!r}", file=sys.stderr)
                plano = html.unescape(re.sub(r"<[^>]+>", "", m))
                datos = urllib.parse.urlencode({"chat_id": os.environ[chat], "text": plano,
                                                "disable_web_page_preview": "true"}).encode()
                try:
                    r = json.load(urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", datos, timeout=30))
                except Exception as e2:  # noqa: BLE001
                    r = {"ok": False, "error": str(e2)}
            except Exception as e:  # noqa: BLE001
                r = {"ok": False, "error": str(e)}
            if not r.get("ok"):
                fallos.append(f"{chat}: {r}")
                break
    if fallos:
        sys.exit("Telegram no aceptó: " + "; ".join(fallos))


if __name__ == "__main__":
    main()
