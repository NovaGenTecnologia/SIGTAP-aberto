import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const cli = process.env.SA_PONTE_CLI;
const banco = process.env.SA_PONTE_BANCO;
const dados = process.env.SA_PONTE_DADOS;
if (!cli || !banco || !dados) {
  throw new Error("Defina SA_PONTE_CLI (caminho do sigtap-aberto-cli), SA_PONTE_BANCO (sigtap.db de desenvolvimento) e SA_PONTE_DADOS (pasta de dados de desenvolvimento) para rodar o e2e contra a ponte.");
}
const raizRepo = path.resolve(import.meta.dirname, "..", "..", "..");

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8765" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: `${process.env.SA_PYTHON ?? "python"} "${path.join(raizRepo, "scripts", "dev", "ponte_ui.py")}" --raiz "${path.join(import.meta.dirname, "dist")}" --cli "${cli}" --banco "${banco}" --dados "${dados}"`,
    url: "http://127.0.0.1:8765/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
