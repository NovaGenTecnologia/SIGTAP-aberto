#!/usr/bin/env python3
"""Gera os arquivos da marca SIGTAP Aberto (SVGs, caminhos para o React).

Requer: fonttools, brotli, uharfbuzz. A fonte é a Public Sans variável já usada pela interface
(crates/app/web/node_modules/@fontsource-variable/public-sans). O nome vira contorno: os SVGs
não dependem de fonte instalada. Uso: python marca/gerar_marca.py
"""
import io
import pathlib
import re
import sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RAIZ = pathlib.Path(__file__).resolve().parent
FONTE = RAIZ.parent / "crates/app/web/node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2"
CASCO, BRANCO, TINTA = "#0A3D91", "#FFFFFF", "#14202B"

def num_f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


# Símbolo "Nó ligado": cruz de células de tabela; o braço direito é um nó aberto ligado pela linha-guia.
# Grade de 64. Células de 13 (raio 3); linha-guia de 3; nó em anel de raio 6 (traço 3).
CELULAS = [(25.5, 7), (25.5, 25.5), (25.5, 44), (7, 25.5)]  # cima, centro, baixo, esquerda
CEL, CEL_R = 13, 3
GUIA = "M38.5 32H45.5"
NO_X, NO_Y, NO_R, NO_TRACO = 51.5, 32, 6, 3
# Arcos do nó: saem do ponto à esquerda do anel (onde a linha-guia chega) e se encontram à direita.
ARCO_X0, ARCO_X1 = NO_X - NO_R, NO_X + NO_R
ARCO_CIMA = f"M{num_f(ARCO_X0)} {NO_Y}A{NO_R} {NO_R} 0 0 1 {num_f(ARCO_X1)} {NO_Y}"
ARCO_BAIXO = f"M{num_f(ARCO_X0)} {NO_Y}A{NO_R} {NO_R} 0 0 0 {num_f(ARCO_X1)} {NO_Y}"
RAIO = 14

# Variante pequena (até 32 px): traço mais grosso, células maiores, anel mais afastado.
CELULAS_P = [(23, 7), (23, 25), (23, 43), (5, 25)]
CEL_P, CEL_R_P = 14, 3
GUIA_P = "M37 32H45.5"
NO_P = dict(x=51, y=32, r=5.5, traco=4)
GUIA_P_LARG = 4
ARCO_P_X0, ARCO_P_X1 = NO_P["x"] - NO_P["r"], NO_P["x"] + NO_P["r"]
ARCO_CIMA_P = f"M{num_f(ARCO_P_X0)} 32A{NO_P['r']} {NO_P['r']} 0 0 1 {num_f(ARCO_P_X1)} 32"
ARCO_BAIXO_P = f"M{num_f(ARCO_P_X0)} 32A{NO_P['r']} {NO_P['r']} 0 0 0 {num_f(ARCO_P_X1)} 32"


def instancia(peso):
    fonte = TTFont(FONTE)
    fonte.flavor = None
    inst = instancer.instantiateVariableFont(fonte, {"wght": peso})
    buf = io.BytesIO()
    inst.flavor = None
    inst.save(buf)
    return TTFont(io.BytesIO(buf.getvalue())), buf.getvalue()


def num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def palavra(texto, peso, tamanho, x, base, trilha=0.0):
    """Contorno de `texto`, com kerning, em unidades da marca. Devolve (d, largura)."""
    ttf, dados = instancia(peso)
    face = hb.Face(dados)
    fonte = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(texto)
    buf.guess_segment_properties()
    hb.shape(fonte, buf, {"kern": True})
    gs = ttf.getGlyphSet()
    ordem = ttf.getGlyphOrder()
    esc = tamanho / ttf["head"].unitsPerEm
    d, pen_x = [], 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        nome = ordem[info.codepoint]
        pen = SVGPathPen(gs, ntos=num)
        gs[nome].draw(TransformPen(pen, (esc, 0, 0, -esc, x + (pen_x + pos.x_offset) * esc, base)))
        d.append(pen.getCommands())
        pen_x += pos.x_advance + trilha * ttf["head"].unitsPerEm
    pen_x -= trilha * ttf["head"].unitsPerEm
    return "".join(d), pen_x * esc, ttf["OS/2"].sCapHeight * esc


