import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

// O fechamento da unidade lê meses de produção inteiros: no CLI de depuração leva vários segundos.
const ESPERA = { timeout: 25_000 };

async function abrir(page: Page, caminho = "producao") {
  await page.goto(`/#/painel/${caminho}`);
  await expect(page.getByRole("heading", { level: 1, name: "Produção" })).toBeVisible();
}

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

const semRolagemHorizontal = async (page: Page) => {
  const [largura, visivel] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(largura).toBeLessThanOrEqual(visivel!);
};

test("Visão geral: cartões, séries e o que olhar, sem violação de acessibilidade", async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page);
  await expect(page.getByRole("heading", { name: "O que olhar agora" })).toBeVisible(ESPERA);
  await expect(page.getByRole("tab", { name: "Visão geral" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: "test-results/producao-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("as setas trocam de aba e a rota acompanha", async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page);
  await expect(page.getByRole("heading", { name: "O que olhar agora" })).toBeVisible(ESPERA);
  await page.getByRole("tab", { name: "Visão geral" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Rejeições/ })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#\/painel\/producao\/rejeicoes$/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Procedimentos/ })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#\/painel\/producao\/procedimentos$/);
});

test("Enter em um alerta de rejeição leva à aba Rejeições", async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page);
  const ver = page.getByRole("link", { name: "Ver nas Rejeições" }).first();
  if (await ver.count() === 0) test.skip(true, "a unidade de prova não tem alerta de rejeição");
  await ver.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/painel\/producao\/rejeicoes/);
  await expect(page.getByRole("tab", { name: /^Rejeições/ })).toHaveAttribute("aria-selected", "true");
});

test("Rejeições: mostra mais de cinco motivos e passa na acessibilidade", async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page, "producao/rejeicoes");
  const tabela = page.getByRole("table", { name: "Motivos de rejeição" });
  await expect(tabela).toBeVisible(ESPERA);
  const antes = await tabela.getByRole("row").count();
  expect(antes).toBeGreaterThan(5);
  await semViolacoes(page);
});

test("Procedimentos: busca vai ao servidor, Ver mais não repete linhas e SIA e SIH têm totais próprios", async ({ page }) => {
  test.setTimeout(90_000);
  await abrir(page, "producao/procedimentos");
  const tabela = page.getByRole("table", { name: /^Procedimentos por/ });
  await expect(tabela).toBeVisible(ESPERA);
  await expect(page.getByText(/^50 de [\d.]+ procedimentos$/)).toBeVisible();
  const totalSia = await page.locator(".un__contagem").innerText();

  await page.getByRole("button", { name: /^Ver mais \(/ }).click();
  await expect(page.getByText(/^100 de [\d.]+ procedimentos$/)).toBeVisible(ESPERA);
  const codigos = await tabela.locator("a.un__codigo").allInnerTexts();
  expect(codigos).toHaveLength(100);
  expect(new Set(codigos).size).toBe(100);

  const busca = page.getByRole("searchbox", { name: "Buscar por código ou nome" });
  await busca.fill("consulta");
  await expect(page).toHaveURL(/#\/painel\/producao\/procedimentos\?q=consulta/);
  await expect(page.getByText(/procedimentos$/).first()).not.toHaveText(totalSia, ESPERA);
  await busca.fill("");
  await expect(page).not.toHaveURL(/q=consulta/);

  await page.getByRole("link", { name: "SIH", exact: true }).click();
  await expect(page).toHaveURL(/#\/painel\/producao\/procedimentos\/sih/);
  await expect(page.getByRole("link", { name: "SIH", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".un__contagem")).toHaveText(/procedimentos$/, ESPERA);
  expect(await page.locator(".un__contagem").innerText()).not.toBe(totalSia);
  await page.screenshot({ path: "test-results/producao-procedimentos-sih-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("o filtro de classe fica na rota e o botão diz que está ligado", async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page, "producao/procedimentos");
  await expect(page.getByRole("table", { name: /^Procedimentos por/ })).toBeVisible(ESPERA);
  await page.getByRole("button", { name: "Classe A" }).click();
  await expect(page).toHaveURL(/#\/painel\/producao\/procedimentos\?classe=A/);
  await expect(page.getByRole("button", { name: "Classe A" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("td .un__selo").first()).toHaveText("A", ESPERA);
});

test("Fora do padrão: os quatro blocos, o recolhido abre pelo teclado e a página passa na acessibilidade", async ({ page }) => {
  test.setTimeout(90_000);
  await abrir(page, "producao/fora-do-padrao");
  const titulos = ["Quantidade atípica", "Permanência", "Serviços executados × cadastrados", "Instrumento divergente na UF"];
  for (const t of titulos) await expect(page.getByRole("region", { name: t })).toBeVisible(ESPERA);
  expect(await page.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual(titulos);
  const alternar = page.getByRole("button", { name: "Instrumento divergente na UF", exact: true });
  if (await alternar.count() > 0) {
    await expect(alternar).toHaveAttribute("aria-expanded", "false");
    await alternar.focus();
    await page.keyboard.press("Enter");
    await expect(alternar).toHaveAttribute("aria-expanded", "true");
  }
  await page.screenshot({ path: "test-results/producao-fora-do-padrao-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("Fora do padrão: ?bloco= leva o foco ao bloco pedido", async ({ page }) => {
  test.setTimeout(60_000);
  await abrir(page, "producao/fora-do-padrao?bloco=permanencia");
  await expect(page.getByRole("region", { name: "Permanência" })).toBeFocused(ESPERA);
});

test("Origem do valor: os seis blocos e a página passa na acessibilidade", async ({ page }) => {
  test.setTimeout(90_000);
  await abrir(page, "producao/origem-do-valor");
  const titulos = ["Financiamento", "Composição das AIH", "Perfil financeiro", "Reapresentação", "Leitos e ocupação", "Pares"];
  for (const t of titulos) await expect(page.getByRole("region", { name: t })).toBeVisible(ESPERA);
  expect(await page.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual(titulos);
  await expect(page.getByRole("table", { name: "Financiamento do SIA" })).toBeVisible();
  await page.getByRole("button", { name: "De onde vem: Financiamento" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "test-results/producao-origem-do-valor-1366.png", fullPage: true });
  await semViolacoes(page);
});

test("Produção em 1024 px: sem rolagem horizontal nas cinco abas", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const caminho of ["producao", "producao/rejeicoes", "producao/procedimentos", "producao/fora-do-padrao", "producao/origem-do-valor"]) {
    await abrir(page, caminho);
    await expect(page.locator(".pr").first()).toBeVisible(ESPERA);
    await expect(page.getByText("Lendo a produção da unidade")).toHaveCount(0, ESPERA);
    await semRolagemHorizontal(page);
  }
  await page.screenshot({ path: "test-results/producao-1024.png", fullPage: true });
  await semViolacoes(page);
});
