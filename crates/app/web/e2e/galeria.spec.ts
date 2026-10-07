import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("a galeria não tem violações de acessibilidade", async ({ page }) => {
  await page.goto("/#/galeria");
  await expect(page.getByRole("heading", { level: 1, name: "Galeria de componentes" })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("algarismos tabulares: 1 e 8 ocupam a mesma largura", async ({ page }) => {
  await page.goto("/#/galeria");
  await expect(page.getByRole("heading", { level: 1, name: "Galeria de componentes" })).toBeVisible();
  const [a, b] = await page.evaluate(() => ["t1", "t2"].map((id) => document.getElementById(id)!.getBoundingClientRect().width));
  expect(Math.abs(a! - b!)).toBeLessThan(0.5);
});

test("a tabela de 10 mil linhas só renderiza as linhas visíveis e navega por teclado", async ({ page }) => {
  await page.goto("/#/galeria");
  const tabela = page.getByRole("grid", { name: "Procedimentos de teste" });
  await tabela.scrollIntoViewIfNeeded();
  const linhas = await tabela.getByRole("row").count();
  expect(linhas).toBeGreaterThan(3);
  expect(linhas).toBeLessThan(200);
  await tabela.getByRole("row").nth(1).focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabela.getByRole("row").nth(2)).toBeFocused();
});

test("respeita prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/galeria");
  await expect(page.getByRole("heading", { level: 1, name: "Galeria de componentes" })).toBeVisible();
  const duracao = await page.evaluate(() => getComputedStyle(document.querySelector(".pontos i")!).animationDuration);
  expect(parseFloat(duracao)).toBeLessThan(0.05);
});
