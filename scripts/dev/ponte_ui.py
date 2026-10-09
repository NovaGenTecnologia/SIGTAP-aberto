#!/usr/bin/env python3
"""Ponte de desenvolvimento: serve a interface (crates/app/ui) num navegador comum, simulando
o window.__TAURI__ com chamadas à linha de comando (sigtap-aberto-cli). Só para testar telas;
o programa de verdade usa os comandos do Tauri.

Uso: python3 scripts/dev/ponte_ui.py --cli target/release/sigtap-aberto-cli --banco dados/sigtap.db [--porta 8765]
         [--zips PASTA_COM_ZIPS] [--primeira]

Download, importação e apagar ZIPs são SIMULADOS (eventos de progresso falsos; nada é baixado
nem apagado): servem só para ver as telas. A prova real está nos testes do sa-app.
"""
import argparse, json, os, subprocess, sqlite3, http.server, pathlib, urllib.parse, threading, time, re

RAIZ = pathlib.Path(__file__).resolve().parents[2] / "crates" / "app" / "ui"
SHIM = r"""<script>
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    const r = await fetch('/invoke/' + cmd, { method: 'POST', body: JSON.stringify(args || {}) });
    const j = await r.json(); if (!r.ok) throw j.erro; return j.ok; } },
  event: { listen: async (nome, cb) => { (window.__ouvintes[nome] = window.__ouvintes[nome] || []).push(cb); return () => {}; } },
};
window.__ouvintes = {};
setInterval(async () => {
  const r = await fetch('/eventos', { method: 'POST' }); const evs = await r.json();
  for (const e of evs) for (const cb of (window.__ouvintes[e.nome] || [])) cb({ payload: e.payload });
}, 250);
</script>"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cli", required=True); ap.add_argument("--banco", required=True)
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--raiz", help="pasta da interface a servir (padrão: crates/app/ui; para a interface nova: crates/app/web/dist)")
    ap.add_argument("--zips", help="pasta com ZIPs oficiais (só para listar nomes e tamanhos na simulação)")
    ap.add_argument("--primeira", action="store_true", help="simula a primeira execução")
    ap.add_argument("--novidade", action="store_true", help="simula dados novos no servidor")
    ap.add_argument("--atualizacao", action="store_true", help="simula versão nova do programa no GitHub")
    ap.add_argument("--parcial", action="store_true", help="simula histórico parcial: 3 competências antigas ainda não carregadas")
    ap.add_argument("--recuperacao", action="store_true", help="simula banco danificado achado na abertura")
    ap.add_argument("--versao-anterior", action="store_true", help="simula dados gravados por versão anterior do programa")
    ap.add_argument("--bloqueio", action="store_true", help="simula dados gravados por versão mais nova do programa")
    ap.add_argument("--dados", help="pasta de dados para CNES, unidade e favoritos (comandos reais do CLI)")
    ap.add_argument("--cnes-origem", help="pasta com .dbc do CNES: 'baixar' na ponte simula o progresso e importa daqui")
    a = ap.parse_args()
    raiz = pathlib.Path(a.raiz).resolve() if a.raiz else RAIZ
    eventos, trava = [], threading.Lock()
    estado = {"primeira": a.primeira, "territorio": not a.primeira, "brutos": False}
    # Agenda por fonte, com a mesma semântica do backend: uma tarefa por fonte, fila dentro da fonte.
    ESCALA = float(os.environ.get("PONTE_ESCALA", "1"))  # multiplica as esperas (e2e rápidos ou lentos)
    agenda = {f: {"cur": None, "fila": []} for f in ("sigtap", "cnes", "producao")}
    nomes_fonte = {"sigtap": "SIGTAP", "cnes": "CNES", "producao": "Produção"}
    alock, prox = threading.Lock(), [0]

    def dormir(t): time.sleep(t * ESCALA)

    def ocupado(): return any(v["cur"] is not None or v["fila"] for v in agenda.values())

    def prog(item, resumo, mensagem, fracao, indeterminado=False):
        fase = "carregando" if mensagem.startswith("Carregando") else "baixando"
        emitir("progresso", {"fonte": item["fonte"], "tarefa": item["id"], "rotulo": item["rotulo"], "fase": fase,
                             "resumo": resumo, "mensagem": mensagem, "fracao": fracao, "indeterminado": indeterminado})

    def fim(item, ok, cancelada, mensagem):
        emitir("tarefa_fim", {"fonte": item["fonte"], "tarefa": item["id"], "ok": ok, "cancelada": cancelada, "mensagem": mensagem})

    def rodar(item):
        try: ok, cancelada, msg = item["fn"](item)
        except Exception as e: ok, cancelada, msg = False, False, str(e)
        with alock:
            v = agenda[item["fonte"]]
            v["cur"] = v["fila"].pop(0) if v["fila"] else None
            proximo = v["cur"]
        fim(item, ok, cancelada, msg)
        if proximo: threading.Thread(target=rodar, args=(proximo,), daemon=True).start()

    def enviar(fonte, rotulo, quando, fn):
        with alock:
            prox[0] += 1
            item = {"id": prox[0], "fonte": fonte, "rotulo": rotulo, "fn": fn, "cancelar": False}
            v = agenda[fonte]
            if v["cur"] is None:
                v["cur"] = item
                threading.Thread(target=rodar, args=(item,), daemon=True).start()
                return {"tarefa": item["id"], "posicao": 0}
            if quando != "depois":
                raise RuntimeError(f"Já há um download de {nomes_fonte[fonte]} em andamento.")
            v["fila"].append(item)
            return {"tarefa": item["id"], "posicao": len(v["fila"])}

    def cancelar(fonte):
        fontes = [fonte] if fonte else list(agenda)
        for f in fontes:
            with alock:
                v = agenda[f]
                if v["cur"]: v["cur"]["cancelar"] = True
                descartadas, v["fila"] = v["fila"], []
            for d in descartadas: fim(d, False, True, "Cancelado.")

    def emitir(nome, payload):
        with trava: eventos.append({"nome": nome, "payload": payload})

    def ofertas():
        itens = {}
        for f in sorted(pathlib.Path(a.zips).glob("TabelaUnificada_*.zip")) if a.zips else []:
            m = re.match(r"TabelaUnificada_(\d{6})_", f.name)
            if m: itens[m.group(1)] = f.stat().st_size
        carregadas = {c["competencia"] for c in situacao()["competencias"]}
        if estado["primeira"]: carregadas = set()
        if a.parcial:
            for c in ("202601", "202602", "202603"): itens[c] = 2_000_000
            carregadas -= {"202601", "202602", "202603"}
        return {"servidor": "simulado", "competencias": [
            {"competencia": c, "tamanho": t, "guardado": c in carregadas, "carregado": c in carregadas} for c, t in sorted(itens.items())]}

    def simular(pedido, item):
        n = {"vigente": 1, "6": 6, "12": 12, "24": 24, "tudo": 225}.get(pedido.get("sigtap", "vigente"), 1) if pedido.get("sigtap") != "nenhum" else 0
        ter = 2 if pedido.get("territorio") else 0
        prog(item, "", "Consultando o servidor (simulado)", 0, True)
        dormir(1)
        total = 2 * n + ter
        for k in range(n):
            for f in (0.25, 0.5, 0.75):
                if item["cancelar"]: break
                prog(item, f"Fazendo download {k+1} de {n}; carregadas no banco {max(0,k-1)} de {n}" + ("; território pendente" if ter else ""),
                     f"TabelaUnificada_simulada_{k+1}.zip: {f*2:.1f} de 2,0 MB".replace(".", ","), (k + f + max(0, k - 1)) / total)
                dormir(0.25)
            if item["cancelar"]: break
        if item["cancelar"]:
            return False, True, "cancelado; o que já foi baixado fica guardado (simulação)"
        prog(item, f"Download concluído ({n} de {n}); carregadas no banco {n} de {n}", "", 1)
        if pedido.get("territorio") or estado["territorio"]: estado["territorio"] = True; estado["primeira"] = False
        return True, False, f"Concluído: {n} competência(s) baixada(s) (simulação; nada foi baixado)."

    def simular_producao(item):
        for i in range(1, 7):
            if item["cancelar"]: return False, True, "cancelado (simulação)"
            prog(item, "Baixando a produção", f"Arquivo {i} de 6 (simulado)", i / 6)
            dormir(0.4)
        return True, False, "Produção baixada (simulação; nada foi baixado)."

    def cli(*args):
        p = subprocess.run([a.cli, *args, "--banco", a.banco], capture_output=True, text=True, encoding="utf-8")
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip().removeprefix("ERRO: "))
        return json.loads(p.stdout)

    def cli_d(*args, entrada=None, texto=False):
        if not a.dados: raise RuntimeError("ponte sem --dados: comandos do CNES indisponíveis")
        p = subprocess.run([a.cli, *args, "--banco", a.banco, "--dados", a.dados], capture_output=True, text=True, encoding="utf-8", input=entrada)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip().split("ERRO: ")[-1])
        return p.stdout.strip() if texto else (json.loads(p.stdout) if p.stdout.strip() else None)

    def simular_cnes(uf, fase, item):
        resumo = f"Baixando o CNES de {uf}"
        if fase in ("restante", "pessoas"):
            # A ponte importa tudo na fase "busca"; as outras só simulam o andamento.
            passos = ["HB", "SR", "LT", "EQ"] if fase == "restante" else ["PF"]
            for i, t in enumerate(passos):
                if item["cancelar"]: return False, True, "cancelado (simulação)"
                prog(item, resumo, f"Baixando {t}{uf}2608.dbc", i / (len(passos) + 1)); dormir(0.6)
            prog(item, resumo, "Carregando no banco", len(passos) / (len(passos) + 1)); dormir(0.8)
            return True, False, f"CNES de {uf} ({fase}) carregado (simulação)."
        prog(item, resumo, "Consultando o servidor do DATASUS (simulado)", 0, True)
        dormir(0.8)
        nomes = ["ST"] if fase == "busca" else ["ST", "HB", "SR", "LT", "EQ"]
        for i, t in enumerate(nomes):
            if item["cancelar"]: return False, True, "cancelado (simulação)"
            prog(item, resumo, f"Baixando {t}{uf}2608.dbc", i / (len(nomes) + 1)); dormir(0.3)
        prog(item, resumo, "Carregando no banco", len(nomes) / (len(nomes) + 1))
        try: msg = cli_d("cnes-importar", uf, "--origem", a.cnes_origem or "", texto=True).splitlines()[-1] + " (ponte: importado da pasta local)"
        except Exception as e: return False, False, str(e)
        return True, False, msg

    def situacao():
        c = sqlite3.connect(a.banco)
        comps = [dict(competencia=r[0], rotulo=r[0][4:] + "/" + r[0][:4], arquivo=r[1], versao=r[2],
                      publicado_em=(f"{r[2][4:6]}/{r[2][2:4]}/20{r[2][:2]} {r[2][6:8]}:{r[2][8:10]}" if r[2] else None), sha256=r[3])
                 for r in c.execute("SELECT aaaamm, arquivo, versao, sha256 FROM sa_competencia ORDER BY seq")]
        z = [x for x in (sorted(pathlib.Path(a.zips).glob("TabelaUnificada_*.zip")) if a.zips else []) if x.name[16:22] in {c["competencia"] for c in comps}]
        tam = sum(x.stat().st_size for x in z); ult = max((x.name[16:22] for x in z), default=None)
        apag = [x for x in z if x.name[16:22] != ult]
        return dict(primeira_execucao=estado["primeira"], competencias=comps, territorio=({"simulado": True} if estado["territorio"] else None),
                    zips=dict(arquivos=len(z), bytes=tam, apagaveis=len(apag), bytes_apagaveis=sum(x.stat().st_size for x in apag), mantida=ult),
                    pasta_dados="(ponte de desenvolvimento)", ocupado=ocupado(),
                    tarefas=[{"fonte": f, "tarefa": i["id"], "rotulo": i["rotulo"], "na_fila": k > 0} for f, v in agenda.items() for k, i in enumerate(([v["cur"]] if v["cur"] else []) + v["fila"])],
                    bloqueio=("Os dados em D:\\SIGTAP\\dados foram gravados por uma versão mais nova do SIGTAP Aberto: tabela de procedimentos (esquema 2; este programa usa o 1). Use a versão mais nova do programa (Sobre, Procurar atualizações, ou baixe do GitHub). Nada foi alterado." if a.bloqueio else None),
                    recuperacao=({"bancos": ["tabela de procedimentos"], "motivos": ["versao_anterior" if a.versao_anterior else "danificado"], "pastas": ["D:\\SIGTAP\\dados\\" + ("versao_anterior_1" if a.versao_anterior else "banco_com_problema_1")], "zips": 3, "territorio_local": True, "competencias_antes": ["202607", "202608", "202609"]} if (a.recuperacao or a.versao_anterior) and estado.get("recuperacao", True) else None))

    def tratar(cmd, args):
        comp = ["--competencia", args["competencia"]] if args.get("competencia") else []
        if cmd == "situacao": return situacao()
        if cmd == "arvore": return cli("arvore", *([args["pai"]] if args.get("pai") else []), *comp)
        if cmd == "buscar": return cli("buscar", args["texto"], *comp)
        if cmd == "buscar_todos": return cli("buscar-todos", args["texto"], *comp)
        if cmd == "ficha":
            try: return cli("ficha", args["codigo"], *comp)
            except RuntimeError as e:
                if "não existe" in str(e): return None
                raise
        if cmd == "historico": return cli("historico", args["codigo"])
        if cmd == "faturamento_painel": return cli_d("faturamento-painel", *comp)
        if cmd == "faturamento_impacto":
            return cli_d("faturamento-impacto", *(["--de", args["de"]] if args.get("de") else []), *(["--competencia", args["para"]] if args.get("para") else []))
        if cmd == "mudou":
            tabela = [args["tabela"], "--desde", str(args.get("desde") or 0)] if args.get("tabela") else []
            periodo = [*(["--de", args["de"]] if args.get("de") else []), *(["--competencia", args["para"]] if args.get("para") else [])]
            if a.dados: return cli_d("mudou", *tabela, *periodo, "--unidade", *(["--so-afeta"] if args.get("soAfeta") else []))
            return cli("mudou", *tabela, *periodo)
        if cmd == "ligados": return cli("ligados", args["tabela"], *args["codigo"], *comp)
        if cmd == "arvore_cid": return cli("arvore-cid", *([args["pai"]] if args.get("pai") else []), *comp)
        if cmd == "verificar_bancos":
            time.sleep(0.8)
            c = sqlite3.connect(a.banco); r = [x[0] for x in c.execute("PRAGMA integrity_check(10)" if args.get("completo") else "PRAGMA quick_check(10)")]
            return {"completo": bool(args.get("completo")), "itens": [
                {"nome": "Tabela de procedimentos", "arquivo": "sigtap.db", "existe": True, "bytes": pathlib.Path(a.banco).stat().st_size, "ok": r == ["ok"], "danificado": r != ["ok"], "mensagens": [] if r == ["ok"] else r},
                {"nome": "Território", "arquivo": "territorio.db", "existe": False, "bytes": 0, "ok": False, "danificado": False, "mensagens": []}]}
        if cmd == "recriar_banco":
            enviar("sigtap", "SIGTAP", "agora", lambda item: simular({"sigtap": "6"}, item)); estado["recuperacao"] = False; return None
        if cmd == "verificar_dados":
            time.sleep(0.5)
            if a.novidade and not estado.get("baixado"):
                return {"novos": [{"competencia": "202610", "motivo": "nova", "tamanho": 2_100_000}, {"competencia": "202609", "motivo": "republicada", "tamanho": 2_000_000}], "escopo": "2", "bytes": 4_100_000}
            return {"novos": [], "escopo": None, "bytes": 0}
        if cmd == "abrir_site": open("/tmp/ponte_sites.log", "a").write(args["url"] + "\n"); return None
        if cmd == "info_programa": return {"versao": "0.0.1", "repositorio": "NovaGenTecnologia/SIGTAP-aberto", "site_sigtap": "http://sigtap.datasus.gov.br/tabela-unificada/app/sec/inicio.jsp", "so": "windows", "arquitetura": "x86_64", "windows": "Microsoft Windows [versão 10.0.19045.5000]", "webview2": "141.0.3537.57"}
        if cmd == "consultar_atualizacao":
            time.sleep(0.5)
            nova = {"versao": "0.2.0", "notas": "Árvore de CIDs, verificação do banco e atualizador.", "pagina": "https://github.com/NovaGenTecnologia/SIGTAP-aberto/releases/tag/v0.2.0", "zip_nome": "x.zip", "zip_url": "", "zip_tamanho": 9_000_000, "soma_url": ""} if a.atualizacao else None
            return {"atual": "0.0.1", "nova": nova}
        if cmd == "atualizar_programa":
            def sim():
                for f, m in ((0.1, "Consultando a versão mais recente"), (0.4, "Baixando a versão 0.2.0 e conferindo o SHA-256"), (0.9, "Trocando o programa")):
                    emitir("progresso", {"resumo": "Atualizando o programa", "mensagem": m, "fracao": f, "indeterminado": False}); time.sleep(0.6)
                emitir("tarefa_fim", {"ok": False, "cancelada": False, "mensagem": "simulação: o programa não foi trocado"})
            threading.Thread(target=sim, daemon=True).start(); return None
        if cmd == "ofertas": time.sleep(0.6); return ofertas()
        if cmd == "escolher_pasta": return "D:\\Downloads\\SIGTAP (simulado)"
        if cmd == "apagar_zips": return "simulação: nada foi apagado"
        if cmd == "cancelar": cancelar(args.get("fonte")); return None
        if cmd == "fechar_programa": cancelar(None); return None
        if cmd in ("baixar", "importar"):
            pedido = args.get("pedido") or {"sigtap": "vigente", "territorio": True}
            return enviar("sigtap", "SIGTAP", args.get("quando"), lambda item: simular(pedido, item))
        # ---- Produção (SIA/SIH): tudo simulado; nada é baixado nem apagado ----
        if cmd == "producao_situacao":
            return {"manter_brutos": estado["brutos"], "ufs": [
                {"uf": "SP", "bytes_banco": 432013312, "guardados": {"arquivos": 4, "bytes": 1395864371},
                 "defasagem": {"sia_ate": "202607", "sih_ate": "202607", "sia_incompleto": "202607", "sih_incompleto": None}},
                {"uf": "MS", "bytes_banco": 100663296, "defasagem": {"sia_ate": "202606", "sih_ate": "202607", "sia_incompleto": None, "sih_incompleto": None}}]}
        if cmd == "producao_plano":
            time.sleep(0.3)
            n = max(1, int(args.get("meses", 12))) * 2
            return {"uf": args["uf"], "itens": [{"arquivo": f"PA{args['uf']}{i:04d}.dbc", "bytes": 90_000_000, "competencia": "202607", "tipo": "SIA"} for i in range(n)],
                    "total_bytes": 90_000_000 * n, "precisa_confirmar": n * 90_000_000 > 500 * 1024 * 1024}
        if cmd in ("producao_baixar", "producao_importar", "producao_reconstruir"):
            return enviar("producao", "Produção", args.get("quando"), simular_producao)
        if cmd in ("producao_apagar", "producao_apagar_guardados"): return "simulação: nada foi apagado"
        if cmd == "manter_brutos_definir": estado["brutos"] = bool(args.get("ligada")); return estado["brutos"]
        # ---- Fase 3: comandos reais do CLI sobre --dados ----
        if cmd == "cnes_situacao": return cli_d("cnes-situacao")
        if cmd in ("cnes_baixar", "cnes_importar"):
            pedido = args.get("pedido") or {}
            uf = pedido.get("uf") or args.get("uf")
            fase = pedido.get("fase") or "tudo"
            return enviar("cnes", f"CNES de {uf}", args.get("quando"), lambda item: simular_cnes(uf, fase, item))
        if cmd == "cnes_competencias": time.sleep(0.5); return [{"competencia": c, "bytes": 310_000} for c in ("202608", "202607", "202606", "202605")]
        if cmd == "cnes_apagar": return cli_d("cnes-apagar", args["uf"], texto=True)
        if cmd == "cnes_buscar": return cli_d("cnes-buscar", args["uf"], args["texto"])
        if cmd == "unidade_definir": return cli_d("unidade-definir", args["uf"], args["cnes"])
        if cmd == "unidade_limpar": return cli_d("unidade-limpar")
        if cmd == "terceiro_adicionar": return cli_d("terceiro-adicionar", args["uf"], args["cnes"], args["terceiroUf"], args["terceiroCnes"])
        if cmd == "terceiro_remover": return cli_d("terceiro-remover", args["uf"], args["cnes"], args["terceiroUf"], args["terceiroCnes"], texto=True) and None
        if cmd == "aptidao_unidade":
            extra = []
            for chave, opcao in (("grupo", "--grupo"), ("q", "--q"), ("hab", "--hab")):
                if args.get(chave): extra += [opcao, str(args[chave])]
            if args.get("desde"): extra += ["--desde", str(int(args["desde"]))]
            if args.get("soProduzidosNaUf"): extra += ["--so-produzidos-na-uf"]
            alvo = [args["uf"], args["cnes"]] if args.get("uf") and args.get("cnes") else []
            return cli_d("aptidao-unidade", *alvo, *extra, *comp)
        if cmd == "unidade_ver": return cli_d("unidade", *([args["uf"], args["cnes"]] if args.get("uf") and args.get("cnes") else []), *comp)
        if cmd == "unidade_remover": return cli_d("unidade-remover", args["uf"], args["cnes"], texto=True) and None
        if cmd == "marcadores": return cli_d("marcadores", *args["codigos"], *comp)
        if cmd == "unidade_procedimentos": return cli_d("unidade-procedimentos", args["uf"], args["cnes"], *comp)
        if cmd == "unidades_buscar": return cli_d("unidades-buscar", args["texto"])
        if cmd == "cnes_verificar":
            time.sleep(0.4)
            if a.novidade and not estado.get("cnes_baixado"):
                return {"novas": [{"uf": "MS", "atual": "202608", "nova": "202609", "bytes": 310_000}], "erro": None}
            return {"novas": [], "erro": None}
        if cmd == "aptidao": return cli_d("aptidao", args["codigo"], *comp)
        if cmd == "rede": return cli_d("rede", args["codigo"], "--escopo", args.get("escopo") or "municipio", *comp)
        if args.get("tipo") == "cid" and cmd in ("marcar_favorito", "anotar", "marcado", "marcados"):
            # O CLI só guarda favoritos de procedimento: o de CID é simulado em memória (só para a UI).
            marcas = estado.setdefault("cid_marcas", {})
            if cmd == "marcados":
                return [{**m, "existe": True, "nome": ""} for m in marcas.values() if m["favorito"] or m["anotacao"]]
            m = marcas.setdefault(args["codigo"], {"tipo": "cid", "codigo": args["codigo"], "favorito": False, "favorito_desde": None, "anotacao": None, "anotacao_de": None})
            if cmd == "marcar_favorito":
                m["favorito"] = bool(args["favorito"]); m["favorito_desde"] = "2026-10-08" if m["favorito"] else None
            elif cmd == "anotar":
                m["anotacao"] = args["texto"] or None; m["anotacao_de"] = "2026-10-08" if m["anotacao"] else None
            return dict(m)
        if cmd == "marcar_favorito": return cli_d("favorito", args["codigo"], "sim" if args["favorito"] else "nao")
        if cmd == "anotar": return cli_d("anotar", args["codigo"], *([args["texto"]] if args["texto"] else []))
        if cmd == "marcado": return cli_d("marcado", args["codigo"])
        if cmd == "marcados": return cli_d("marcados", *comp)
        if cmd == "exportar":
            raiz_export = os.path.realpath("/tmp/ponte_export")
            nome = re.sub(r"[^A-Za-z0-9_.-]", "_", str(args["nome"]))
            destino = os.path.normpath(os.path.join(raiz_export, nome + ".xlsx"))
            if not destino.startswith(raiz_export + os.sep):
                raise RuntimeError("nome de arquivo inválido")
            os.makedirs(raiz_export, exist_ok=True)
            return cli_d("exportar", "--saida", destino, entrada=json.dumps(args["planilha"]), texto=True)
        raise RuntimeError(f"comando sem simulação na ponte: {cmd}")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *x, **k): super().__init__(*x, directory=str(raiz), **k)
        def log_message(s, *x): pass
        def do_GET(s):
            if s.path in ("/", "/index.html"):
                html = (raiz / "index.html").read_text(encoding="utf-8")
                if '<script src="formatos.js">' in html:
                    html = html.replace('<script src="formatos.js">', SHIM + '<script src="formatos.js">')
                else:  # interface nova (Vite): o shim entra antes de qualquer script do módulo
                    html = html.replace("<head>", "<head>" + SHIM, 1)
                b = html.encode(); s.send_response(200); s.send_header("Content-Type", "text/html; charset=utf-8"); s.end_headers(); s.wfile.write(b); return
            super().do_GET()
        def do_POST(s):
            if s.path == "/eventos":
                with trava: b = json.dumps(eventos).encode(); eventos.clear()
                s.send_response(200); s.send_header("Content-Type", "application/json"); s.end_headers(); s.wfile.write(b); return
            cmd = urllib.parse.urlparse(s.path).path.rsplit("/", 1)[-1]
            args = json.loads(s.rfile.read(int(s.headers.get("Content-Length", 0))) or b"{}")
            try: corpo, cod = json.dumps({"ok": tratar(cmd, args)}), 200
            except Exception as e: corpo, cod = json.dumps({"erro": str(e)}), 400
            b = corpo.encode(); s.send_response(cod); s.send_header("Content-Type", "application/json"); s.end_headers(); s.wfile.write(b)

    print(f"Interface em http://127.0.0.1:{a.porta}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", a.porta), H).serve_forever()

if __name__ == "__main__":
    main()
