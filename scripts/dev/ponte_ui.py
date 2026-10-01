#!/usr/bin/env python3
"""Ponte de desenvolvimento: serve a interface (crates/app/ui) num navegador comum, simulando
o window.__TAURI__ com chamadas à linha de comando (sigtap-aberto-cli). Só para testar telas;
o programa de verdade usa os comandos do Tauri.

Uso: python3 scripts/dev/ponte_ui.py --cli target/release/sigtap-aberto-cli --banco dados/sigtap.db [--porta 8765]
"""
import argparse, json, subprocess, sqlite3, http.server, pathlib, urllib.parse

RAIZ = pathlib.Path(__file__).resolve().parents[2] / "crates" / "app" / "ui"
SHIM = r"""<script>
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    const r = await fetch('/invoke/' + cmd, { method: 'POST', body: JSON.stringify(args || {}) });
    const j = await r.json(); if (!r.ok) throw j.erro; return j.ok; } },
  event: { listen: async () => () => {} },
};
</script>"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cli", required=True); ap.add_argument("--banco", required=True)
    ap.add_argument("--porta", type=int, default=8765)
    a = ap.parse_args()

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
        return dict(primeira_execucao=False, competencias=comps, territorio=None, zips_guardados=len(comps),
                    pasta_dados="(ponte de desenvolvimento)", ocupado=False)

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
        if cmd == "mudou": return cli("mudou", *(["--de", args["de"]] if args.get("de") else []), *(["--competencia", args["para"]] if args.get("para") else []))
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
            cmd = urllib.parse.urlparse(s.path).path.rsplit("/", 1)[-1]
            args = json.loads(s.rfile.read(int(s.headers.get("Content-Length", 0))) or b"{}")
            try: corpo, cod = json.dumps({"ok": tratar(cmd, args)}), 200
            except Exception as e: corpo, cod = json.dumps({"erro": str(e)}), 400
            b = corpo.encode(); s.send_response(cod); s.send_header("Content-Type", "application/json"); s.end_headers(); s.wfile.write(b)

    print(f"Interface em http://127.0.0.1:{a.porta}/")
    http.server.ThreadingHTTPServer(("127.0.0.1", a.porta), H).serve_forever()

if __name__ == "__main__":
    main()
