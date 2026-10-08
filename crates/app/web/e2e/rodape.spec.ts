import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
  await page.goto("/#/dados");
  await expect(page.getByRole("heading", { level: 1, name: "Dados" })).toBeVisible();
});

// A ponte guarda o estado entre os testes: cada teste termina sem tarefa nenhuma em andamento.
test.afterEach(async ({ page }) => {
  const rodape = page.locator("footer.rodape");
  const abrir = rodape.getByRole("button", { name: /Downloads em andamento/ });
  for (let i = 0; i < 4 && (await abrir.count()) > 0; i++) {
    await abrir.click();
    for (const nome of ["SIGTAP", "CNES", "Produção"]) {
      const cancelar = page.getByRole("button", { name: `Cancelar ${nome}` });
      if (await cancelar.count()) await cancelar.click();
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
  }
  await expect(abrir).toHaveCount(0, { timeout: 20_000 });
});

async function iniciarCnesESigtap(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "CNES" }).click();
  await page.getByRole("button", { name: "Baixar CNES" }).click();
  await page.getByRole("tab", { name: "SIGTAP" }).click();
  await page.getByRole("button", { name: "Baixar", exact: true }).click();
}

test("CNES e SIGTAP baixam juntos e o rodapé mostra as duas barras", async ({ page }) => {
  await iniciarCnesESigtap(page);
  const rodape = page.locator("footer.rodape");
  await expect(rodape.getByRole("progressbar", { name: "CNES" })).toBeVisible();
  await expect(rodape.getByRole("progressbar", { name: "SIGTAP" })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("o detalhe abre pelo teclado, cancela só a fonte escolhida e fecha com Esc", async ({ page }) => {
  await iniciarCnesESigtap(page);
  const abrir = page.locator("footer.rodape").getByRole("button", { name: /Downloads em andamento/ });
  await abrir.focus();
  await page.keyboard.press("Enter");
  const detalhe = page.getByRole("dialog", { name: "Downloads" });
  await expect(detalhe).toBeVisible();
  await detalhe.getByRole("button", { name: "Cancelar CNES" }).click();
  await expect(page.locator("footer.rodape").getByRole("progressbar", { name: "CNES" })).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("footer.rodape").getByRole("progressbar", { name: "SIGTAP" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detalhe).toBeHidden();
});

test("em 1024 px o rodapé não cria rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await iniciarCnesESigtap(page);
  await expect(page.locator("footer.rodape").getByRole("progressbar", { name: "CNES" })).toBeVisible();
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sobra).toBeLessThanOrEqual(0);
});

test("fechar com download em andamento pede confirmação, sem violações, e Continuar baixando mantém tudo", async ({ page }) => {
  await iniciarCnesESigtap(page);
  await expect(page.locator("footer.rodape").getByRole("progressbar", { name: "CNES" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __ouvintes: Record<string, Array<(e: { payload: null }) => void>> }).__ouvintes["pedido_de_fechar"]?.forEach((cb) => cb({ payload: null })));
  const d = page.getByRole("alertdialog", { name: "Fechar o programa agora?" });
  await expect(d).toBeVisible();
  await expect(d).toContainText("SIGTAP e CNES ainda estão baixando. Se fechar, eles param.");
  await expect(d.getByRole("button", { name: "Continuar baixando" })).toBeFocused();
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  await d.getByRole("button", { name: "Continuar baixando" }).click();
  await expect(d).toBeHidden();
  await expect(page.locator("footer.rodape").getByRole("progressbar", { name: "CNES" })).toBeVisible();
});
