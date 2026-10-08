import { campo, fichaDeExemplo, linha, nome } from "../exemplos";
import { montarResumo } from "./resumo";

const nbsp = (s: string) => s.replace(/ /g, " ");

test("faixa-chave: valor total, instrumentos, complexidade, modalidade, financiamento", () => {
  const r = montarResumo(fichaDeExemplo());
  expect(nbsp(r.valorTotal)).toBe("R$ 10,00");
  expect(r.instrumento).toBe("BPA · APAC");
  expect(r.complexidade).toBe("Média");
  expect(r.modalidade).toBe("Ambulatorial");
  expect(r.financiamentoCurto).toBe("MAC · 06");
});

test("valor total soma SH, SA e SP", () => {
  const f = fichaDeExemplo({ procedimento: [fichaDeExemplo().procedimento[0]!] });
  const p = f.procedimento[0]!;
  p.campos.find((c) => c.coluna === "vl_sh")!.valor = 250;
  p.campos.find((c) => c.coluna === "vl_sp")!.valor = 100;
  expect(nbsp(montarResumo(f).valorTotal)).toBe("R$ 13,50");
});

test("para cobrar: sexo, idade, quantidade, permanência, pontos", () => {
  const r = montarResumo(fichaDeExemplo());
  const v = Object.fromEntries(r.cobrar.map((l) => [l.rotulo, l.valor]));
  expect(v["Sexo"]).toBe("Indiferente/Ambos");
  expect(v["Idade"]).toBe("0 a 130 anos e 11 meses");
  expect(v["Quantidade máxima"]).toBe("Não se aplica");
  expect(v["Permanência"]).toBe("Não se aplica");
  expect(v["Pontos"]).toBe("0");
});

test("idade com sentinela é 'Não se aplica'", () => {
  const f = fichaDeExemplo();
  f.procedimento[0]!.campos.find((c) => c.coluna === "vl_idade_maxima")!.sentinela = "Não se aplica";
  expect(montarResumo(f).cobrar.find((l) => l.rotulo === "Idade")!.valor).toBe("Não se aplica");
});

test("exigências: contagem e atalho para a seção; sem linhas é 'Sem exigência'", () => {
  const r = montarResumo(fichaDeExemplo({ cids: 12 }));
  const l = (rot: string) => r.cobrar.find((x) => x.rotulo === rot)!;
  expect(l("CID")).toMatchObject({ valor: "12 aceitos", ver: "rl_procedimento_cid" });
  expect(l("CBO")).toMatchObject({ valor: "69 aceitos", ver: "rl_procedimento_ocupacao" });
  expect(l("Habilitação")).toMatchObject({ valor: "Sem exigência" });
  expect(l("Habilitação").ver).toBeUndefined();
  expect(montarResumo(fichaDeExemplo({ cbos: 1 })).cobrar.find((x) => x.rotulo === "CBO")!.valor).toBe("1 aceito");
});

test("valores: SH, SP, SA, total, financiamento e rubrica", () => {
  const r = montarResumo(fichaDeExemplo());
  const v = Object.fromEntries(r.valores.map((l) => [l.rotulo, nbsp(l.valor)]));
  expect(v["Serviço hospitalar"]).toBe("R$ 0,00");
  expect(v["Serviço ambulatorial"]).toBe("R$ 10,00");
  expect(v["Total"]).toBe("R$ 10,00");
  expect(v["Financiamento"]).toBe("Média e Alta Complexidade (MAC) · 06");
  expect(v["Rubrica"]).toBe("Sem rubrica");
  expect(r.valores.filter((l) => l.origem).map((l) => l.rotulo)).toEqual(["Serviço hospitalar", "Serviço profissional", "Serviço ambulatorial", "Total"]);
});

test("incremento: nenhum, ou uma linha por habilitação", () => {
  expect(montarResumo(fichaDeExemplo()).incremento).toEqual([]);
  const inc = linha([campo("co_habilitacao", "0101"), campo("vl_percentual_sh", 2500, { unidade: "centesimos_de_percentual" }), campo("vl_percentual_sa", 0, { unidade: "centesimos_de_percentual" }), campo("vl_percentual_sp", 0, { unidade: "centesimos_de_percentual" })],
    [nome("tb_habilitacao", "co_habilitacao", { no_habilitacao: "Hospital geral" })]);
  expect(montarResumo(fichaDeExemplo({ incremento: [inc] })).incremento).toEqual(["0101 Hospital geral: +25% no serviço hospitalar"]);
});

test("regras e atributos: contagens; descrição oficial", () => {
  const r = montarResumo(fichaDeExemplo());
  expect(r.regras).toBe(2);
  expect(r.atributos).toBe(4);
  expect(r.descricao).toMatch(/^CONSULTA CLÍNICA/);
  expect(r.nome).toBe("CONSULTA MEDICA EM ATENÇÃO ESPECIALIZADA");
});

test("mais de uma linha no arquivo oficial é sinalizado", () => {
  const p = fichaDeExemplo().procedimento[0]!;
  expect(montarResumo(fichaDeExemplo()).linhasDuplicadas).toBe(0);
  expect(montarResumo(fichaDeExemplo({ procedimento: [p, p] })).linhasDuplicadas).toBe(2);
});

