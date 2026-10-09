import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

async function abrirMudancas(page: Page) {
  await page.goto("/#/mudancas");
  await expect(page.getByRole("heading", { level: 1, name: "Mudanças" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Valores alterados/ })).toBeVisible();
}

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("Mudanças: resumo, valores e seções, sem violação de acessibilidade", async ({ page }) => {
  await abrirMudancas(page);
  await expect(page.getByRole("region", { name: "Resumo das mudanças" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Habilitações exigidas/ })).toBeVisible();
  await page.screenshot({ path: "test-results/mudancas-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("Mudanças: Só o que me afeta liga por Espaço e a tela continua coerente", async ({ page }) => {
  await abrirMudancas(page);
  const interruptor = page.getByRole("switch", { name: "Só o que me afeta" });
  await interruptor.focus();
  await page.keyboard.press("Space");
  await expect(interruptor).toBeChecked();
  await expect(page).toHaveURL(/#\/mudancas\/\d{6}\/\d{6}\/afeta$/);
  await expect(interruptor).toBeFocused();
  // Com o filtro, toda linha de valor mostrada tem selo de quem afeta (ou a tela diz que nada afeta).
  const linhas = page.locator(".mud__tabela").first().locator("tbody tr");
  if (await linhas.count() > 0 && await page.getByText("Nada nesta mudança afeta a sua unidade").count() === 0) {
    for (const l of await linhas.all()) await expect(l.locator(".mud__selo")).not.toHaveCount(0);
  }
  await page.screenshot({ path: "test-results/mudancas-afeta-1366.png", fullPage: true });
  await semViolacoes(page);
  await page.keyboard.press("Space");
  await expect(interruptor).not.toBeChecked();
});

test("Mudanças: seção abre por teclado e mostra as mudanças", async ({ page }) => {
  await abrirMudancas(page);
  const secao = page.getByRole("button", { name: /Habilitações exigidas/ });
  await secao.focus();
  await page.keyboard.press("Enter");
  await expect(secao).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".mud__secao-painel .mud__tabela").first()).toBeVisible();
  await semViolacoes(page);
});

test("Mudanças em 1024 px: sem rolagem horizontal da página", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirMudancas(page);
  const [largura, visivel] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(largura).toBeLessThanOrEqual(visivel!);
  await page.screenshot({ path: "test-results/mudancas-1024.png", fullPage: true });
  await semViolacoes(page);
});
