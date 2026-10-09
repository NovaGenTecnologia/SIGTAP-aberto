import { expect, test, type Page } from "@playwright/test";

const TAMANHOS = [[1024, 640], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440]] as const;
const ROTAS = ["painel", "painel/producao", "painel/producao/origem-do-valor", "painel/producao/procedimentos", "mudancas", "dados", "consultar"];

async function pronto(page: Page, rota: string) {
  await page.goto(`/#/${rota}`);
  await expect(page.locator("#conteudo > *").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(rota.startsWith("painel") ? 3000 : 600);
}

// Em qualquer tamanho a página acompanha a janela: nada de rolagem horizontal nem faixa vazia à direita.
for (const [w, h] of TAMANHOS) {
  for (const rota of ROTAS) {
    test(`${rota} acompanha a janela em ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await pronto(page, rota);
      const direita = await page.locator("#conteudo > *").first().evaluate((e) => Math.round(e.getBoundingClientRect().right));
      if (w >= 1366) expect(direita).toBeGreaterThanOrEqual(w - 60);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    });
  }
}

test("Origem do valor põe os blocos em pares quando há espaço e em coluna quando não há", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await pronto(page, "painel/producao/origem-do-valor");
  const topo = async (nome: string) => (await page.getByRole("region", { name: nome }).boundingBox())!.y;
  expect(await topo("Composição das AIH")).toBe(await topo("Perfil financeiro"));
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await topo("Composição das AIH")).toBeLessThan(await topo("Perfil financeiro"));
});

test("Painel em 2560 põe os dois cartões laterais lado a lado", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await pronto(page, "painel");
  const aptos = (await page.locator("section.lateral").nth(0).boundingBox())!;
  const unidade = (await page.locator("section.lateral").nth(1).boundingBox())!;
  expect(unidade.x).toBeGreaterThan(aptos.x + aptos.width - 1);
  expect(Math.abs(unidade.y - aptos.y)).toBeLessThan(2);
});

test("Dados mostra mais linhas numa janela mais alta", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await pronto(page, "dados");
  const alta = (await page.getByRole("grid").first().boundingBox())!.height;
  await page.setViewportSize({ width: 1920, height: 768 });
  await page.waitForTimeout(200);
  const baixa = (await page.getByRole("grid").first().boundingBox())!.height;
  expect(alta).toBeGreaterThan(baixa);
});
