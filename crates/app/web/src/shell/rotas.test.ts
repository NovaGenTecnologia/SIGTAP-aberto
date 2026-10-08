import { DESTINOS, caminhoConsultar, lerConsultar, lerRota, substituir } from "./rotas";

test("os cinco destinos, na ordem da spec", () => {
  expect(DESTINOS.map((d) => d.rotulo)).toEqual(["Painel", "Consultar", "Mudanças", "Conferir arquivo", "Dados"]);
});
test("lerRota entende hash vazio, destino, resto e galeria", () => {
  expect(lerRota("")).toEqual({ destino: "painel", resto: [] });
  expect(lerRota("#/consultar/0301010072")).toEqual({ destino: "consultar", resto: ["0301010072"] });
  expect(lerRota("#/galeria")).toEqual({ destino: "galeria", resto: [] });
  expect(lerRota("#/qualquer-coisa")).toEqual({ destino: "painel", resto: [] });
});

describe("rotas de Consultar", () => {
  test("sem segmentos abre a busca vazia", () => {
    expect(lerConsultar([])).toEqual({ tela: "buscar", texto: "" });
  });
  test("q/<texto> carrega o texto buscado, decodificado", () => {
    expect(lerConsultar(["q", "consulta%20m%C3%A9dica"])).toEqual({ tela: "buscar", texto: "consulta médica" });
  });
  test("texto com codificação inválida não quebra", () => {
    expect(lerConsultar(["q", "100%"])).toEqual({ tela: "buscar", texto: "100%" });
  });
  test("código de 10 dígitos abre a ficha no Resumo", () => {
    expect(lerConsultar(["0301010072"])).toEqual({ tela: "ficha", codigo: "0301010072", aba: "resumo" });
  });
  test("código mascarado é normalizado", () => {
    expect(lerConsultar(["03.01.01.007-2"])).toEqual({ tela: "ficha", codigo: "0301010072", aba: "resumo" });
  });
  test("aba conhecida, desconhecida e seção", () => {
    expect(lerConsultar(["0301010072", "historico"])).toEqual({ tela: "ficha", codigo: "0301010072", aba: "historico" });
    expect(lerConsultar(["0301010072", "aba-invalida"])).toEqual({ tela: "ficha", codigo: "0301010072", aba: "resumo" });
    expect(lerConsultar(["0301010072", "exigencias", "rl_procedimento_cid"])).toEqual(
      { tela: "ficha", codigo: "0301010072", aba: "exigencias", secao: "rl_procedimento_cid" });
  });
  test("explorar: padrão, CID e nó", () => {
    expect(lerConsultar(["explorar"])).toEqual({ tela: "explorar", arvore: "procedimentos", no: null });
    expect(lerConsultar(["explorar", "cid", "I10"])).toEqual({ tela: "explorar", arvore: "cid", no: "I10" });
    expect(lerConsultar(["explorar", "procedimentos", "030101"])).toEqual({ tela: "explorar", arvore: "procedimentos", no: "030101" });
  });
  test("segmento sem sentido cai na busca vazia", () => {
    expect(lerConsultar(["xyz"])).toEqual({ tela: "buscar", texto: "" });
  });
  test("ida e volta devolve o caminho canônico", () => {
    const casos: string[][] = [
      [], ["q", "consulta%20m%C3%A9dica"], ["0301010072"], ["0301010072", "historico"],
      ["0301010072", "exigencias", "rl_procedimento_cid"], ["explorar"], ["explorar", "cid"],
      ["explorar", "cid", "I10"], ["explorar", "procedimentos", "030101"],
    ];
    for (const c of casos) expect(caminhoConsultar(lerConsultar(c))).toEqual(c);
    expect(caminhoConsultar(lerConsultar(["03.01.01.007-2"]))).toEqual(["0301010072"]);
    expect(caminhoConsultar({ tela: "buscar", texto: "" })).toEqual([]);
    expect(caminhoConsultar({ tela: "buscar", texto: "  " })).toEqual([]);
  });
});

test("substituir troca a rota sem empilhar histórico e avisa os ouvintes", () => {
  window.location.hash = "#/consultar";
  const antes = window.history.length;
  const ouvinte = vi.fn();
  window.addEventListener("hashchange", ouvinte);
  substituir("consultar", "q", "abc");
  window.removeEventListener("hashchange", ouvinte);
  expect(window.location.hash).toBe("#/consultar/q/abc");
  expect(window.history.length).toBe(antes);
  expect(ouvinte).toHaveBeenCalled();
});
