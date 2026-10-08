import { campo, linha, nome, relacao } from "../exemplos";
import type { NomeDeCodigo } from "../../../api/tipos";
import { montarTabela, rotuloDaColuna } from "./tabelaRelacao";

const cbo = (cod: string, texto?: string, extra: NomeDeCodigo[] = []) => linha(
  [campo("co_procedimento", "0301010072"), campo("co_ocupacao", cod)],
  texto ? [nome("tb_ocupacao", "co_ocupacao", { no_ocupacao: texto }), ...extra] : extra);

test("colunas vêm dos campos, sem a chave da relação nem a competência; rótulos legíveis", () => {
  const t = montarTabela(relacao("rl_procedimento_ocupacao", "co_procedimento", [linha([campo("co_procedimento", "0301010072"), campo("co_ocupacao", "225125"), campo("dt_competencia", "202609")])]));
  expect(t.colunas.map((c) => c.id)).toEqual(["co_ocupacao"]);
  expect(rotuloDaColuna("co_ocupacao")).toBe("CBO");
  expect(rotuloDaColuna("co_coluna_nova")).toBe("co_coluna_nova");
});

test("código com nome: célula tem código e nome curto; demais nomes viram texto oficial", () => {
  const ds = nome("tb_descricao_ocupacao", "co_ocupacao", { ds_ocupacao: "Descrição longa da ocupação." });
  const t = montarTabela(relacao("rl_procedimento_ocupacao", "co_procedimento", [cbo("225125", "Médico clínico", [ds])]));
  expect(t.linhas[0]!.celulas["co_ocupacao"]).toMatchObject({ codigo: "225125", nome: "Médico clínico", textos: ["Descrição longa da ocupação."], falta: null });
});

test("código sem nome na competência e tabela de destino ausente", () => {
  const semNome: NomeDeCodigo = { tabela: "tb_ocupacao", colunas: ["co_ocupacao"], tabela_presente: true, encontrados: [] };
  const ausente: NomeDeCodigo = { tabela: "tb_ocupacao", colunas: ["co_ocupacao"], tabela_presente: false, encontrados: [] };
  const t = montarTabela(relacao("rl_procedimento_ocupacao", "co_procedimento", [cbo("1", undefined, [semNome]), cbo("2", undefined, [ausente])]));
  expect(t.linhas[0]!.celulas["co_ocupacao"]!.falta).toBe("sem nome nesta competência");
  expect(t.linhas[1]!.celulas["co_ocupacao"]!.falta).toBe("tabela não veio no ZIP desta competência");
});

test("código de procedimento vira link; campos oficiais usam o texto formatado", () => {
  const t = montarTabela(relacao("rl_procedimento_compativel", "co_procedimento_principal", [linha([
    campo("co_procedimento_principal", "0301010072"), campo("co_procedimento_compativel", "0301010048"), campo("tp_compatibilidade", "1", { descricao: "Compatível", situacao: "oficial" }), campo("qt_permitida", 2)])]));
  const l = t.linhas[0]!;
  expect(l.celulas["co_procedimento_compativel"]!.procedimento).toBe("0301010048");
  expect(l.celulas["tp_compatibilidade"]!.codigo).toBe("Compatível");
  expect(l.celulas["tp_compatibilidade"]!.procedimento).toBeNull();
});

test("repetições no arquivo só aparecem quando alguma linha repete", () => {
  const um = montarTabela(relacao("rl_procedimento_ocupacao", "co_procedimento", [cbo("1")]));
  expect(um.temRepeticoes).toBe(false);
  const dois = montarTabela(relacao("rl_procedimento_ocupacao", "co_procedimento", [{ ...cbo("1"), quantidade: 3 }]));
  expect(dois.temRepeticoes).toBe(true);
  expect(dois.linhas[0]!.repeticoes).toBe(3);
});

test("busca ignora acento e caixa e olha código, nome e texto oficial", () => {
  const t = montarTabela(relacao("rl_procedimento_ocupacao", "co_procedimento", [cbo("225125", "Médico clínico")]));
  expect(t.linhas[0]!.busca).toContain("medico clinico");
  expect(t.linhas[0]!.busca).toContain("225125");
});
