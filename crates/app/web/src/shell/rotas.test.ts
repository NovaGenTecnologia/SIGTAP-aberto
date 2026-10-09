import { DESTINOS, caminhoConsultar, caminhoUnidade, lerConsultar, lerRota, lerUnidade, substituir } from "./rotas";

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

const PRODUCAO = { tela: "producao", aba: "visao-geral", q: "", classe: null, origem: "sia", motivo: "", bloco: "" } as const;

describe("subtelas da unidade (Painel)", () => {
  test("Produção: abas, parâmetros e caminho canônico", () => {
    expect(lerUnidade(["producao", "rejeicoes?motivo=020069"])).toEqual({ ...PRODUCAO, aba: "rejeicoes", motivo: "020069" });
    expect(lerUnidade(["producao", "procedimentos", "sih?q=consulta&classe=A"])).toEqual({ ...PRODUCAO, aba: "procedimentos", origem: "sih", q: "consulta", classe: "A" });
    expect(lerUnidade(["producao", "procedimentos?q=x"])).toEqual({ ...PRODUCAO, aba: "procedimentos", q: "x" });
    expect(lerUnidade(["producao", "fora-do-padrao?bloco=servicos"])).toEqual({ ...PRODUCAO, aba: "fora-do-padrao", bloco: "servicos" });
    expect(lerUnidade(["producao", "visao-geral"])).toEqual(PRODUCAO);
  });
  test("Produção: aba, origem ou classe inválidas caem no padrão", () => {
    expect(lerUnidade(["producao", "nada"])).toEqual(PRODUCAO);
    expect(lerUnidade(["producao", "procedimentos", "xyz?classe=Z"])).toEqual({ ...PRODUCAO, aba: "procedimentos" });
  });
  test("Produção: o caminho omite a Visão geral, a origem SIA e os parâmetros vazios", () => {
    expect(caminhoUnidade(PRODUCAO)).toEqual(["producao"]);
    expect(caminhoUnidade({ ...PRODUCAO, aba: "rejeicoes" })).toEqual(["producao", "rejeicoes"]);
    expect(caminhoUnidade({ ...PRODUCAO, aba: "rejeicoes", motivo: "020069" })).toEqual(["producao", "rejeicoes?motivo=020069"]);
    expect(caminhoUnidade({ ...PRODUCAO, aba: "procedimentos", origem: "sih", q: "consulta", classe: "A" })).toEqual(["producao", "procedimentos", "sih?q=consulta&classe=A"]);
    expect(caminhoUnidade({ ...PRODUCAO, aba: "procedimentos", q: "x" })).toEqual(["producao", "procedimentos?q=x"]);
    expect(caminhoUnidade({ ...PRODUCAO, aba: "origem-do-valor", q: "ignorado" })).toEqual(["producao", "origem-do-valor"]);
  });
  test("lerUnidade: cadastro abre em habilitações e aptidão só tem grupo se a rota trouxer", () => {
    expect(lerUnidade([])).toEqual({ tela: "painel" });
    expect(lerUnidade(["cadastro"])).toEqual({ tela: "cadastro", aba: "habilitacoes", q: "" });
    expect(lerUnidade(["cadastro", "servicos?q=104"])).toEqual({ tela: "cadastro", aba: "servicos", q: "104" });
    expect(lerUnidade(["aptidao"])).toEqual({ tela: "aptidao", grupo: null, q: "", hab: null });
    expect(lerUnidade(["aptidao", "oportunidade?q=biopsia&hab=0203"])).toEqual({ tela: "aptidao", grupo: "oportunidade", q: "biopsia", hab: "0203" });
    expect(lerUnidade(["producao"])).toEqual(PRODUCAO);
    expect(lerUnidade(["xyz"])).toEqual({ tela: "painel" });
  });
  test("aba inválida cai em habilitações e grupo inválido vira nulo", () => {
    expect(lerUnidade(["cadastro", "nada"])).toEqual({ tela: "cadastro", aba: "habilitacoes", q: "" });
    expect(lerUnidade(["aptidao", "nada?hab=0203"])).toEqual({ tela: "aptidao", grupo: null, q: "", hab: "0203" });
  });
  test("a busca pode vir sem aba ou grupo, e o texto codificado mal formado não quebra", () => {
    expect(lerUnidade(["cadastro?q=leito"])).toEqual({ tela: "cadastro", aba: "habilitacoes", q: "leito" });
    expect(lerUnidade(["aptidao?q=%E0%A4%A"])).toEqual({ tela: "aptidao", grupo: null, q: "%E0%A4%A", hab: null });
  });
  test("caminhoUnidade volta ao que lerUnidade leu", () => {
    const ts = [
      { tela: "aptidao", grupo: "risco", q: "a b/ç", hab: "0203" },
      { tela: "aptidao", grupo: null, q: "", hab: null },
      { tela: "cadastro", aba: "terceiros", q: "hospital & cia" },
      { tela: "cadastro", aba: "habilitacoes", q: "" },
      { tela: "painel" },
      PRODUCAO,
      { ...PRODUCAO, aba: "rejeicoes", motivo: "020069" },
      { ...PRODUCAO, aba: "procedimentos", origem: "sih", q: "consulta médica", classe: "A" },
      { ...PRODUCAO, aba: "procedimentos" },
      { ...PRODUCAO, aba: "fora-do-padrao", bloco: "permanencia" },
      { ...PRODUCAO, aba: "origem-do-valor" },
    ] as const;
    for (const t of ts) expect(lerUnidade(caminhoUnidade(t))).toEqual(t);
  });
  test("caminho canônico: sem parâmetro quando está vazio", () => {
    expect(caminhoUnidade({ tela: "cadastro", aba: "habilitacoes", q: "" })).toEqual(["cadastro"]);
    expect(caminhoUnidade({ tela: "cadastro", aba: "leitos", q: "" })).toEqual(["cadastro", "leitos"]);
    expect(caminhoUnidade({ tela: "aptidao", grupo: "ordem", q: "", hab: null })).toEqual(["aptidao", "ordem"]);
    expect(caminhoUnidade({ tela: "aptidao", grupo: null, q: "x", hab: null })).toEqual(["aptidao?q=x"]);
  });
});
