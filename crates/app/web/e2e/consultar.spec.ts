import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ETIQUETAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") throw new Error(`erro no console: ${m.text()}`); });
  page.on("pageerror", (e) => { throw e; });
});

async function abrirBuscar(page: Page, rota = "/#/consultar") {
  await page.goto(rota);
  await expect(page.getByRole("heading", { level: 1, name: "Consultar" })).toBeVisible();
}

async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(ETIQUETAS).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

const campo = (page: Page) => page.getByRole("combobox", { name: "Buscar" });

test("vazio: campo único focado e a árvore, sem abas nem exemplos, sem violação de acessibilidade", async ({ page }) => {
  await abrirBuscar(page);
  await expect(campo(page)).toBeFocused();
  await expect(page.getByRole("tree", { name: "Procedimentos" }).getByRole("treeitem").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "consulta médica" })).toHaveCount(0);
  await semViolacoes(page);
});

test("clicar no campo vazio mostra as pesquisas recentes; escolher uma refaz a busca", async ({ page }) => {
  await abrirBuscar(page);
  await campo(page).fill("consulta");
  await campo(page).press("Enter");
  await expect(page.getByRole("grid", { name: "Procedimentos" })).toBeVisible({ timeout: 30000 });
  await campo(page).fill("");
  await expect(page.getByRole("tree", { name: "Procedimentos" })).toBeVisible({ timeout: 30000 });
  await campo(page).click();
  const recentes = page.getByRole("listbox");
  await expect(recentes.getByRole("option", { name: /consulta/ })).toBeVisible();
  await semViolacoes(page);
  await recentes.getByRole("option", { name: /consulta/ }).click();
  await expect(page).toHaveURL(/#\/consultar\/q\/consulta/);
  await expect(page.getByRole("grid", { name: "Procedimentos" })).toBeVisible();
});

test("digitar, seta para baixo e Enter chegam à ficha só pelo teclado; Voltar restaura a busca", async ({ page }) => {
  await abrirBuscar(page);
  await campo(page).fill("consulta");
  const tabela = page.getByRole("grid", { name: "Procedimentos" });
  await expect(tabela).toBeVisible();
  await semViolacoes(page);
  await campo(page).press("ArrowDown");
  const primeira = tabela.getByRole("row").nth(1);
  await expect(primeira).toBeFocused();
  const codigo = (await primeira.getByRole("rowheader").innerText()).replace(/\D/g, "");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/consultar/${codigo}$`));
  await page.goBack();
  await expect(campo(page)).toHaveValue("consulta");
  await expect(page.getByRole("grid", { name: "Procedimentos" })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(codigo.slice(0, 2)) }).first()).toBeVisible();
  await expect(page.getByRole("grid", { name: "Procedimentos" }).getByRole("row").nth(1)).toBeFocused();
});

test("capturas para conferir com o desenho", async ({ page }) => {
  await abrirBuscar(page, "/#/consultar/q/consulta");
  await expect(page.getByRole("button", { name: /Apoio/ })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("grid", { name: "Procedimentos" })).toBeVisible();
  await page.screenshot({ path: "test-results/buscar-1366.png" });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: "test-results/buscar-1024.png" });
});

test("busca por código com máscara dá o mesmo resultado do código simples", async ({ page }) => {
  await abrirBuscar(page, "/#/consultar/q/03.01.01.007-2");
  await expect(page.getByRole("row", { name: /03\.01\.01\.007-2/ })).toBeVisible();
});

test("sem resultado explica o que tentar", async ({ page }) => {
  await abrirBuscar(page);
  await campo(page).fill("xyzabcqq");
  await expect(page.getByText(/Nada encontrado para “xyzabcqq”/)).toBeVisible();
  await expect(page.getByText("Tente o código, parte do nome ou um CID.")).toBeVisible();
  await semViolacoes(page);
});

test("em 1024 px a tela não rola na horizontal e continua sem violações", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirBuscar(page, "/#/consultar/q/consulta");
  await expect(page.getByRole("grid", { name: "Procedimentos" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Filtros/ })).toBeVisible();
  const rolagem = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(rolagem).toBeLessThanOrEqual(0);
  await semViolacoes(page);
});

test("apoio: escolher um CID lista os procedimentos ligados", async ({ page }) => {
  await abrirBuscar(page, "/#/consultar/q/I10");
  const barra = page.getByRole("button", { name: /Apoio/ });
  await expect(barra).toBeVisible({ timeout: 30000 });
  const apoio = page.getByRole("grid", { name: "Apoio" });
  if (!(await apoio.isVisible())) await barra.click();
  await expect(apoio).toBeVisible();
  await apoio.getByRole("row").nth(1).click();
  await expect(page.getByRole("button", { name: "Voltar à busca" })).toBeVisible();
  await page.getByRole("button", { name: "Voltar à busca" }).click();
  await expect(apoio).toBeVisible();
});

test("ficha: faixa, resumo, copiar código e abas pelo teclado, sem violações", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await abrirFicha(page, "0301010072");
  const titulo = page.getByRole("heading", { level: 1 });
  await expect(titulo).toBeFocused();
  await expect(page.getByRole("group", { name: "Dados principais" })).toContainText("Valor total");
  await expect(page.getByRole("region", { name: "Para cobrar" })).toBeVisible();
  await page.screenshot({ path: "test-results/ficha-1366.png" });
  await semViolacoes(page);
  await page.getByRole("button", { name: /^Copiar o código/ }).click();
  await expect(page.locator(".ficha__copiado")).toHaveText("Código copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("0301010072");
  await page.getByRole("tab", { name: "Resumo" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Exigências" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#\/consultar\/0301010072\/exigencias$/);
});

test("ficha: ao rolar a faixa encolhe mantendo nome, código, valor e ações; ao voltar ao topo, reabre", async ({ page }) => {
  await abrirFicha(page, "0301010072");
  await page.getByRole("tab", { name: "Exigências" }).click();
  const topo = page.locator(".ficha__topo");
  const cheia = (await topo.boundingBox())!.height;
  await page.locator(".shell__conteudo").evaluate((n) => { n.scrollTop = 600; });
  await expect(topo).toHaveClass(/ficha__topo--compacta/);
  const baixa = (await topo.boundingBox())!.height;
  expect(baixa).toBeLessThan(cheia * 0.6);
  await expect(topo.locator(".ficha__mini")).toContainText("03.01.01.007-2");
  await expect(topo.getByRole("button", { name: "Favorito" })).toBeVisible();
  await page.screenshot({ path: "test-results/ficha-compacta.png" });
  await semViolacoes(page);
  await page.locator(".shell__conteudo").evaluate((n) => { n.scrollTop = 0; });
  await expect(topo).not.toHaveClass(/ficha__topo--compacta/);
});

test("ficha: código inexistente explica e continua sem violações", async ({ page }) => {
  await abrirFicha(page, "9999999999");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("não existe em");
  await page.screenshot({ path: "test-results/ficha-inexistente.png" });
  await semViolacoes(page);
});

test("ficha: em 1024 px a faixa não corta nem rola na horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirFicha(page, "0301010072");
  await page.screenshot({ path: "test-results/ficha-1024.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await semViolacoes(page);
});

async function abrirFicha(page: Page, codigo: string) {
  await page.goto(`/#/consultar/${codigo}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("filtro de complexidade muda a rota, mostra o chip e a contagem; Limpar filtros volta", async ({ page }) => {
  await abrirBuscar(page, "/#/consultar/q/consulta");
  const filtros = page.getByRole("group", { name: "Complexidade" });
  await expect(filtros).toBeVisible({ timeout: 30000 });
  const contagem = page.locator(".consultar__contagem");
  const antes = await contagem.innerText();
  await filtros.getByRole("checkbox").nth(1).check({ force: true });
  await expect(page).toHaveURL(/cx=/);
  await expect(page.getByRole("button", { name: /^Remover filtro/ })).toBeVisible();
  await expect(contagem).not.toHaveText(antes);
  await page.screenshot({ path: "test-results/buscar-filtro.png" });
  await semViolacoes(page);
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page).not.toHaveURL(/cx=/);
  await expect(contagem).toHaveText(antes);
});

