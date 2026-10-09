import { expect, test } from "@playwright/test";

// Em 1920x1080 o conteúdo ocupa a janela até a margem, sem faixa vazia à direita.
for (const rota of ["painel", "painel/producao/origem-do-valor", "mudancas", "dados", "consultar"]) {
  test(`${rota} preenche a largura em 1920 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/#/${rota}`);
    const pagina = page.locator("#conteudo > *").first();
    await expect(pagina).toBeVisible({ timeout: 30_000 });
    const direita = await pagina.evaluate((e) => Math.round(e.getBoundingClientRect().right));
    expect(direita).toBeGreaterThanOrEqual(1920 - 60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
