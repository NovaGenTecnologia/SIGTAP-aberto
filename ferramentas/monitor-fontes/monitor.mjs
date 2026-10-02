#!/usr/bin/env node
// Monitor das fontes de dados do SIGTAP Aberto. Roda só no seu computador: confere se cada fonte
// está no ar, guarda o histórico e gera um relatório com gráficos. Sem dependências (Node 22+).
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executar } from "./src/sondas.mjs";
import { agregar, anexar, ler } from "./src/historico.mjs";
import { gerarHtml } from "./src/relatorio.mjs";
import { gerarDemo } from "./src/demo.mjs";
import { agendar, desagendar, situacao, NOME_TAREFA } from "./src/agenda.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const comando = argv[0] ?? "ajuda";
const tem = (nome) => argv.includes(`--${nome}`);
const valor = (nome) => { const i = argv.indexOf(`--${nome}`); return i >= 0 ? argv[i + 1] : undefined; };
const silencioso = tem("silencioso");
const dir = path.resolve(valor("dados") ?? path.join(AQUI, "dados"));
const dirDemo = path.join(AQUI, "dados-demo");
const dia = 86400e3;

const AJUDA = `Monitor das fontes de dados do SIGTAP Aberto

  node monitor.mjs verificar [--fonte id,id]   confere as fontes agora e grava no histórico
  node monitor.mjs relatorio [--abrir]         gera dados/relatorio.html com os gráficos
  node monitor.mjs rodar [--abrir]             verificar + relatorio (é o que o agendamento roda)
  node monitor.mjs agendar [minutos]           agenda no Windows (padrão: a cada 15 min)
  node monitor.mjs desagendar                  remove o agendamento
  node monitor.mjs situacao                    mostra se está agendado
  node monitor.mjs fontes                      lista as fontes do catálogo (fontes.json)
  node monitor.mjs demo [--abrir]              relatório com dados INVENTADOS, só para ver como fica

Opções: --dados PASTA (onde fica o histórico), --silencioso.`;

async function carregarFontes() {
  const todas = JSON.parse(await readFile(path.join(AQUI, "fontes.json"), "utf8"));
  const filtro = valor("fonte")?.split(",").map((x) => x.trim());
  if (!filtro) return todas;
  const sel = todas.filter((f) => filtro.includes(f.id));
  const faltam = filtro.filter((id) => !todas.some((f) => f.id === id));
  if (faltam.length) throw new Error(`fonte desconhecida: ${faltam.join(", ")}. Veja: node monitor.mjs fontes`);
  return sel;
}

function abrir(arquivo) {
  // Sem passar por shell (cmd interpretaria & ^ % do caminho): é o mesmo método que o programa usa.
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", arquivo]] : process.platform === "darwin" ? ["open", [arquivo]] : ["xdg-open", [arquivo]];
  execFile(cmd, args, () => {});
}

async function verificar() {
  const fontes = await carregarFontes();
  if (!silencioso) console.log(`Verificando ${fontes.length} fontes (uma consulta por vez em cada servidor)...`);
  const regs = await executar(fontes, {
    aoTerminar: (f, r) => {
      if (!silencioso) console.log(`${{ ok: "OK      ", instavel: "INSTÁVEL", fora: "FORA     " }[r.e]} ${String(r.ms).padStart(6)} ms  ${f.nome}${r.d ? `  [${r.d}]` : ""}`);
    },
  });
  await anexar(dir, regs);
  if (!silencioso) {
    const n = (e) => regs.filter((r) => r.e === e).length;
    console.log(`\n${n("ok")} online, ${n("instavel")} instáveis, ${n("fora")} fora do ar. Histórico em ${dir}`);
  }
}

async function relatorio(origem = dir, saida = path.join(dir, "relatorio.html")) {
  const fontes = JSON.parse(await readFile(path.join(AQUI, "fontes.json"), "utf8"));
  const agora = Date.now();
  const regs = await ler(origem, agora - 365 * dia);
  await mkdir(path.dirname(saida), { recursive: true });
  await writeFile(saida, gerarHtml(agregar(regs, fontes, agora)), "utf8");
  if (!silencioso) console.log(`Relatório: ${saida}`);
  if (tem("abrir")) abrir(saida);
}

try {
  switch (comando) {
    case "verificar": await verificar(); break;
    case "relatorio": await relatorio(); break;
    case "rodar": await verificar(); await relatorio(); break;
    case "agendar": {
      const min = Number(argv[1] ?? 15);
      await agendar(min, path.join(AQUI, "monitor.mjs"));
      console.log(`Agendado: a cada ${min} minutos, enquanto você estiver com o Windows aberto na sua conta. Tarefa: "${NOME_TAREFA}".`);
      break;
    }
    case "desagendar": await desagendar(); console.log("Agendamento removido."); break;
    case "situacao": console.log((await situacao()) ?? "Não está agendado."); break;
    case "fontes": for (const f of await carregarFontes()) console.log(`${f.id.padEnd(20)} ${f.tipo.padEnd(5)} ${f.futuro ? "(futura) " : ""}${f.nome}`); break;
    case "demo": {
      const fontes = JSON.parse(await readFile(path.join(AQUI, "fontes.json"), "utf8"));
      for (const nome of await readdir(dirDemo).catch(() => [])) if (/^historico-\d{4}-\d{2}\.jsonl$/.test(nome)) await rm(path.join(dirDemo, nome));
      const n = await gerarDemo(dirDemo, fontes);
      console.log(`${n.toLocaleString("pt-BR")} verificações inventadas em ${dirDemo}`);
      await relatorio(dirDemo, path.join(dirDemo, "relatorio.html"));
      break;
    }
    default: console.log(AJUDA);
  }
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exitCode = 1;
}