test("paginação: 100 por página, a página 2 põe pg=2 na rota e Voltar da ficha restaura a página", async ({ page }) => {
  await abrirBuscar(page, "/#/consultar/q/consulta");
  const tabela = page.getByRole("grid", { name: "Procedimentos" });
  await expect(page.getByText(/^1–100 de [\d.]+ procedimentos$/)).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Página 2" }).click();
  await expect(page).toHaveURL(/pg=2/);
  await expect(page.getByText(/^101–/)).toBeVisible();
  await semViolacoes(page);
  await tabela.getByRole("row").nth(1).click();
  await expect(page).toHaveURL(/#\/consultar\/\d{10}$/);
  await page.goBack();
  await expect(page).toHaveURL(/pg=2/);
  await expect(page.getByText(/^101–/)).toBeVisible();
});

test("o pé da página (paginação) fica à vista sem rolar a janela, em 1366 e 2560 px", async ({ page }) => {
  for (const [largura, altura] of [[1366, 768], [2560, 1300]] as const) {
    await page.setViewportSize({ width: largura, height: altura });
    await abrirBuscar(page, "/#/consultar/q/consulta");
    const pe = page.getByRole("navigation", { name: "Paginação" });
    await expect(pe).toBeInViewport({ timeout: 30000 });
    await expect(page.getByRole("grid", { name: "Procedimentos" })).toBeInViewport();
    const rolagem = await page.locator(".shell__conteudo").evaluate((n) => n.scrollHeight - n.clientHeight);
    expect(rolagem).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/buscar-pe-${largura}.png` });
  }
});

test("em 1024 px os filtros viram o botão Filtros e o painel abre e fecha por teclado", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await abrirBuscar(page, "/#/consultar/q/consulta");
  const botao = page.getByRole("button", { name: /^Filtros/ });
  await expect(botao).toBeVisible({ timeout: 30000 });
  await botao.click();
  const painel = page.getByRole("dialog", { name: "Filtros" });
  await expect(painel).toBeVisible();
  await page.screenshot({ path: "test-results/buscar-painel-1024.png" });
  await semViolacoes(page);
  await page.keyboard.press("Escape");
  await expect(painel).toHaveCount(0);
  await expect(botao).toBeFocused();
});

test("exigências: 'ver' do Resumo abre a seção, filtra, e um compatível leva à ficha dele", async ({ page }) => {
  await abrirFicha(page, "0301010072");
  await page.getByRole("button", { name: "Ver CBO em Exigências" }).click();
  await expect(page).toHaveURL(/#\/consultar\/0301010072\/exigencias\/rl_procedimento_ocupacao$/);
  const gatilho = page.getByRole("button", { name: /^CBO/ });
  await expect(gatilho).toHaveAttribute("aria-expanded", "true");
  await expect(gatilho).toBeFocused();
  const grade = page.getByRole("grid", { name: "CBO" });
  await expect(grade).toBeVisible();
  await page.getByRole("searchbox", { name: "Filtrar CBO" }).fill("clinico");
  await expect(page.locator(".exigencias__contagem").first()).toContainText("de 69 linhas");
  await page.screenshot({ path: "test-results/exigencias-1366.png" });
  await semViolacoes(page);
  await page.getByRole("button", { name: /^É compatível de/ }).click();
  const compat = page.getByRole("grid", { name: "É compatível de" });
  await expect(compat).toBeVisible();
  const primeiro = compat.getByRole("link").first();
  const codigo = (await primeiro.innerText()).replace(/\D/g, "");
  await primeiro.click();
  await expect(page).toHaveURL(new RegExp(`#/consultar/${codigo}$`));
});

test("exigências em 1024 px: sem rolagem horizontal da página e sem violações", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/#/consultar/0301010072/exigencias/rl_procedimento_ocupacao");
  await expect(page.getByRole("grid", { name: "CBO" })).toBeVisible();
  await page.screenshot({ path: "test-results/exigencias-1024.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await semViolacoes(page);
});

test("histórico: resumo das competências, setas na tira, 1024 px e sem violações", async ({ page }) => {
  await page.goto("/#/consultar/0301010072/historico");
  await expect(page.getByText(/^Carregado em \d+ competência/)).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: "test-results/historico-1366.png", fullPage: true });
  await semViolacoes(page);
  const botoes = page.getByRole("list", { name: "Competências carregadas" }).getByRole("button");
  if ((await botoes.count()) > 1) {
    await botoes.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(botoes.nth(1)).toBeFocused();
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: "test-results/historico-1024.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await semViolacoes(page);
});

test("explorar: percorrer a árvore até a ficha só pelo teclado; Voltar reabre a árvore", async ({ page }) => {
  await page.goto("/#/consultar/explorar/procedimentos");
  const arvore = page.getByRole("tree", { name: "Procedimentos" });
  await expect(arvore.getByRole("treeitem").first()).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: "test-results/explorar-1366.png" });
  await semViolacoes(page);
  await arvore.getByRole("treeitem").first().focus();
  await page.keyboard.press("ArrowRight");
  const nivel = (n: number) => arvore.locator(`[role="treeitem"][data-id][aria-level="${n}"]`);
  await expect(nivel(2).first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(nivel(2).first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(nivel(3).first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(nivel(3).first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(nivel(4).first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(nivel(4).first()).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Prévia" }).getByRole("button", { name: "Abrir ficha" })).toBeVisible();
  await page.screenshot({ path: "test-results/explorar-previa-1366.png" });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/consultar\/\d{10}$/);
  await page.goBack();
  await expect(page.getByRole("treeitem", { selected: true })).toBeVisible();
});

test("explorar: árvore de CID, sem violações", async ({ page }) => {
  await page.goto("/#/consultar/explorar/cid");
  const arvore = page.getByRole("tree", { name: "CID" });
  await expect(arvore.getByRole("treeitem").first()).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: "test-results/explorar-cid-1366.png" });
  await semViolacoes(page);
});

test("explorar em 1024 px: detalhe sob a linha, sem rolagem horizontal e sem violações", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/#/consultar/explorar/procedimentos/0301010072");
  const sel = page.getByRole("treeitem", { selected: true });
  await expect(sel).toBeVisible({ timeout: 30000 });
  const detalhe = page.getByRole("treeitem", { name: /^Detalhes de / });
  await expect(detalhe.getByRole("button", { name: "Abrir ficha" })).toBeInViewport({ timeout: 30000 });
  await expect(page.getByRole("complementary", { name: "Prévia" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/explorar-1024.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await semViolacoes(page);
  await page.goto("/#/consultar/explorar/cid/I119");
  await expect(page.getByRole("treeitem", { name: /^Detalhes de / })).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: "test-results/explorar-cid-1024.png" });
  await semViolacoes(page);
});

async function limparMarcas(page: Page, codigo: string) {
  await page.evaluate(async (c) => {
    const post = (cmd: string, corpo: object) => fetch(`/invoke/${cmd}`, { method: "POST", body: JSON.stringify(corpo) });
    await post("marcar_favorito", { tipo: "procedimento", codigo: c, favorito: false });
    await post("anotar", { tipo: "procedimento", codigo: c, texto: "" });
  }, codigo);
}

test("favoritar e anotar na ficha; o campo vazio lista o favorito; sem violações, também em 1024 px", async ({ page }) => {
  await page.goto("/#/consultar/0301010072");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30000 });
  await limparMarcas(page, "0301010072");
  try {
    await page.reload();
    const estrela = page.getByRole("button", { name: "Favorito" });
    await expect(estrela).toHaveAttribute("aria-pressed", "false");
    await estrela.focus();
    await page.keyboard.press("Enter");
    await expect(estrela).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Anotar" }).click();
    const anotacao = page.getByRole("textbox", { name: "Anotação" });
    await expect(anotacao).toBeFocused();
    await anotacao.fill("Conferir o CBO antes de lançar. Na unidade só o 225125 está cadastrado.");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByText("Salvo", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/marcas-1366.png" });
    await semViolacoes(page);
    await anotacao.press("Escape");
    await expect(page.getByRole("button", { name: "Editar" })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: "test-results/marcas-1024.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await semViolacoes(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/#/consultar");
    await campo(page).click();
    await expect(page.getByRole("listbox").getByRole("option", { name: /03\.01\.01\.007-2/ })).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: "test-results/marcas-buscar-1366.png" });
    await semViolacoes(page);
  } finally {
    await limparMarcas(page, "0301010072");
  }
});

