import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Ponte própria (porta 8766): primeira execução, pasta de dados vazia, download simulado e CNES importado da cópia local.
test.use({ baseURL: "http://127.0.0.1:8766" });

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test("as cinco etapas, só com o teclado, sem violações de acessibilidade", async ({ page }) => {
  test.setTimeout(90_000);
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });

  // 1. SIGTAP
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Tabela SIGTAP" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
  await expect(page.getByText(/não oficial/i)).toHaveCount(1);
  await semViolacoes(page);
  await page.getByRole("button", { name: "Baixar" }).focus();
  await page.keyboard.press("Enter");
  const meses = page.getByRole("dialog", { name: "Baixar também os meses anteriores?" });
  await expect(meses).toBeVisible();
  await semViolacoes(page); // com a pergunta dos meses aberta
  await page.keyboard.press("Tab");
  await page.getByRole("radio", { name: "Baixar mais meses" }).focus();
  await page.keyboard.press("Space"); // só com o teclado: escolhe baixar mais meses
  await meses.getByRole("button", { name: "Continuar" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await semViolacoes(page); // com o progresso na tela

  // 2. Estado: o foco vai para o título, e a escolha é por teclado
  const estado = page.getByRole("heading", { level: 1, name: "Seu estado" });
  await expect(estado).toBeVisible({ timeout: 20_000 });
  await expect(estado).toBeFocused();
  await semViolacoes(page);
  await page.getByRole("button", { name: /Estado/ }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Mato Grosso do Sul");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Mato Grosso do Sul \(MS\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).focus();
  await page.keyboard.press("Enter");

  // 3. CNES de MS (importado da cópia local pela ponte)
  await expect(page.getByRole("heading", { level: 1, name: "CNES de MS" })).toBeFocused();
  // 4. Unidade
  const unidade = page.getByRole("heading", { level: 1, name: "Sua unidade" });
  await expect(unidade).toBeVisible({ timeout: 30_000 });
  await expect(unidade).toBeFocused();
  await semViolacoes(page);
  await page.getByRole("searchbox", { name: "Buscar unidade" }).fill("hospital");
  const lista = page.getByRole("listbox", { name: "Unidades encontradas" });
  await expect(lista).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\d{11}/);
  await semViolacoes(page);
  await page.keyboard.press("Tab"); // do campo (e do botão de limpar, se houver) até a lista
  while (!(await lista.evaluate((el) => el.contains(document.activeElement)))) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  // 5. Pronto
  const pronto = page.getByRole("heading", { level: 1, name: "Tudo pronto" });
  await expect(pronto).toBeVisible();
  await expect(pronto).toBeFocused();
  await expect(page.getByText(/Unidade:/)).toBeVisible();
  await semViolacoes(page);
  await page.getByRole("button", { name: "Abrir o Painel" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  await expect(page).toHaveURL(/#\/painel$/);
});
