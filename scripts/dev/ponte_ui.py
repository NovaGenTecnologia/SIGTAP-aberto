#!/usr/bin/env python3
"""Ponte de desenvolvimento: serve a interface (crates/app/ui) num navegador comum, simulando
o window.__TAURI__ com chamadas à linha de comando (sigtap-aberto-cli). Só para testar telas;
o programa de verdade usa os comandos do Tauri.

Uso: python3 scripts/dev/ponte_ui.py --cli target/release/sigtap-aberto-cli --banco dados/sigtap.db [--porta 8765]
         [--zips PASTA_COM_ZIPS] [--primeira]

Download, importação e apagar ZIPs são SIMULADOS (eventos de progresso falsos; nada é baixado
nem apagado): servem só para ver as telas. A prova real está nos testes do sa-app.
"""
import argparse, json, subprocess, sqlite3, http.server, pathlib, urllib.parse, threading, time, re

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
    ap.add_argument("--zips", help="pasta com ZIPs oficiais (só para listar nomes e tamanhos na simulação)")
    ap.add_argument("--primeira", action="store_true", help="simula a primeira execução")
    a = ap.parse_args()
    eventos, trava = [], threading.Lock()
    estado = {"primeira": a.primeira, "ocupado": False, "cancelar": False}

    def emitir(nome, payload):
        with trava: eventos.append({"nome": nome, "payload": payload})

    def ofertas():
        itens = {}
        for f in sorted(pathlib.Path(a.zips).glob("TabelaUnificada_*.zip")) if a.zips else []:
            m = re.match(r"TabelaUnificada_(\d{6})_", f.name)
            if m: itens[m.group(1)] = f.stat().st_size
        carregadas = {c["competencia"] for c in situacao()["competencias"]}
        return {"servidor": "simulado", "competencias": [
            {"competencia": c, "tamanho": t, "guardado": c in carregadas, "carregado": c in carregadas} for c, t in sorted(itens.items())]}

    def simular(pedido):
        estado["ocupado"] = True; estado["cancelar"] = False
        n = {"vigente": 1, "6": 6, "12": 12, "24": 24, "tudo": 225}.get(pedido.get("sigtap", "vigente"), 1) if pedido.get("sigtap") != "nenhum" else 0
        ter = 2 if pedido.get("territorio") else 0
        emitir("progresso", {"resumo": "", "mensagem": "Consultando o servidor (simulado)", "fracao": 0, "indeterminado": True})
        time.sleep(1)
        total = 2 * n + ter
        for k in range(n):
            for f in (0.25, 0.5, 0.75):
                if estado["cancelar"]: break
                emitir("progresso", {"resumo": f"Fazendo download {k+1} de {n}; carregadas no banco {max(0,k-1)} de {n}" + ("; território pendente" if ter else ""),
                                     "mensagem": f"TabelaUnificada_simulada_{k+1}.zip: {f*2:.1f} de 2,0 MB".replace(".", ","), "fracao": (k + f + max(0, k - 1)) / total, "indeterminado": False})
                time.sleep(0.25)
            if estado["cancelar"]: break
        estado["ocupado"] = False
        if estado["cancelar"]:
            emitir("tarefa_fim", {"ok": False, "cancelada": True, "mensagem": "cancelado; o que já foi baixado fica guardado (simulação)"})
        else:
            emitir("progresso", {"resumo": f"Download concluído ({n} de {n}); carregadas no banco {n} de {n}", "mensagem": "", "fracao": 1, "indeterminado": False})
            emitir("tarefa_fim", {"ok": True, "cancelada": False, "mensagem": f"Concluído: {n} competência(s) baixada(s) (simulação; nada foi baixado)."})

    def cli(*args):
        p = subprocess.run([a.cli, *args, "--banco", a.banco], capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip().removeprefix("ERRO: "))
        return json.loads(p.stdout)

    def situacao():
        c = sqlite3.connect(a.banco)
        comps = [dict(competencia=r[0], rotulo=r[0][4:] + "/" + r[0][:4], arquivo=r[1], versao=r[2],
                      publicado_em=(f"{r[2][4:6]}/{r[2][2:4]}/20{r[2][:2]} {r[2][6:8]}:{r[2][8:10]}" if r[2] else None), sha256=r[3])
                 for r in c.execute("SELECT aaaamm, arquivo, versao, sha256 FROM sa_competencia ORDER BY seq")]
        z = [x for x in (sorted(pathlib.Path(a.zips).glob("TabelaUnificada_*.zip")) if a.zips else []) if x.name[16:22] in {c["competencia"] for c in comps}]
        tam = sum(x.stat().st_size for x in z); ult = max((x.name[16:22] for x in z), default=None)
        apag = [x for x in z if x.name[16:22] != ult]
        return dict(primeira_execucao=estado["primeira"], competencias=comps, territorio=None,
                    zips=dict(arquivos=len(z), bytes=tam, apagaveis=len(apag), bytes_apagaveis=sum(x.stat().st_size for x in apag), mantida=ult),
                    pasta_dados="(ponte de desenvolvimento)", ocupado=estado["ocupado"])

    def tratar(cmd, args):
        comp = ["--competencia", args["competencia"]] if args.get("competencia") else []
        if cmd == "situacao": return situacao()
        if cmd == "arvore": return cli("arvore", *([args["pai"]] if args.get("pai") else []), *comp)
        if cmd == "buscar": return cli("buscar", args["texto"], *comp)
        if cmd == "ficha":
            try: return cli("ficha", args["codigo"], *comp)
            except RuntimeError as e:
                if "não existe" in str(e): return None
                raise
        if cmd == "historico": return cli("historico", args["codigo"])
        if cmd == "mudou": return cli("mudou", *([args["tabela"], "--desde", str(args.get("desde") or 0)] if args.get("tabela") else []),
                                      *(["--de", args["de"]] if args.get("de") else []), *(["--competencia", args["para"]] if args.get("para") else []))
        if cmd == "ofertas": time.sleep(0.6); return ofertas()
        if cmd == "escolher_pasta": return "D:\\Downloads\\SIGTAP (simulado)"
        if cmd == "apagar_zips": return "simulação: nada foi apagado"
        if cmd == "cancelar": estado["cancelar"] = True; return None
        if cmd in ("baixar", "importar"):
            if estado["ocupado"]: raise RuntimeError("já existe uma tarefa em andamento. Espere terminar ou cancele.")
            threading.Thread(target=simular, args=(args.get("pedido") or {"sigtap": "vigente"},), daemon=True).start(); return None
        raise RuntimeError(f"comando sem simulação na ponte: {cmd}")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *x, **k): super().__init__(*x, directory=str(RAIZ), **k)
        def log_message(s, *x): pass
        def do_GET(s):
            if s.path in ("/", "/index.html"):
                html = (RAIZ / "index.html").read_text(encoding="utf-8").replace('<script src="formatos.js">', SHIM + '<script src="formatos.js">')
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