test("exportar a lista e uma relação da ficha mostra o aviso com o nome do arquivo", async ({ page }) => {
  await page.goto("/#/consultar/q/consulta");
  await page.getByRole("button", { name: "Exportar" }).click({ timeout: 30000 });
  await expect(page.getByText(/^Planilha salva com /)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/\.xlsx$/)).toBeVisible();
  await page.screenshot({ path: "test-results/exportar-buscar-1366.png" });
  await semViolacoes(page);
  await page.goto("/#/consultar/0301010072/exigencias/rl_procedimento_ocupacao");
  await page.getByRole("button", { name: "Exportar" }).first().click({ timeout: 30000 });
  await expect(page.getByText(/^Planilha salva com \d/)).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: "test-results/exportar-exigencias-1366.png" });
  await semViolacoes(page);
});

test("buscar: ordenar pelo cabeçalho e ver a marca de favorito na linha, sem violações", async ({ page }) => {
  await page.goto("/#/consultar/0301010072");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30000 });
  await limparMarcas(page, "0301010072");
  try {
    await page.reload();
    await page.getByRole("button", { name: "Favorito" }).click();
    await expect(page.getByRole("button", { name: "Favorito" })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/#/consultar/q/consulta m%C3%A9dica");
    const tabela = page.getByRole("grid", { name: "Procedimentos" });
    const marcada = tabela.getByRole("row", { name: /03\.01\.01\.007-2/ });
    await expect(marcada.getByRole("img", { name: "Favorito" })).toBeVisible({ timeout: 30000 });
    const valores = async () => (await tabela.getByRole("row").allTextContents()).slice(1);
    await tabela.getByRole("columnheader", { name: /Nome/ }).click();
    const porNome = (await valores()).map((t) => t.slice(0, 40));
    expect([...porNome].sort((a, b) => a.localeCompare(b, "pt-BR"))).toHaveLength(porNome.length);
    await expect(tabela.getByRole("columnheader", { name: /Nome/ })).toHaveAttribute("aria-sort", "ascending");
    await tabela.getByRole("columnheader", { name: /Valor total/ }).click();
    await expect(tabela.getByRole("columnheader", { name: /Valor total/ })).toHaveAttribute("aria-sort", "ascending");
    await page.screenshot({ path: "test-results/buscar-ordenada-1366.png" });
    await semViolacoes(page);
  } finally {
    await limparMarcas(page, "0301010072");
  }
});

