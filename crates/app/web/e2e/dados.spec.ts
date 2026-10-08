import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
  await page.goto("/#/dados");
  await expect(page.getByRole("heading", { level: 1, name: "Dados" })).toBeVisible();
});

test("a aba SIGTAP lista as competências e não tem violações", async ({ page }) => {
  await expect(page.getByRole("grid", { name: "Competências do SIGTAP" })).toBeVisible();
  await semViolacoes(page);
});

test("as abas CNES e Produção não têm violações", async ({ page }) => {
  await page.getByRole("tab", { name: "CNES" }).click();
  await expect(page.getByRole("button", { name: "Baixar CNES" })).toBeVisible();
  await semViolacoes(page);
  await page.getByRole("tab", { name: "Produção" }).click();
  await expect(page.getByRole("grid", { name: "Produção carregada por estado" })).toBeVisible();
  await semViolacoes(page);
});

test("as abas se movem com as setas do teclado", async ({ page }) => {
  await page.getByRole("tab", { name: "SIGTAP" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "CNES" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Produção" })).toHaveAttribute("aria-selected", "true");
});

test("confirmar o apagar dos ZIPs: o diálogo é acessível, o foco começa em Cancelar e Esc fecha", async ({ page }) => {
  await page.getByRole("button", { name: "Apagar ZIPs já carregados" }).click();
  const dialogo = page.getByRole("alertdialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await semViolacoes(page);
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
});

test("o plano da produção abre o mesmo diálogo, grande ou pequeno, com a frase fixa", async ({ page }) => {
  await page.getByRole("tab", { name: "Produção" }).click();
  await page.getByRole("button", { name: "Ver o que será baixado" }).click();
  const dialogo = page.getByRole("alertdialog");
  await expect(dialogo).toContainText("O download pode demorar.");
  await expect(dialogo.getByRole("button", { name: "Baixar" })).toBeEnabled();
  await semViolacoes(page);
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
  // período longo: plano acima de 500 MB na ponte, mesmo diálogo, sem texto de limite
  await page.getByRole("button", { name: /Período/ }).click();
  await page.getByRole("option", { name: "24 meses" }).click();
  await page.getByRole("button", { name: "Ver o que será baixado" }).click();
  await expect(dialogo).toContainText("O download pode demorar.");
  expect((await dialogo.innerText()).toLowerCase()).not.toMatch(/limite|500|demora mais/);
  await page.keyboard.press("Escape");
});

test("o menu Manutenção abre por teclado e o diálogo de recriar não tem violações", async ({ page }) => {
  await page.getByRole("button", { name: "Manutenção" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Verificar bancos (rápido)" })).toBeVisible();
  await semViolacoes(page);
  await page.getByRole("menuitem", { name: /Recriar banco/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await semViolacoes(page);
  await page.keyboard.press("Escape");
});

test("durante um download simulado há progresso, as ações ficam desativadas e dá para cancelar", async ({ page }) => {
  await page.getByRole("button", { name: "Baixar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await expect(page.getByText("Já há um download de SIGTAP em andamento.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar de pasta" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText("Já há um download de SIGTAP em andamento.")).toBeHidden({ timeout: 15_000 });
});

test("a 1024 px nenhuma aba tem rolagem horizontal da página", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const aba of ["SIGTAP", "CNES", "Produção"]) {
    await page.getByRole("tab", { name: aba }).click();
    await expect(page.getByRole("tab", { name: aba })).toHaveAttribute("aria-selected", "true");
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra, `aba ${aba}`).toBeLessThanOrEqual(0);
  }
});

test("os botões de ação têm pelo menos 32 px de altura", async ({ page }) => {
  for (const aba of ["SIGTAP", "CNES", "Produção"]) {
    await page.getByRole("tab", { name: aba }).click();
    const alturas = await page.locator(".dados__aba button:not([disabled])").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(alturas.length, `aba ${aba}`).toBeGreaterThan(0);
    for (const h of alturas) expect(h, `aba ${aba}`).toBeGreaterThanOrEqual(31.5);
  }
});

test("os botões de cada linha da produção cabem na tabela, sem corte", async ({ page }) => {
  await page.getByRole("tab", { name: "Produção" }).click();
  const grade = page.getByRole("grid", { name: "Produção carregada por estado" });
  await expect(grade).toBeVisible();
  const caixa = (await grade.boundingBox())!;
  const botoes = page.locator(".dados__linha-acoes button");
  await expect(botoes.first()).toBeVisible();
  for (const b of await botoes.all()) {
    const c = (await b.boundingBox())!;
    expect(c.x, await b.innerText()).toBeGreaterThanOrEqual(caixa.x);
    expect(c.x + c.width, await b.innerText()).toBeLessThanOrEqual(caixa.x + caixa.width + 0.5);
  }
});
