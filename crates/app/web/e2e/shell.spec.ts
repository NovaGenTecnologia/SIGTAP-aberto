import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

test("o shell abre sem violações de acessibilidade", async ({ page }) => {
  await page.goto("/#/painel");
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("navegação por teclado: foco no trilho e Enter muda de destino", async ({ page }) => {
  await page.goto("/#/painel");
  await page.getByRole("link", { name: "Consultar" }).focus();
  await expect(page.getByRole("link", { name: "Consultar" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Consultar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Consultar" })).toHaveAttribute("aria-current", "page");
});

test("Ctrl+K abre a busca, o campo recebe o foco e Esc fecha", async ({ page }) => {
  await page.goto("/#/painel");
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Buscar" })).toBeFocused();
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Buscar" })).toBeHidden();
});

// Foco da revisão 5: janela de 1024 px
test("a 1024 px não há rolagem horizontal da página", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const rota of ["painel", "consultar", "mudancas", "conferir", "dados", "galeria"]) {
    await page.goto(`/#/${rota}`);
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra, `rota ${rota}`).toBeLessThanOrEqual(0);
  }
});

test("alvos interativos do shell têm pelo menos 32 px de altura", async ({ page }) => {
  await page.goto("/#/painel");
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("header button, header a, nav a, header [role=button]")]
      .map((e) => ({ t: e.textContent?.trim() ?? "", h: e.getBoundingClientRect().height }))
      .filter((x) => x.h > 0 && x.h < 32));
  expect(pequenos).toEqual([]);
});