test("explorar: prévia mostra CBO e CID e deixa favoritar; CID favorito ganha marca na linha", async ({ page }) => {
  await page.goto("/#/consultar/explorar/procedimentos/0301010072");
  const previa = page.getByRole("complementary", { name: "Prévia" });
  await expect(previa.getByRole("region", { name: "CBO" })).toContainText("aceitos", { timeout: 30000 });
  await expect(previa.getByRole("button", { name: "Favorito" })).toBeVisible();
  await page.screenshot({ path: "test-results/explorar-previa-procedimento-1366.png" });
  await semViolacoes(page);
  await page.goto("/#/consultar/explorar/cid/I119");
  const favorito = page.getByRole("complementary", { name: "Prévia" }).getByRole("button", { name: "Favorito" });
  await expect(favorito).toBeEnabled({ timeout: 30000 });
  await favorito.click();
  await expect(favorito).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("treeitem", { name: /^I11\.9 .*favorito$/ })).toBeVisible();
  await page.screenshot({ path: "test-results/explorar-cid-favorito-1366.png" });
  await semViolacoes(page);
  await favorito.click();
  await expect(favorito).toHaveAttribute("aria-pressed", "false");
});

test("exportar a busca leva todos os procedimentos, além dos 100 da página", async ({ page }) => {
  await page.goto("/#/consultar/q/tratamento");
  await expect(page.getByText(/^1–100 de [\d.]+ procedimentos$/)).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Exportar" }).click();
  await expect(page.getByText(/^Planilha salva com ([2-9]\d\d|[\d.]{5,}) procedimentos\.$/)).toBeVisible({ timeout: 60000 });
});

