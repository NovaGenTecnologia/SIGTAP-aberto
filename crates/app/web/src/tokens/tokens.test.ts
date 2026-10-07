import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "tokens.css"), "utf8");

function tokens(): Record<string, string> {
  const t: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) t[m[1]!] = m[2]!.toUpperCase();
  return t;
}

function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contraste(a: string, b: string): number {
  const x = luminancia(a), y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// [primeiro plano, fundo, mínimo]: 4.5 para texto, 3 para elementos gráficos e bordas de controle.
const PARES: [string, string, number][] = [
  ["cor-texto", "cor-pagina", 4.5], ["cor-texto", "cor-superficie", 4.5],
  ["cor-texto-2", "cor-pagina", 4.5], ["cor-texto-2", "cor-superficie", 4.5],
  ["cor-texto-3", "cor-pagina", 4.5], ["cor-texto-3", "cor-superficie", 4.5],
  ["cor-casco-texto", "cor-casco", 4.5], ["cor-casco-texto", "cor-casco-escuro", 4.5],
  ["cor-casco-texto", "cor-acao", 4.5], ["cor-casco-texto", "cor-acao-escura", 4.5],
  ["cor-linha-controle", "cor-superficie", 3], ["cor-linha-controle", "cor-pagina", 3],
  ["cor-foco", "cor-superficie", 3], ["cor-foco", "cor-pagina", 3],
  ["cor-foco-sobre-casco", "cor-casco", 3], ["cor-foco-sobre-casco", "cor-casco-escuro", 3],
  // trilho claro (opção A): item ativo
  ["cor-acao-escura", "cor-item-ativo", 4.5], ["cor-texto-2", "cor-item-ativo", 4.5],
  ["cor-acao", "cor-item-ativo", 3],
  ...(["ok", "atencao", "rejeicao", "info", "nconf"] as const).flatMap((e): [string, string, number][] => [
    [`cor-${e}-texto`, `cor-${e}-fundo`, 4.5],
    [`cor-${e}-texto`, "cor-superficie", 4.5],
    [`cor-${e}`, "cor-superficie", 3],
    [`cor-${e}`, `cor-${e}-fundo`, 3],
  ]),
];

test("todos os pares de cor atendem ao contraste mínimo (WCAG AA)", () => {
  const t = tokens();
  const falhas: string[] = [];
  for (const [fg, bg, minimo] of PARES) {
    const a = t[fg], b = t[bg];
    if (!a || !b) { falhas.push(`token ausente: ${!a ? fg : bg}`); continue; }
    const r = contraste(a, b);
    if (r < minimo) falhas.push(`${fg} (${a}) sobre ${bg} (${b}): ${r.toFixed(2)} < ${minimo}`);
  }
  expect(falhas).toEqual([]);
});

test("a escala tipográfica e o espaço existem", () => {
  for (const n of ["--texto-12", "--texto-14", "--texto-16", "--texto-18", "--texto-22", "--texto-28", "--esp-1", "--esp-4", "--altura-controle", "--anel-foco"]) {
    expect(css).toContain(n + ":");
  }
});
