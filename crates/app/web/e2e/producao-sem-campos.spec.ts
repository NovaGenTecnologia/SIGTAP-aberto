import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Pasta de dados reais (MS) cujos meses foram baixados antes dos campos novos: os blocos opcionais dizem qual campo falta.
const temPonte = Boolean(process.env.SA_PONTE_DADOS_SEM_CAMPOS && process.env.SA_PONTE_BANCO_SEM_CAMPOS);
test.skip(!temPonte, "defina SA_PONTE_DADOS_SEM_CAMPOS e SA_PONTE_BANCO_SEM_CAMPOS para provar os avisos de campo ausente");
test.use({ baseURL: "http://127.0.0.1:8767" });

const ESPERA = { timeout: 25_000 };

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

test("Fora do padrão: cada bloco sem o campo diz qual falta e leva a Dados", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/painel/producao/fora-do-padrao");
  const servicos = page.getByRole("region", { name: "Serviços executados × cadastrados" });
  await expect(servicos.getByText("Sem o campo PA_SRV_C nos meses carregados. Baixe de novo para ver.")).toBeVisible(ESPERA);
  const instrumentos = page.getByRole("region", { name: "Instrumento divergente na UF" });
  await expect(instrumentos.getByText("Sem o campo PA_DOCORIG nos meses carregados. Baixe de novo para ver.")).toBeVisible();
  await expect(page.getByRole("table", { name: /Serviços executados fora do cadastro/ })).toHaveCount(0);
  await instrumentos.getByRole("button", { name: "Abrir em Dados" }).click();
  await expect(page).toHaveURL(/#\/dados/);
});

test("Origem do valor: perfil, composição e reapresentação sem o campo, e a página passa na acessibilidade", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/painel/producao/origem-do-valor");
  for (const [bloco, campo] of [["Composição das AIH", "SP_ATOPROF"], ["Perfil financeiro", "PA_REGCT"], ["Reapresentação", "PA_CMP"]]) {
    await expect(page.getByRole("region", { name: bloco! }).getByText(`Sem o campo ${campo} nos meses carregados. Baixe de novo para ver.`)).toBeVisible(ESPERA);
  }
  await page.screenshot({ path: "test-results/producao-sem-campos-1366.png", fullPage: true });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
});
