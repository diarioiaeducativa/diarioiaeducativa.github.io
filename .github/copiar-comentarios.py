# SPDX-License-Identifier: AGPL-3.0-or-later
"""Copia de los comentarios del diario en el propio sitio (ADR 0030 del repositorio diarioiaeducativa/periodico).

Lo lanza .github/workflows/copiar-comentarios.yml. Lee de las Discussions de la categoría «Comentarios» todos los
hilos que abre giscus (titulados con la ruta de la pieza, AAAA-MM-DD/id) y deja uno por pieza en
comentarios/AAAA-MM-DD/id.json. Cada página los lee de ahí, del propio diario: quien solo lee no se conecta con
giscus ni con GitHub, y giscus se carga solo al pulsar «Comentar».

Siempre lo rehace todo: así un comentario editado, borrado u ocultado al moderar desaparece también de la copia.
El texto es el HTML que da GitHub, pasado por una lista cerrada de etiquetas: nada de imágenes ni de otro
contenido que se cargue de fuera (una imagen queda como enlace), ni atributos salvo el destino de los enlaces.

    python3 .github/copiar-comentarios.py [carpeta]   (por defecto, comentarios/; necesita GITHUB_TOKEN)
    python3 .github/copiar-comentarios.py --prueba consulta.json carpeta   (sin red, con una respuesta guardada)
"""
import html
import json
import os
import re
import shutil
import sys
import urllib.request
from html.parser import HTMLParser

DUENO, REPO, CATEGORIA = "diarioiaeducativa", "diarioiaeducativa.github.io", "Comentarios"
TERMINO = re.compile(r"\d{4}-\d{2}-\d{2}/[\w-]+")

CAMPOS = "id url createdAt isMinimized deletedAt author { login url } bodyHTML"
CONSULTA = """query($dueno:String!, $repo:String!, $despues:String) {
  repository(owner:$dueno, name:$repo) {
    discussions(first:50, after:$despues, orderBy:{field:CREATED_AT, direction:ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { title category { name }
        comments(first:100) { nodes { %s replies(first:100) { nodes { %s } } } } }
    }
  }
}""" % (CAMPOS, CAMPOS)