def tile(fundo):
    return f'<rect width="64" height="64" rx="{RAIO}" fill="{fundo}"/>'


def simbolo_s(cor, animar=False, brilho=False, pequeno=False):
    """Células, linha-guia e nó. Com `animar`, cada parte leva uma classe para o CSS da animação.
    Com `brilho`, entram também a trilha e os dois arcos que correm sobre a linha e o nó."""
    cels, cel, cel_r = (CELULAS_P, CEL_P, CEL_R_P) if pequeno else (CELULAS, CEL, CEL_R)
    guia_d, guia_w = (GUIA_P, GUIA_P_LARG) if pequeno else (GUIA, 3)
    no_x, no_y, no_r, no_w = (NO_P["x"], NO_P["y"], NO_P["r"], NO_P["traco"]) if pequeno else (NO_X, NO_Y, NO_R, NO_TRACO)
    arco_c, arco_b = (ARCO_CIMA_P, ARCO_BAIXO_P) if pequeno else (ARCO_CIMA, ARCO_BAIXO)
    cls = lambda n: f' class="{n}"' if animar else ""
    celulas = "".join(
        f'<rect{cls("cel c%d" % (i + 1))} x="{num(x)}" y="{num(y)}" width="{cel}" height="{cel}" rx="{cel_r}" fill="{cor}"/>'
        for i, (x, y) in enumerate(cels))
    guia = f'<path{cls("guia")} d="{guia_d}" fill="none" stroke="{cor}" stroke-width="{guia_w}" stroke-linecap="round"/>'
    no = f'<circle{cls("no")} cx="{no_x}" cy="{no_y}" r="{no_r}" fill="none" stroke="{cor}" stroke-width="{no_w}"/>'
    extra, trilha = "", ""
    if animar:
        arco = lambda n, d: f'<path class="arco {n}" pathLength="1" d="{d}" fill="none" stroke="{cor}" stroke-width="{no_w + 0.2}" stroke-linecap="round"/>'
        if brilho:
            trilha = f'<path class="trilha" pathLength="1" d="{guia_d}" fill="none" stroke="{cor}" stroke-width="{guia_w + 0.2}" stroke-linecap="round"/>'
        extra = arco("cima", arco_c) + arco("baixo", arco_b)
    # A linha e o brilho ficam por baixo das células: a ponta arredondada não aparece sobre o quadrado.
    return guia + trilha + celulas + no + extra


def svg(vb_w, vb_h, corpo, titulo="SIGTAP Aberto", estilo="", extra=""):
    st = f"<style>{estilo}</style>" if estilo else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(vb_w)} {num(vb_h)}" role="img" aria-label="{titulo}"{extra}>'
            f"<title>{titulo}</title>{st}{corpo}</svg>\n")


TRILHA_SIGTAP = 0.03  # espaçamento das maiúsculas, em em
TEXTO_H, TEXTO_V = 31, 26
# tamanho do nome (casco = 64): maiúsculas a ~34% do casco
ESCALA_VERTICAL = 1.5  # o símbolo da versão vertical é 1,5x maior que o da horizontal


def nome(F, x, base):
    """Os dois contornos do nome com `F` de tamanho. Devolve (d_sigtap, d_aberto, largura)."""
    gap = F * 0.26
    d1, w1, _ = palavra("SIGTAP", 700, F, x, base, TRILHA_SIGTAP)
    d2, w2, _ = palavra("Aberto", 400, F, x + w1 + gap, base)
    return d1, d2, w1 + gap + w2


def composicao(layout, cor_texto, cor_tile, cor_s):
    """Largura, altura, deslocamento do símbolo e contornos do nome."""
    if layout == "horizontal":
        F = TEXTO_H
        cap = palavra("I", 700, F, 0, 0)[2]
        x0 = 64 + 16
        d1, d2, w = nome(F, x0, 32 + cap / 2)
        return dict(w=x0 + w, h=64, sx=0, sy=0, d1=d1, d2=d2)
    # vertical: símbolo (1,5x) sobre o nome, tudo centrado
    F = TEXTO_V
    cap = palavra("I", 700, F, 0, 0)[2]
    _, _, larg = nome(F, 0, 0)
    tile_v = 64 * ESCALA_VERTICAL
    W = max(tile_v, larg)
    base = tile_v + 18 + cap
    d1, d2, _ = nome(F, (W - larg) / 2, base)
    return dict(w=W, h=base + 2, sx=(W - tile_v) / 2, sy=0, d1=d1, d2=d2, escala=ESCALA_VERTICAL)


