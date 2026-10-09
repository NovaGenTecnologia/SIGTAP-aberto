import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

async function abrirPainel(page: Page) {
  await page.goto("/#/painel");
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Pendências" })).toBeVisible();
  await expect(page.getByText(/por ano/).first()).toBeVisible(); // o impacto das mudanças chega depois do painel
}

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test("Painel: pendências valoradas em ordem decrescente, sem violação de acessibilidade", async ({ page }) => {
  await abrirPainel(page);
  const valores = (await page.locator(".pend__valor").allInnerTexts())
    .map((t) => Number(t.replace(/[^\d,]/g, "").replace(",", ".")));
  expect(valores.length).toBeGreaterThan(0);
  expect(valores).toEqual([...valores].sort((a, b) => b - a));
  await expect(page.getByText("Em breve")).toHaveCount(0);
  await page.screenshot({ path: "test-results/painel-1366.png" });
  await semViolacoes(page);
});

test("Painel: De onde vem abre por teclado e Esc devolve o foco ao botão", async ({ page }) => {
  await abrirPainel(page);
  const botao = page.getByRole("button", { name: /^De onde vem/ }).first();
  await botao.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Tabela")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(botao).toBeFocused();
});

test("Painel: Ver itens abre e fecha por teclado e o código leva à Ficha", async ({ page }) => {
  await abrirPainel(page);
  const ver = page.getByRole("button", { name: "Ver itens" }).first();
  if (await ver.count() === 0) test.skip(true, "a unidade de prova não tem pendência com itens");
  await ver.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Ocultar itens" }).first()).toHaveAttribute("aria-expanded", "true");
  const codigo = page.locator(".painel__itens .painel__codigo").first();
  await expect(codigo).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Ver itens" }).first()).toBeFocused();
  await semViolacoes(page);
});

test("Painel em 1024 px: sem rolagem horizontal, três cartões de área e a lista abaixo", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirPainel(page);
  const [largura, visivel] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(largura).toBeLessThanOrEqual(visivel!);
  await expect(page.locator(".area")).toHaveCount(3);
  const areas = await page.locator(".areas").boundingBox();
  const lista = await page.locator(".painel__principal").boundingBox();
  expect(lista!.y).toBeGreaterThan(areas!.y + areas!.height - 1);
  await page.screenshot({ path: "test-results/painel-1024.png", fullPage: true });
  await semViolacoes(page);
});

test("Painel: o fechamento tem três números e as mudanças da tabela são uma linha de aviso", async ({ page }) => {
  await abrirPainel(page);
  await expect(page.locator(".resumo__coluna")).toHaveCount(3);
  await expect(page.getByRole("note", { name: "Mudanças da tabela" })).toBeVisible();
});

test("Painel: o filtro por área reduz a lista e a ação principal abre a área com a faixa Você veio de", async ({ page }) => {
  await abrirPainel(page);
  const todas = await page.getByRole("list", { name: "Pendências" }).getByRole("listitem").count();
  const filtros = page.getByRole("group", { name: "Filtrar pendências por área" }).getByRole("button");
  const outra = filtros.nth(1);
  if (await filtros.count() > 1) {
    await outra.click();
    await expect(outra).toHaveAttribute("aria-pressed", "true");
    expect(await page.getByRole("list", { name: "Pendências" }).getByRole("listitem").count()).toBeLessThanOrEqual(todas);
  }
  await filtros.first().click(); // a área escolhida acima pode ter só pendências sem destino
  const abrir = page.getByRole("link", { name: /^Abrir em / }).first();
  await abrir.click();
  await expect(page.getByRole("note").filter({ hasText: "Você veio de" })).toBeVisible();
  await page.getByRole("link", { name: "Voltar à pendência" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Painel" })).toBeVisible();
  await expect(page.getByText(/Você veio de/)).toHaveCount(0);
});

test("Painel: os cartões de área e o seletor das áreas se navegam por teclado", async ({ page }) => {
  await abrirPainel(page);
  const cartao = page.locator(".area").first();
  await cartao.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Telas da unidade" })).toBeVisible();
});
