// Agendamento no Windows (Agendador de Tarefas), só para o usuário atual e sem administrador.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const NOME_TAREFA = "SIGTAP Aberto - Monitor de fontes";

function soWindows() {
  if (process.platform !== "win32") {
    throw new Error('O agendamento automático usa o Agendador de Tarefas do Windows. No Linux ou macOS, use o cron: */15 * * * * node /caminho/monitor.mjs rodar --silencioso');
  }
}

const PERIGOSOS = /["%&|<>^\r\n]/;

export async function agendar(minutos, script) {
  soWindows();
  for (const caminho of [process.execPath, script]) {
    if (PERIGOSOS.test(caminho)) throw new Error(`O caminho "${caminho}" tem caracteres que o agendador não aceita com segurança (aspas, % & | < > ^). Mova a pasta do monitor para um caminho simples, como C:\\monitor.`);
  }
  if (!Number.isInteger(minutos) || minutos < 5 || minutos > 1439) throw new Error("Informe o intervalo em minutos, de 5 a 1439.");
  const tr = `"${process.execPath}" "${script}" rodar --silencioso`;
  await exec("schtasks", ["/Create", "/TN", NOME_TAREFA, "/SC", "MINUTE", "/MO", String(minutos), "/TR", tr, "/F"]);
}

export async function desagendar() {
  soWindows();
  await exec("schtasks", ["/Delete", "/TN", NOME_TAREFA, "/F"]);
}

export async function situacao() {
  soWindows();
  try {
    const { stdout } = await exec("schtasks", ["/Query", "/TN", NOME_TAREFA, "/FO", "LIST"]);
    return stdout.trim();
  } catch {
    return null;
  }
}