def lockup(layout, tema, animar=False):
    cores = {
        "padrao": dict(tile=CASCO, s=BRANCO, t1=CASCO, t2=CASCO),
        "negativo": dict(tile=BRANCO, s=CASCO, t1=BRANCO, t2=BRANCO),
        "mono": dict(tile=TINTA, s=BRANCO, t1=TINTA, t2=TINTA),
        "mono-negativo": dict(tile=BRANCO, s=TINTA, t1=BRANCO, t2=BRANCO),
    }[tema]
    c = composicao(layout, None, None, None)
    sim = f'<g transform="translate({num(c["sx"])} {num(c["sy"])}) scale({c.get("escala", 1)})">{tile(cores["tile"])}{simbolo_s(cores["s"])}</g>'
    txt = f'<path d="{c["d1"]}" fill="{cores["t1"]}"/><path d="{c["d2"]}" fill="{cores["t2"]}"/>'
    return svg(c["w"], c["h"], sim + txt)


# ---- animações (SVG autônomo; no app o mesmo CSS vive em dominio.css) ----
CSS_MARCA = RAIZ.parent / "crates/app/web/src/componentes/dominio/marca.css"


def dom_animado(layout, animacao, pequeno=False):
    """SVG autônomo com o mesmo DOM do componente `Marca` e o CSS de marca.css embutido: uma fonte só."""
    c = composicao(layout, None, None, None)
    cels, cel, cel_r = (CELULAS_P, CEL_P, CEL_R_P) if pequeno else (CELULAS, CEL, CEL_R)
    guia_d = GUIA_P if pequeno else GUIA
    no = NO_P if pequeno else dict(x=NO_X, y=NO_Y, r=NO_R, traco=NO_TRACO)
    arco_c, arco_b = (ARCO_CIMA_P, ARCO_BAIXO_P) if pequeno else (ARCO_CIMA, ARCO_BAIXO)
    brilho = animacao in ("carregando", "sutil")
    escala = c.get("escala", 1)
    partes = [f'<rect class="marca__casco" width="64" height="64" rx="{RAIO}"/>',
              f'<path class="marca__guia" d="{guia_d}" pathLength="1"/>']
    if brilho:
        partes.append(f'<path class="marca__trilha" d="{guia_d}" pathLength="1"/>')
    partes += [f'<rect class="marca__cel marca__c{i + 1}" x="{num(x)}" y="{num(y)}" width="{cel}" height="{cel}" rx="{cel_r}"/>'
               for i, (x, y) in enumerate(cels)]
    anel = f'<circle class="marca__no" cx="{no["x"]}" cy="{no["y"]}" r="{no["r"]}" stroke-width="{no["traco"]}"/>'
    if brilho or animacao == "inicial":
        for d in (arco_c, arco_b):
            anel += f'<path class="marca__arco" d="{d}" pathLength="1" stroke-width="{num(no["traco"] + 0.2)}"/>'
    partes.append(f'<g class="marca__anel">{anel}</g>')
    simbolo = f'<g transform="translate({num(c["sx"])} 0) scale({escala})">{"".join(partes)}</g>'
    nomes = (f'<g class="marca__nomes"><path class="marca__nome marca__sigtap" d="{c["d1"]}"/>'
             f'<path class="marca__nome marca__aberto" d="{c["d2"]}"/></g>')
    css = ".marca{--cor-casco:#0A3D91}" + CSS_MARCA.read_text(encoding="utf-8")
    classe = f"marca marca--padrao marca--{animacao}" + (" marca--pequena" if pequeno else "")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" class="{classe}" viewBox="0 0 {num(c["w"])} {num(c["h"])}" role="img" aria-label="SIGTAP Aberto">'
            f"<title>SIGTAP Aberto</title><style>{css}</style>{simbolo}{nomes}</svg>\n")


