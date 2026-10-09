import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = process.env.SA_PONTE_CLI;
const banco = process.env.SA_PONTE_BANCO;
const dados = process.env.SA_PONTE_DADOS;
if (!cli || !banco || !dados) {
  throw new Error("Defina SA_PONTE_CLI (caminho do sigtap-aberto-cli), SA_PONTE_BANCO (sigtap.db de desenvolvimento) e SA_PONTE_DADOS (pasta de dados de desenvolvimento) para rodar o e2e contra a ponte.");
}
const raizRepo = path.resolve(import.meta.dirname, "..", "..", "..");

// O assistente roda numa pasta de dados vazia e numa ponte própria em modo primeira execução. O CNES "baixado" vem de uma
// cópia local de desenvolvimento (nunca da rede); o estado da ponte muda a cada passo, então o servidor não é reaproveitado.
const origemCnes = path.resolve(dados, "..", "cnes", "MS");
const dadosVazios = fs.mkdtempSync(path.join(os.tmpdir(), "sigtap-assistente-"));
const python = process.env.SA_PYTHON ?? "python";
const ponte = path.join(raizRepo, "scripts", "dev", "ponte_ui.py");
const dist = path.join(import.meta.dirname, "dist");
// Opcional: uma ponte só de leitura sobre uma pasta de dados reais com meses sem os campos novos (MS), para provar os avisos de campo ausente.
const dadosSemCampos = process.env.SA_PONTE_DADOS_SEM_CAMPOS;
const bancoSemCampos = process.env.SA_PONTE_BANCO_SEM_CAMPOS;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8765", reducedMotion: "reduce" }, // a abertura de 2 s é provada em marca.spec.ts
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
  webServer: [
    {
      command: `${python} "${ponte}" --raiz "${dist}" --cli "${cli}" --banco "${banco}" --dados "${dados}"`,
      url: "http://127.0.0.1:8765/",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `${python} "${ponte}" --porta 8766 --primeira --raiz "${dist}" --cli "${cli}" --banco "${banco}" --dados "${dadosVazios}" --cnes-origem "${origemCnes}"`,
      url: "http://127.0.0.1:8766/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    ...(dadosSemCampos && bancoSemCampos
      ? [{
        command: `${python} "${ponte}" --porta 8767 --raiz "${dist}" --cli "${cli}" --banco "${bancoSemCampos}" --dados "${dadosSemCampos}"`,
        url: "http://127.0.0.1:8767/",
        reuseExistingServer: true,
        timeout: 30_000,
      }]
      : []),
  ],
});