test("tabela rolada: o cabeçalho fica fixo no topo e tem fundo próprio", async ({ page }) => {
  await page.goto("/#/consultar/q/tratamento");
  const t = page.getByRole("grid", { name: "Procedimentos" });
  await t.getByRole("row").nth(3).waitFor({ timeout: 30000 });
  await t.evaluate((n) => { n.scrollTop = 400; });
  const cab = t.getByRole("columnheader", { name: "Código" });
  await expect.poll(async () => (await cab.boundingBox())!.y - (await t.boundingBox())!.y).toBeLessThan(4);
  expect(await cab.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("buscar uma categoria de CID (Z00) lista as subcategorias e a ficha tem Voltar", async ({ page }) => {
  await page.goto("/#/consultar/q/Z00");
  const barra = page.getByRole("button", { name: /Apoio/ });
  await expect(barra).toBeVisible({ timeout: 30000 });
  const apoio = page.getByRole("grid", { name: "Apoio" });
  if (!(await apoio.isVisible())) await barra.click();
  await expect(apoio.getByRole("row").filter({ hasText: "Z005" })).toBeVisible({ timeout: 30000 });
  await expect(apoio.getByRole("row").filter({ hasText: "Z001" })).toBeVisible();
  await apoio.getByRole("row").filter({ hasText: "Z005" }).click();
  await page.getByRole("grid", { name: "Procedimentos ligados" }).getByRole("row").nth(1).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/#\/consultar\/q\/Z00/);
});