def animado_simbolo(animacao):
    """Só o símbolo sobre o casco (carregamento é usado sem o nome)."""
    c = dom_animado("horizontal", animacao)
    return re.sub(r'<g class="marca__nomes">.*?</g></svg>', "</svg>", c).replace('viewBox="0 0 %s 64"' % num(composicao("horizontal", None, None, None)["w"]), 'viewBox="0 0 64 64"')


def simbolo_arquivo(tema, pequeno=False):
    cores = {"padrao": (CASCO, BRANCO), "negativo": (BRANCO, CASCO), "mono": (TINTA, BRANCO), "mono-negativo": (BRANCO, TINTA)}[tema]
    return svg(64, 64, tile(cores[0]) + simbolo_s(cores[1], pequeno=pequeno))


def so_s(cor):
    # S sem o casco, para usar sobre qualquer fundo
    return svg(64, 64, simbolo_s(cor))


def escrever(caminho, texto):
    p = RAIZ / caminho
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(texto, encoding="utf-8", newline="\n")
    print("ok", caminho)


def main():
    if not FONTE.exists():
        sys.exit(f"Fonte não encontrada: {FONTE} (rode npm ci em crates/app/web)")
    for tema in ("padrao", "negativo", "mono", "mono-negativo"):
        suf = "" if tema == "padrao" else f"-{tema}"
        escrever(f"svg/simbolo{suf}.svg", simbolo_arquivo(tema))
        escrever(f"svg/simbolo-pequeno{suf}.svg", simbolo_arquivo(tema, True))
        escrever(f"svg/horizontal{suf}.svg", lockup("horizontal", tema))
        escrever(f"svg/vertical{suf}.svg", lockup("vertical", tema))
    escrever("svg/sem-casco.svg", so_s(CASCO))
    escrever("svg/sem-casco-branco.svg", so_s(BRANCO))
    escrever("animacao/sutil.svg", dom_animado("horizontal", "sutil"))
    escrever("animacao/carregamento.svg", animado_simbolo("carregando"))
    escrever("animacao/inicializacao.svg", dom_animado("horizontal", "inicial"))
    escrever("animacao/inicializacao-vertical.svg", dom_animado("vertical", "inicial"))
    # caminhos para o React
    h, v = composicao("horizontal", None, None, None), composicao("vertical", None, None, None)
    ts = (
        "// Gerado por marca/gerar_marca.py. Não edite à mão.\n"
        f"export const CELULAS = {[list(c) for c in CELULAS]} as const;\n"
        f'export const CEL = {CEL};\nexport const CEL_R = {CEL_R};\nexport const GUIA = "{GUIA}";\n'
        f'export const ARCO_CIMA = "{ARCO_CIMA}";\nexport const ARCO_BAIXO = "{ARCO_BAIXO}";\n'
        f"export const NO = {{ x: {NO_X}, y: {NO_Y}, r: {NO_R}, traco: {NO_TRACO} }};\nexport const RAIO = {RAIO};\n"
        f"export const PEQUENO = {{ celulas: {[list(c) for c in CELULAS_P]}, cel: {CEL_P}, celR: {CEL_R_P}, guia: '{GUIA_P}', guiaLarg: {GUIA_P_LARG}, no: {{ x: {NO_P['x']}, y: {NO_P['y']}, r: {NO_P['r']}, traco: {NO_P['traco']} }}, arcoCima: '{ARCO_CIMA_P}', arcoBaixo: '{ARCO_BAIXO_P}' }} as const;\n"
        f"export const HORIZONTAL = {{ largura: {num(h['w'])}, altura: {num(h['h'])}, sigtap: \"{h['d1']}\", aberto: \"{h['d2']}\" }};\n"
        f"export const VERTICAL = {{ largura: {num(v['w'])}, altura: {num(v['h'])}, x: {num(v['sx'])}, escala: {v['escala']}, sigtap: \"{v['d1']}\", aberto: \"{v['d2']}\" }};\n"
    )
    destino = RAIZ.parent / "crates/app/web/src/componentes/dominio/marcaCaminhos.ts"
    destino.write_text(ts, encoding="utf-8", newline="\n")
    print("ok", destino.relative_to(RAIZ.parent))


if __name__ == "__main__":
    main()