const dentro = (r: ReturnType<typeof montarResumo>, rot: string) => r.cobrar.find((x) => x.rotulo === rot)!;

test("notas de origem: idade em meses, valor especial e total", () => {
  const r = montarResumo(fichaDeExemplo());
  expect(dentro(r, "Idade").nota).toBe("0 a 1.571 meses no arquivo oficial");
  expect(dentro(r, "Quantidade máxima").nota).toBe("9999 no arquivo oficial");
  expect(dentro(r, "Permanência").nota).toBe("9999 no arquivo oficial");
  expect(dentro(r, "Sexo").nota).toBeUndefined();
  expect(r.valores.find((l) => l.rotulo === "Total")!.nota).toBe("SH + SP + SA");
});

test("tempo de permanência só aparece quando o campo existe", () => {
  expect(montarResumo(fichaDeExemplo()).cobrar.some((l) => l.rotulo === "Tempo de permanência")).toBe(false);
  const f = fichaDeExemplo();
  f.procedimento[0]!.campos.push(campo("qt_tempo_permanencia", 9999, { sentinela: "Não se aplica" }));
  const l = dentro(montarResumo(f), "Tempo de permanência");
  expect(l).toMatchObject({ valor: "Não se aplica", nota: "9999 no arquivo oficial" });
});

test("prévia: CID mostra os principais e os 3 primeiros com nome; CBO diz quantos faltam", () => {
  const cid = (c: string, n: string, p: string) => linha([campo("co_procedimento", "0301010072"), campo("co_cid", c), campo("st_principal", p)], [nome("tb_cid", "co_cid", { no_cid: n })]);
  const f = fichaDeExemplo({ cbos: 5 });
  f.relacoes.find((r) => r.tabela === "rl_procedimento_cid")!.linhas.push(cid("I10", "Hipertensão essencial", "S"), cid("I11", "Doença cardíaca hipertensiva", "N"), cid("J00", "Resfriado comum", "S"), cid("J01", "Sinusite aguda", "N"));
  const r = montarResumo(f);
  expect(dentro(r, "CID").nota).toBe("2 como principal · I10 Hipertensão essencial; I11 Doença cardíaca hipertensiva; J00 Resfriado comum; e mais 1");
  expect(dentro(r, "CBO").nota).toBe("223100 Ocupação 0; 223101 Ocupação 1; 223102 Ocupação 2; e mais 2");
  expect(dentro(r, "Habilitação").nota).toBeUndefined();
});

test("prévia: habilitação conta grupos; serviço junta serviço/classificação; leito lista os tipos", () => {
  const f = fichaDeExemplo();
  const hab = (c: string, g: string) => linha([campo("co_procedimento", "0301010072"), campo("co_habilitacao", c), campo("nu_grupo_habilitacao", g)], [nome("tb_habilitacao", "co_habilitacao", { no_habilitacao: `Hab ${c}` })]);
  const serv = linha([campo("co_procedimento", "0301010072"), campo("co_servico", "135"), campo("co_classificacao", "001")], [nome("tb_servico_classificacao", "co_classificacao", { no_classificacao: "Atenção ambulatorial" })]);
  const leito = (c: string, n: string) => linha([campo("co_procedimento", "0301010072"), campo("co_tipo_leito", c)], [nome("tb_tipo_leito", "co_tipo_leito", { no_tipo_leito: n })]);
  const rel = (t: string) => f.relacoes.find((r) => r.tabela === t)!;
  rel("rl_procedimento_habilitacao").linhas.push(hab("0801", "01"), hab("0801", "02"), hab("0802", "01"));
  rel("rl_procedimento_servico").linhas.push(serv);
  rel("rl_procedimento_leito").linhas.push(leito("01", "Cirúrgico"), leito("02", "Clínico"));
  const r = montarResumo(f);
  expect(dentro(r, "Habilitação").nota).toBe("2 grupos · 0801 Hab 0801; 0802 Hab 0802");
  expect(dentro(r, "Serviço").nota).toBe("135/001 Atenção ambulatorial");
  expect(dentro(r, "Leito")).toMatchObject({ valor: "2 tipos", ver: "rl_procedimento_leito", nota: "01 Cirúrgico; 02 Clínico" });
});

test("regras condicionadas e atributos listam código, nome e texto oficial", () => {
  const f = fichaDeExemplo();
  const regra = linha([campo("co_regra_condicionada", "0012")], [
    nome("tb_regra_condicionada", "co_regra_condicionada", { no_regra_condicionada: "Autorização prévia" }),
    nome("tb_descricao_regra", "co_regra_condicionada", { ds_regra_condicionada: "Exige autorização do gestor." }),
  ]);
  f.relacoes.find((r) => r.tabela === "rl_procedimento_regra_cond")!.linhas = [regra];
  const r = montarResumo(f);
  expect(r.regrasItens).toEqual([{ codigo: "0012", nome: "Autorização prévia", texto: "Exige autorização do gestor." }]);
  expect(r.atributosItens.map((i) => i.codigo)).toEqual(["001", "002", "003", "004"]);
  expect(r.atributosItens[0]!.nome).toBeNull();
});
