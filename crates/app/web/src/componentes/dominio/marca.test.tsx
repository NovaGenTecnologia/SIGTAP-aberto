import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { Marca } from "./Marca";

test("a marca horizontal é uma imagem com o nome acessível e o nome em contorno", () => {
  const { container } = render(<Marca variante="horizontal" />);
  expect(screen.getByRole("img", { name: "SIGTAP Aberto" })).toBeInTheDocument();
  expect(container.querySelectorAll("rect.marca__cel")).toHaveLength(4);
  expect(container.querySelectorAll("path.marca__nome")).toHaveLength(2);
  expect(container.querySelector("text")).toBeNull();
});

test("o símbolo sozinho não traz o nome", () => {
  const { container } = render(<Marca variante="simbolo" />);
  expect(container.querySelectorAll("path.marca__nome")).toHaveLength(0);
  expect(container.querySelector("circle.marca__no")).not.toBeNull();
});

test("tema e animação viram classes; sem animação não há classe de movimento", () => {
  const { container, rerender } = render(<Marca variante="horizontal" tema="negativo" animacao="sutil" />);
  const svg = container.querySelector("svg")!;
  expect(svg).toHaveClass("marca--negativo", "marca--sutil");
  rerender(<Marca variante="horizontal" />);
  expect(container.querySelector("svg")).toHaveClass("marca--padrao");
  expect(container.querySelector("svg")).not.toHaveClass("marca--sutil");
});

test("decorativa fica escondida do leitor de tela", () => {
  const { container } = render(<Marca variante="simbolo" decorativa />);
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByRole("img")).toBeNull();
});

test("a animação de carregamento é uma classe própria do símbolo", () => {
  const { container } = render(<Marca variante="simbolo" animacao="carregando" decorativa />);
  expect(container.querySelector("svg")).toHaveClass("marca--carregando");
});

test("o brilho sai do quadrado central, corre a linha e cerca o nó nos dois sentidos", () => {
  const { container } = render(<Marca variante="simbolo" animacao="carregando" altura={64} decorativa />);
  expect(container.querySelectorAll("path.marca__trilha")).toHaveLength(1);
  expect(container.querySelectorAll("path.marca__arco")).toHaveLength(2);
  const [cima, baixo] = [...container.querySelectorAll("path.marca__arco")].map((p) => p.getAttribute("d"));
  expect(cima).toMatch(/^M45\.5 32A6 6 0 0 1 57\.5 32$/);
  expect(baixo).toMatch(/^M45\.5 32A6 6 0 0 0 57\.5 32$/);
});

test("na inicialização o nó é desenhado pelos dois arcos; parada, não há brilho extra", () => {
  const ini = render(<Marca variante="simbolo" animacao="inicial" decorativa />);
  expect(ini.container.querySelectorAll("path.marca__arco")).toHaveLength(2);
  expect(ini.container.querySelector("path.marca__trilha")).toBeNull();
  const parada = render(<Marca variante="simbolo" decorativa />);
  expect(parada.container.querySelector("path.marca__arco")).toBeNull();
  expect(parada.container.querySelector("path.marca__trilha")).toBeNull();
});

test("a linha-guia e o brilho ficam por baixo das células: a ponta arredondada não aparece sobre o quadrado", () => {
  const { container } = render(<Marca variante="simbolo" animacao="carregando" decorativa />);
  const filhos = [...container.querySelectorAll("svg g > *")];
  const pos = (sel: string) => filhos.findIndex((n) => n.matches(sel));
  expect(pos(".marca__guia")).toBeLessThan(pos(".marca__cel"));
  expect(pos(".marca__trilha")).toBeLessThan(pos(".marca__cel"));
});

test("as animações não usam transparência: sobrepor traços translúcidos escurece ou clareia a junção", () => {
  const css = readFileSync("src/componentes/dominio/marca.css", "utf8");
  expect(css).not.toMatch(/opacity:\s*0\.[1-9]/);
});

