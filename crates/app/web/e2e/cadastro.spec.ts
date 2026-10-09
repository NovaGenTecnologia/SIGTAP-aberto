import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

async function abrirCadastro(page: Page, rota = "/#/painel/cadastro") {
  await page.goto(rota);
  await expect(page.getByRole("heading", { level: 1, name: "Cadastro" })).toBeVisible();
  await expect(page.getByRole("table", { name: /Habilitações|Serviços|Leitos|Equipamentos/ })).toBeVisible();
}

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("Cadastro: abas com contagem, tabela de habilitações e sem violação de acessibilidade", async ({ page }) => {
  await abrirCadastro(page);
  await expect(page.getByRole("tab", { name: /^Habilitações \d+/, selected: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Telas da unidade" }).getByRole("link", { name: "Cadastro" })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: "test-results/cadastro-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("Cadastro: setas trocam de aba, a rota acompanha e a unidade se mantém", async ({ page }) => {
  await abrirCadastro(page);
  const nome = await page.locator(".un__unidade").textContent();
  await page.getByRole("tab", { name: /^Habilitações/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Serviços/, selected: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/painel\/cadastro\/servicos$/);
  await expect(page.getByRole("table", { name: "Serviços" })).toBeVisible();
  await expect(page.locator(".un__unidade")).toHaveText(nome ?? "");
  await semViolacoes(page);
});

test("Cadastro: o filtro restringe as linhas e fica na rota", async ({ page }) => {
  await abrirCadastro(page, "/#/painel/cadastro/servicos");
  const antes = await page.getByRole("table", { name: "Serviços" }).locator("tbody tr").count();
  await page.getByRole("searchbox", { name: /Filtrar/ }).fill("104");
  await expect(page).toHaveURL(/cadastro\/servicos\?q=104$/);
  const depois = await page.getByRole("table", { name: "Serviços" }).locator("tbody tr").count();
  expect(depois).toBeGreaterThan(0);
  expect(depois).toBeLessThan(antes);
});

test("Cadastro: Enter no link Ver da habilitação leva à Aptidão filtrada", async ({ page }) => {
  await abrirCadastro(page);
  const ver = page.getByRole("table", { name: "Habilitações" }).getByRole("link", { name: /Ver procedimentos da habilitação/ }).first();
  await ver.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/painel\/aptidao\/oportunidade\?hab=\w+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Aptidão" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remover filtro da habilitação/ })).toBeVisible();
});

test("Cadastro: aba Terceiros abre com a explicação e a busca", async ({ page }) => {
  await page.goto("/#/painel/cadastro/terceiros");
  await expect(page.getByRole("heading", { level: 1, name: "Cadastro" })).toBeVisible();
  await expect(page.getByText("Declarados por você")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: /Buscar estabelecimento/ })).toBeVisible();
  await semViolacoes(page);
});

test("Cadastro em 1024 px: sem rolagem horizontal da página", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirCadastro(page);
  const [largura, visivel] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(largura).toBeLessThanOrEqual(visivel!);
  await page.screenshot({ path: "test-results/cadastro-1024.png", fullPage: true });
  await semViolacoes(page);
});
