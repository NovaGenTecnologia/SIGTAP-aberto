// Sonda FTP: conecta, entra como anônimo, confere um comando e, se pedido, abre o canal de dados
// como o programa faz (até 3 portas passivas, 10 s cada) e lê uns bytes. Sem dependências.
import net from "node:net";

const SEG = (ms) => Math.round(ms / 1000);

const esperar = (promessa, ms, rotulo) =>
  new Promise((ok, erro) => {
    const t = setTimeout(() => erro(new Error(`${rotulo}: sem resposta em ${SEG(ms)} s`)), ms);
    promessa.then(
      (v) => { clearTimeout(t); ok(v); },
      (e) => { clearTimeout(t); erro(e); },
    );
  });

/** Tira a primeira resposta completa do texto recebido (trata respostas de várias linhas). */
export function tirarResposta(buf) {
  let pos = 0;
  let codigo = null;
  const texto = [];
  for (;;) {
    const nl = buf.indexOf("\n", pos);
    if (nl < 0) return null;
    const linha = buf.slice(pos, nl).replace(/\r$/, "");
    pos = nl + 1;
    const m = /^(\d{3})([ -])/.exec(linha);
    if (codigo === null) {
      if (!m) return { codigo: 0, texto: linha, resto: buf.slice(pos) };
      codigo = m[1];
      texto.push(linha.slice(4));
      if (m[2] === " ") return { codigo: Number(codigo), texto: texto.join("\n"), resto: buf.slice(pos) };
    } else {
      texto.push(linha);
      if (linha.startsWith(`${codigo} `)) return { codigo: Number(codigo), texto: texto.join("\n"), resto: buf.slice(pos) };
    }
  }
}

class Controle {
  constructor(socket) {
    this.s = socket;
    this.buf = "";
    this.fila = [];
    this.erro = null;
    this.fechado = false;
    socket.setEncoding("latin1");
    socket.on("data", (d) => { this.buf += d; this.drenar(); });
    socket.on("error", (e) => { this.erro = e; this.drenar(); });
    socket.on("close", () => { this.fechado = true; this.drenar(); });
  }

  drenar() {
    while (this.fila.length) {
      const r = tirarResposta(this.buf);
      if (r) { this.buf = r.resto; this.fila.shift().ok(r); continue; }
      if (this.erro) { this.fila.shift().erro(new Error(`conexão de controle: ${this.erro.code || this.erro.message}`)); continue; }
      if (this.fechado) { this.fila.shift().erro(new Error("o servidor fechou a conexão")); continue; }
      break;
    }
  }

  ler() { return new Promise((ok, erro) => { this.fila.push({ ok, erro }); this.drenar(); }); }

  async cmd(linha, esperados) {
    this.s.write(`${linha}\r\n`);
    const r = await this.ler();
    if (!esperados.includes(r.codigo)) {
      const nome = linha.startsWith("PASS") ? "PASS" : linha;
      throw new Error(`"${nome}" recusado pelo servidor: ${r.codigo} ${r.texto.split("\n")[0]}`);
    }
    return r;
  }
}

function conectar(host, porta, ms) {
  return new Promise((ok, erro) => {
    const s = net.connect({ host, port: porta });
    const t = setTimeout(() => { s.destroy(); erro(new Error(`conexão com ${host}:${porta} sem resposta em ${SEG(ms)} s`)); }, ms);
    s.once("connect", () => { clearTimeout(t); ok(s); });
    s.once("error", (e) => { clearTimeout(t); erro(new Error(`conexão com ${host}:${porta} falhou (${e.code || e.message})`)); });
  });
}

function lerBytes(socket, limite) {
  return new Promise((ok, erro) => {
    const partes = [];
    let n = 0;
    const fim = () => ok(Buffer.concat(partes).subarray(0, limite));
    socket.on("data", (d) => { partes.push(d); n += d.length; if (n >= limite) { socket.destroy(); fim(); } });
    socket.once("end", fim);
    socket.once("close", fim);
    socket.once("error", (e) => erro(new Error(`canal de dados: ${e.code || e.message}`)));
  });
}

/**
 * Faz uma verificação. `def`: { host, porta?, comando: {cwd}|{size}, dados?: {listar, contem?}|{parcial:{caminho,inicio,bytes}},
 * limite_lento_ms? }. Devolve { estado: "ok"|"instavel"|"fora", ms, detalhe, x: etapas em ms e portas usadas }.
 */