class Limpio(HTMLParser):
    """El HTML de GitHub con solo las etiquetas de texto; lo demás, sin la etiqueta y con su texto."""
    PERMITIDAS = {"p", "br", "strong", "b", "em", "i", "u", "s", "del", "ins", "code", "pre", "blockquote",
                  "ul", "ol", "li", "hr", "table", "thead", "tbody", "tr", "th", "td", "details", "summary",
                  "sup", "sub", "kbd"}
    TITULOS = {"h1", "h2", "h3", "h4", "h5", "h6"}   # dentro de un comentario, un título es un párrafo en negrita
    VACIAS = {"br", "hr"}
    FUERA = {"script", "style", "template", "svg", "math", "iframe", "object", "video", "audio"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.salida, self.pila, self.fuera = [], [], 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in self.FUERA:   # con todo su contenido
            self.fuera += 1
            return
        if self.fuera:
            return
        if tag in self.PERMITIDAS:
            self.salida.append(f"<{tag}>")
            cierre = None if tag in self.VACIAS else f"</{tag}>"
        elif tag in self.TITULOS:
            self.salida.append("<p><strong>")
            cierre = "</strong></p>"
        elif tag == "a":
            href = (a.get("href") or "").strip()
            if href.startswith("https://camo.githubusercontent.com/"):
                cierre = ""   # el enlace que GitHub pone alrededor de una imagen: la imagen ya sale como enlace
            elif re.match(r"(https?:|mailto:)", href, re.I):
                self.salida.append(f'<a href="{html.escape(href)}" target="_blank" rel="noopener nofollow ugc">')
                cierre = "</a>"
            else:
                cierre = ""
        elif tag == "img":
            src = (a.get("data-canonical-src") or a.get("src") or "").strip()
            alt = (a.get("alt") or "").strip() or "imagen"
            if re.match(r"https?:", src, re.I):
                self.salida.append(f'<a href="{html.escape(src)}" target="_blank" rel="noopener nofollow ugc">'
                                   f"[{html.escape(alt, quote=False)}]</a>")
            return
        elif tag == "input" and a.get("type") == "checkbox":
            self.salida.append("☑ " if "checked" in a else "☐ ")
            return
        else:
            cierre = ""   # div, span, g-emoji…: fuera la etiqueta, queda el texto
        if tag not in self.VACIAS:
            self.pila.append((tag, cierre))

    def handle_startendtag(self, tag, attrs):   # <x/>: abre y cierra
        if tag in self.FUERA:
            return
        self.handle_starttag(tag, attrs)
        if tag not in self.VACIAS and tag not in ("img", "input"):
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.fuera:
            if tag in self.FUERA:
                self.fuera -= 1
            return
        if not any(t == tag for t, _ in self.pila):
            return
        while self.pila:   # se cierra lo abierto hasta esa etiqueta, aunque venga mal anidado
            t, cierre = self.pila.pop()
            self.salida.append(cierre or "")
            if t == tag:
                break

    def handle_data(self, data):
        if not self.fuera:
            self.salida.append(html.escape(data, quote=False))

    def resultado(self):
        while self.pila:
            self.salida.append(self.pila.pop()[1] or "")
        return re.sub(r"\n{3,}", "\n\n", "".join(self.salida)).strip()


def limpio(cuerpo):
    p = Limpio()
    p.feed(cuerpo or "")
    p.close()
    return p.resultado()


def comentario(c):
    """Lo que la página necesita de un comentario, o None si no se enseña."""
    if c.get("isMinimized"):
        return None   # ocultado al moderar
    autor = c.get("author") or {}
    d = {"autor": autor.get("login") or "ghost", "perfil": autor.get("url") or "", "fecha": c["createdAt"],
         "enlace": c.get("url") or ""}
    if c.get("deletedAt"):
        d["borrado"] = True
    else:
        d["html"] = limpio(c.get("bodyHTML"))
    return d


def hilo(nodo):
    salida = []
    for c in nodo["comments"]["nodes"]:
        d = comentario(c)
        if d is None:
            continue
        respuestas = [r for r in map(comentario, c["replies"]["nodes"]) if r and not r.get("borrado")]
        if d.get("borrado") and not respuestas:
            continue   # un borrado solo se enseña para no dejar sueltas sus respuestas
        if respuestas:
            d["respuestas"] = respuestas
        salida.append(d)
    return salida


def consultar(despues):
    datos = json.dumps({"query": CONSULTA, "variables": {"dueno": DUENO, "repo": REPO, "despues": despues}}).encode()
    pet = urllib.request.Request("https://api.github.com/graphql", datos,
                                 {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                                  "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(pet, timeout=60))
    if r.get("errors"):
        sys.exit(f"GitHub: {r['errors']}")
    return r["data"]["repository"]["discussions"]


def hilos(prueba=None):
    if prueba:
        yield from json.load(open(prueba, encoding="utf-8"))["data"]["repository"]["discussions"]["nodes"]
        return
    despues = None
    while True:
        pagina = consultar(despues)
        yield from pagina["nodes"]
        if not pagina["pageInfo"]["hasNextPage"]:
            return
        despues = pagina["pageInfo"]["endCursor"]


def main():
    args = sys.argv[1:]
    prueba = None
    if args[:1] == ["--prueba"]:
        prueba, args = args[1], args[2:]
    carpeta = args[0] if args else "comentarios"
    nuevos = {}
    for nodo in hilos(prueba):
        termino = nodo["title"].strip()
        if (nodo.get("category") or {}).get("name") != CATEGORIA or not TERMINO.fullmatch(termino):
            continue
        lista = hilo(nodo)
        if lista:
            nuevos[termino] = lista
    # Se rehace la carpeta entera: lo que ya no tiene comentarios visibles desaparece
    if os.path.isdir(carpeta):
        shutil.rmtree(carpeta)
    for termino, lista in sorted(nuevos.items()):
        ruta = os.path.join(carpeta, termino + ".json")
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump({"comentarios": lista}, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print(f"{len(nuevos)} piezas con comentarios; {sum(len(v) for v in nuevos.values())} comentarios")


if __name__ == "__main__":
    main()
