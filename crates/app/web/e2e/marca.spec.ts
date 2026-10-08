import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

test("a marca aparece no topo, legível, em 1024 px e sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto("/#/painel");
  const marca = page.getByRole("banner").getByRole("img", { name: "SIGTAP Aberto" });
  await expect(marca).toBeVisible();
  const caixa = await marca.boundingBox();
  expect(caixa!.height).toBeGreaterThanOrEqual(28);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("banner").screenshot({ path: "test-results/marca-topo.png" });
});

test("com redução de movimento a marca animada fica parada", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/galeria");
  await page.evaluate(() => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("class", "marca marca--inicial");
    s.innerHTML = '<circle class="marca__no" r="6"/>';
    document.body.appendChild(s);
  });
  const nome = await page.evaluate(() => getComputedStyle(document.querySelector(".marca--inicial .marca__no")!).animationName);
  expect(nome).toBe("none");
});

test.describe("abertura em 2 s", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a interface entra em cerca de 2 s e a animação toca inteira", async ({ page }) => {
    const inicio = Date.now();
    await page.goto("/#/painel");
    await expect(page.getByRole("img", { name: "SIGTAP Aberto" }).first()).toHaveClass(/marca--inicial/);
    await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible({ timeout: 4000 });
    const ms = Date.now() - inicio;
    expect(ms).toBeGreaterThanOrEqual(1800);
    expect(ms).toBeLessThanOrEqual(2600);
    await expect(page.locator(".abertura")).toHaveCount(0);
  });
});