export async function sondaFtp(def, opc = {}) {
  const tempo = opc.tempo ?? 20000;
  const tempoCanal = opc.tempoCanal ?? 10000;
  const tentativas = opc.tentativasCanal ?? 3;
  const lento = def.limite_lento_ms ?? 15000;
  const x = {};
  const ini = performance.now();
  let marca = ini;
  const etapa = (nome) => { const agora = performance.now(); x[nome] = Math.round(agora - marca); marca = agora; };
  let c;
  try {
    c = new Controle(await conectar(def.host, def.porta ?? 21, tempo));
    etapa("conexao");
    const banner = await esperar(c.ler(), tempo, "boas-vindas");
    if (banner.codigo !== 220) throw new Error(`boas-vindas inesperadas: ${banner.codigo} ${banner.texto}`);
    const u = await esperar(c.cmd("USER anonymous", [230, 331]), tempo, "login");
    if (u.codigo === 331) await esperar(c.cmd("PASS monitor@sigtap-aberto.invalid", [230]), tempo, "login");
    etapa("login");
    await esperar(c.cmd("TYPE I", [200]), tempo, "TYPE");

    if (def.comando?.cwd) await esperar(c.cmd(`CWD ${def.comando.cwd}`, [250]), tempo, "CWD");
    else if (def.comando?.size) {
      const r = await esperar(c.cmd(`SIZE ${def.comando.size}`, [213]), tempo, "SIZE");
      x.bytes = Number(r.texto.trim());
      if (!(x.bytes > 0)) throw new Error(`tamanho inválido para ${def.comando.size}: ${r.texto}`);
    }
    etapa("comando");

    if (def.dados) {
      let d = null;
      let ultimo = "";
      let portas = 0;
      while (!d && portas < tentativas) {
        portas += 1;
        const r = await esperar(c.cmd("PASV", [227]), tempo, "PASV");
        const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(r.texto);
        if (!m) throw new Error(`resposta PASV ilegível: ${r.texto}`);
        try { d = await conectar(def.host, Number(m[5]) * 256 + Number(m[6]), tempoCanal); } catch (e) { ultimo = e.message; }
      }
      x.portas = portas;
      if (!d) throw new Error(`canal de dados: nenhuma das ${tentativas} portas abriu (${ultimo})`);
      etapa("canal");
      if (def.dados.listar) {
        await esperar(c.cmd(`LIST ${def.dados.listar}`, [125, 150]), tempo, "LIST");
        const buf = await esperar(lerBytes(d, 262144), tempo, "listagem");
        const fim = await esperar(c.ler(), tempo, "fim da listagem");
        if (fim.codigo !== 226) throw new Error(`listagem terminou com ${fim.codigo} ${fim.texto}`);
        if (def.dados.contem && !buf.toString("latin1").includes(def.dados.contem)) {
          throw new Error(`a listagem de ${def.dados.listar} não traz "${def.dados.contem}"`);
        }
      } else if (def.dados.parcial) {
        const { caminho, inicio = 0, bytes = 4096 } = def.dados.parcial;
        if (inicio > 0) await esperar(c.cmd(`REST ${inicio}`, [350]), tempo, "REST");
        await esperar(c.cmd(`RETR ${caminho}`, [125, 150]), tempo, "RETR");
        const buf = await esperar(lerBytes(d, bytes), tempo, "download parcial");
        if (buf.length === 0) throw new Error("o servidor abriu o canal mas não enviou nenhum byte");
        x.recebidos = buf.length;
      }
      etapa("transferencia");
    }
    try { c.s.write("QUIT\r\n"); } catch { /* já fechada */ }

    const total = Math.round(performance.now() - ini);
    if ((x.portas ?? 1) > 1) return { estado: "instavel", ms: total, detalhe: `o canal de dados precisou de ${x.portas} portas`, x };
    if (total > lento) return { estado: "instavel", ms: total, detalhe: `resposta lenta (${SEG(total)} s)`, x };
    return { estado: "ok", ms: total, detalhe: "", x };
  } catch (e) {
    return { estado: "fora", ms: Math.round(performance.now() - ini), detalhe: String(e.message).slice(0, 300), x };
  } finally {
    c?.s.destroy();
  }
}
