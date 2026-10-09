import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

async function abrirAptidao(page: Page, rota = "/#/painel/aptidao") {
  await page.goto(rota);
  await expect(page.getByRole("heading", { level: 1, name: "Aptidão" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Prioridade" })).toBeVisible();
  await expect(page.getByRole("table", { name: /Procedimentos/ })).toBeVisible();
}

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("Aptidão: abre num grupo, mostra a faixa e não tem violação de acessibilidade", async ({ page }) => {
  await abrirAptidao(page);
  await expect(page).toHaveURL(/#\/painel\/aptidao\/(risco|oportunidade|ordem)/);
  await expect(page.getByRole("navigation", { name: "Prioridade" }).locator("[aria-current=page]")).toHaveCount(1);
  await expect(page.getByText("Regra não confirmada")).toBeVisible();
  await page.screenshot({ path: "test-results/aptidao-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("Aptidão: troca de grupo por teclado e o foco continua na faixa", async ({ page }) => {
  await abrirAptidao(page, "/#/painel/aptidao/risco");
  const ordem = page.getByRole("navigation", { name: "Prioridade" }).getByRole("link", { name: /Em ordem/ });
  await ordem.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/painel\/aptidao\/ordem/);
  await expect(page.getByRole("table", { name: "Procedimentos em ordem" })).toBeVisible();
  await expect(ordem).toHaveAttribute("aria-current", "page");
  await expect(ordem).toBeFocused();
});

test("Aptidão: Oportunidade abre só com o que a UF produziu, e a busca vai ao servidor", async ({ page }) => {
  await abrirAptidao(page, "/#/painel/aptidao/oportunidade");
  const tabela = page.getByRole("table", { name: /Procedimentos/ });
  await expect(tabela.locator("tbody tr").first()).toBeVisible();
  expect(await tabela.locator("tbody tr").count()).toBeLessThanOrEqual(50);
  await page.getByRole("searchbox", { name: /Buscar por código ou nome/ }).fill("consulta");
  await expect(page).toHaveURL(/oportunidade\?q=consulta$/);
  await expect(page.locator(".un__contagem")).toContainText(/procedimento/);
  await semViolacoes(page);
});

test("Aptidão: Ver mais traz a próxima página sem repetir linhas", async ({ page }) => {
  await abrirAptidao(page, "/#/painel/aptidao/ordem");
  const tabela = page.getByRole("table", { name: /Procedimentos/ });
  const antes = await tabela.locator("tbody tr").count();
  const mais = page.getByRole("button", { name: /Ver mais/ });
  test.skip(!(await mais.count()), "a unidade de prova cabe numa página neste grupo");
  await mais.click();
  await expect(async () => expect(await tabela.locator("tbody tr").count()).toBeGreaterThan(antes)).toPass();
  const codigos = await tabela.locator("tbody tr td:first-child a").allTextContents();
  expect(new Set(codigos).size).toBe(codigos.length);
});

test("Aptidão em 1024 px: faixa e tabela sem rolagem horizontal da página", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirAptidao(page, "/#/painel/aptidao/risco");
  const [largura, visivel] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(largura).toBeLessThanOrEqual(visivel!);
  await page.screenshot({ path: "test-results/aptidao-1024.png", fullPage: true });
  await semViolacoes(page);
});

test("Painel: os cartões Cadastro e Aptidão levam às subtelas", async ({ page }) => {
  await page.goto("/#/painel");
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await page.getByRole("link", { name: /^Aptidão/ }).first().click();
  await expect(page).toHaveURL(/#\/painel\/aptidao/);
  await expect(page.getByRole("heading", { level: 1, name: "Aptidão" })).toBeVisible();
});
