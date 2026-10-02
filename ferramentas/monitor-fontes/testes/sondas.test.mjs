import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { sondaFtp, tirarResposta } from "../src/ftp.mjs";
import { sondaHttp } from "../src/http.mjs";

const fechar = (s) => new Promise((ok) => s.close(ok));
const ouvir = (s) => new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(s.address().port)));

/** Servidor FTP de mentira. modo: "ok" | "porta-morta-1" | "porta-morta-sempre" | "login-recusado" | "sem-arquivo". */
async function ftpFalso(modo) {
  const dados = net.createServer((s) => { s.on("error", () => {}); });
  const portaDados = await ouvir(dados);
  const morta = net.createServer();
  const portaMorta = await ouvir(morta);
  await fechar(morta);
  let pasv = 0;
  let carga = Buffer.alloc(0);
  let ultimoDados = null;
  dados.on("connection", (s) => { ultimoDados = s; });
  const controle = net.createServer((c) => {
    c.on("error", () => {});
    c.write("220 fake\r\n");
    let buf = "";
    c.on("data", (d) => {
      buf += d.toString("latin1");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const linha = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [cmd, ...resto] = linha.split(" ");
        const arg = resto.join(" ");
        if (cmd === "USER") c.write(modo === "login-recusado" ? "530 sem acesso\r\n" : "331 senha\r\n");
        else if (cmd === "PASS") c.write("230 ok\r\n");
        else if (cmd === "TYPE") c.write("200 ok\r\n");
        else if (cmd === "CWD") c.write("250 ok\r\n");
        else if (cmd === "SIZE") c.write(modo === "sem-arquivo" ? "550 nao existe\r\n" : "213 331776\r\n");
        else if (cmd === "PASV") {
          pasv += 1;
          const morto = modo === "porta-morta-sempre" || (modo === "porta-morta-1" && pasv === 1);
          const p = morto ? portaMorta : portaDados;
          c.write(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})\r\n`);
        } else if (cmd === "LIST") {
          c.write("150 listando\r\n");
          setTimeout(() => { ultimoDados.end("-rw-r--r-- 1 ftp ftp 2300000 Sep 17 TabelaUnificada_202609_v2609171117.zip\r\n"); c.write("226 fim\r\n"); }, 20);
        } else if (cmd === "REST") c.write("350 ok\r\n");
        else if (cmd === "RETR") {
          c.write("150 abrindo\r\n");
          setTimeout(() => { ultimoDados.write(carga.length ? carga : Buffer.alloc(9000, 7)); }, 20);
        } else if (cmd === "QUIT") c.end("221 tchau\r\n");
        else c.write("502 nao\r\n");
      }
    });
  });
  const porta = await ouvir(controle);
  return { porta, fim: async () => { ultimoDados?.destroy(); await fechar(controle); await fechar(dados); } };
}

const def = (porta, extra) => ({ host: "127.0.0.1", porta, comando: { cwd: "/x" }, ...extra });

test("tirarResposta junta respostas de várias linhas", () => {
  const r = tirarResposta("220-bem-vindo\r\n  ao servidor\r\n220 pronto\r\n331 senha\r\n");
  assert.equal(r.codigo, 220);
  assert.match(r.texto, /pronto/);
  assert.equal(r.resto, "331 senha\r\n");
  assert.equal(tirarResposta("220 incompleta"), null);
});

test("FTP ok: listagem confere o conteúdo", async () => {
  const s = await ftpFalso("ok");
  const r = await sondaFtp(def(s.porta, { dados: { listar: "/x", contem: "TabelaUnificada_" } }), { tempoCanal: 500 });
  assert.equal(r.estado, "ok", r.detalhe);
  assert.equal(r.x.portas, 1);
  await s.fim();
});

test("FTP: listagem sem o texto esperado é falha", async () => {
  const s = await ftpFalso("ok");
  const r = await sondaFtp(def(s.porta, { dados: { listar: "/x", contem: "NaoExiste" } }), { tempoCanal: 500 });
  assert.equal(r.estado, "fora");
  assert.match(r.detalhe, /NaoExiste/);
  await s.fim();
});

test("FTP: porta de dados morta na primeira tentativa vira instável (como no programa)", async () => {
  const s = await ftpFalso("porta-morta-1");
  const r = await sondaFtp(def(s.porta, { comando: { size: "/a.dbc" }, dados: { parcial: { caminho: "/a.dbc", inicio: 100, bytes: 4096 } } }), { tempoCanal: 500 });
  assert.equal(r.estado, "instavel", r.detalhe);
  assert.equal(r.x.portas, 2);
  assert.equal(r.x.recebidos, 4096);
  assert.equal(r.x.bytes, 331776);
  await s.fim();
});

test("FTP: nenhuma das 3 portas abre é falha", async () => {
  const s = await ftpFalso("porta-morta-sempre");
  const r = await sondaFtp(def(s.porta, { dados: { listar: "/x" } }), { tempoCanal: 300 });
  assert.equal(r.estado, "fora");
  assert.match(r.detalhe, /nenhuma das 3 portas/);
  assert.equal(r.x.portas, 3);
  await s.fim();
});

test("FTP: login recusado e arquivo inexistente são falhas com motivo", async () => {
  let s = await ftpFalso("login-recusado");
  let r = await sondaFtp(def(s.porta));
  assert.equal(r.estado, "fora");
  assert.match(r.detalhe, /530/);
  await s.fim();
  s = await ftpFalso("sem-arquivo");
  r = await sondaFtp(def(s.porta, { comando: { size: "/nada.zip" } }));
  assert.equal(r.estado, "fora");
  assert.match(r.detalhe, /550/);
  await s.fim();
});

test("FTP: servidor que não existe é falha rápida", async () => {
  const s = net.createServer();
  const porta = await ouvir(s);
  await fechar(s);
  const r = await sondaFtp(def(porta));
  assert.equal(r.estado, "fora");
  assert.match(r.detalhe, /falhou|ECONNREFUSED/);
});

test("HTTP: ok, JSON com mínimo de itens, código ruim e lentidão", async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === "/ok") res.end("<html>oi</html>");
    else if (req.url === "/json") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(Array.from({ length: 10 }, (_, i) => i))); }
    else if (req.url === "/texto") res.end("nao e json");
    else if (req.url === "/lento") setTimeout(() => res.end("devagar"), 250);
    else { res.statusCode = 503; res.end("ruim"); }
  });
  const p = await ouvir(srv);
  const u = (c) => `http://127.0.0.1:${p}${c}`;
  assert.equal((await sondaHttp({ url: u("/ok") })).estado, "ok");
  assert.equal((await sondaHttp({ url: u("/json"), json: true, min_itens: 10 })).estado, "ok");
  const poucos = await sondaHttp({ url: u("/json"), json: true, min_itens: 11 });
  assert.equal(poucos.estado, "fora");
  assert.match(poucos.detalhe, /10 itens/);
  assert.match((await sondaHttp({ url: u("/texto"), json: true })).detalhe, /JSON/);
  const ruim = await sondaHttp({ url: u("/erro") });
  assert.equal(ruim.estado, "fora");
  assert.equal(ruim.detalhe, "HTTP 503");
  assert.equal((await sondaHttp({ url: u("/erro"), aceitar_ate: 599 })).estado, "ok");
  assert.equal((await sondaHttp({ url: u("/lento"), limite_lento_ms: 100 })).estado, "instavel");
  const curto = await sondaHttp({ url: u("/lento"), tempo_ms: 50 });
  assert.equal(curto.estado, "fora");
  assert.match(curto.detalhe, /sem resposta/);
  await fechar(srv);
});