test("o carregamento é um fluxo: a luz anda pelo caminho em ordem, sem acender duas células ao mesmo tempo, num ciclo calmo", () => {
  const css = readFileSync("src/componentes/dominio/marca.css", "utf8");
  const ciclo = parseFloat(/--ciclo:\s*([\d.]+)s/.exec(css)?.[1] ?? "0");
  expect(ciclo).toBeGreaterThanOrEqual(1.3); // abaixo disso o movimento cansa quem olha com atenção
  const atraso = (alvo: string) => {
    const regra = new RegExp(String.raw`\.marca--carregando \.${alvo}[^{]*\{[^}]*animation-delay:\s*(?:calc\(var\(--ciclo\) \* ([\d.]+)\)|0s)`).exec(css);
    expect(regra, alvo).not.toBeNull();
    return parseFloat(regra![1] ?? "0");
  };
  const ordem = ["marca__c4", "marca__c2", "marca__c1", "marca__trilha", "marca__c3", "marca__arco"].map(atraso);
  expect([...ordem].sort((a, b) => a - b)).toEqual(ordem); // esquerda, centro, cima, linha, baixo, anel
  expect(new Set(ordem).size).toBe(ordem.length); // nenhuma entrada simultânea
  const normal = css.slice(0, css.indexOf("@media (prefers-reduced-motion"));
  expect(normal).not.toMatch(/\.marca--carregando \.marca__anel[^{]*\{[^}]*animation/); // sem pulso: uma parada no meio do movimento
});

test("até 32 px o símbolo usa o desenho pequeno, de traço mais grosso; acima, o normal", () => {
  const pequeno = render(<Marca variante="simbolo" altura={24} decorativa />);
  expect(pequeno.container.querySelector("svg")).toHaveClass("marca--pequena");
  const normal = render(<Marca variante="simbolo" altura={48} decorativa />);
  expect(normal.container.querySelector("svg")).not.toHaveClass("marca--pequena");
});

test("o nome é maior e a variante horizontal acompanha o desenho pequeno", () => {
  const { container } = render(<Marca variante="horizontal" altura={28} />);
  expect(container.querySelector("svg")).toHaveClass("marca--pequena");
  expect(container.querySelectorAll("path.marca__nome")).toHaveLength(2);
});

test("em redução de movimento o carregamento deriva da animação sutil, não fica parado", () => {
  const css = readFileSync("src/componentes/dominio/marca.css", "utf8");
  const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(bloco).toMatch(/\.marca--carregando \.marca__trilha[^{]*\{[^}]*marca-trilha-lenta/);
  expect(bloco).toMatch(/\.marca--carregando \.marca__arco[^{]*\{[^}]*marca-arco-lento/);
  expect(bloco).not.toMatch(/\.marca--sutil \.marca__trilha[^{]*\{[^}]*animation:\s*none/);
});


it("o anel avança na velocidade horizontal da linha, sem frear nas pontas (perfil do arco)", () => {
  const css = readFileSync("src/componentes/dominio/marca.css", "utf8");
  const perfil = /--perfil-arco: linear\(([^)]*)\)/.exec(css)?.[1] ?? "";
  const pontos = perfil.split(",").map((p) => {
    const [v = "0", t] = p.trim().split(/\s+/);
    return { u: t ? parseFloat(t) / 100 : v === "0" ? 0 : 1, s: parseFloat(v) };
  });
  const em = (u: number) => {
    const b = pontos.findIndex((p) => p.u >= u);
    const a = pontos[Math.max(b - 1, 0)]!, c = pontos[b]!;
    return c.u === a.u ? c.s : a.s + ((c.s - a.s) * (u - a.u)) / (c.u - a.u);
  };
  const x = (s: number) => (1 - Math.cos(Math.PI * s)) / 2; // fração horizontal do meio-anel
  // Entre 5% e 95% do tempo, a velocidade horizontal fica a ±10% da média; os extremos de 5% são sub-quadro.
  for (let u = 0.05; u < 0.95; u += 0.05) {
    const v = (x(em(u + 0.05)) - x(em(u))) / 0.05;
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(1.1);
  }
});

test("o traço animado tem vão maior que a ponta arredondada: sem fantasma no fim do caminho quando o traço começa", () => {
  // Com "1 1", perto de dashoffset 1 o traço seguinte do padrão começa logo após o fim do caminho e a ponta arredondada
  // aparece como um pontinho no outro extremo. Com "1 2" ele fica longe demais para alcançar o caminho.
  const css = readFileSync("src/componentes/dominio/marca.css", "utf8");
  const padroes = [...css.matchAll(/stroke-dasharray:\s*([^;]+);/g)].map((m) => m[1]!.trim());
  expect(padroes.length).toBeGreaterThan(0);
  for (const p of padroes) expect(p).toBe("1 2");
});
