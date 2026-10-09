import type { MesDaUnidade, Pendencia } from "../../../api/tipos";
import { faturamentoExemplo } from "../exemplosDeProducao";
import { faixaDeCobertura, mesesEmTexto, oQueOlhar, sentidoDe, ultimoCompleto, valorCompacto } from "./util";

const R = (reais: number) => Math.round(reais * 100);

test("valorCompacto: bilhões, milhões, milhares e reais inteiros", () => {
  expect(valorCompacto(R(1_060_000_000))).toBe("R$ 1,06 bi");
  expect(valorCompacto(R(2_300_000))).toBe("R$ 2,3 mi");
  expect(valorCompacto(R(106_000_000))).toBe("R$ 106,0 mi");
  expect(valorCompacto(R(74_600))).toBe("R$ 74,6 mil");
  expect(valorCompacto(R(850))).toBe("R$ 850");
  expect(valorCompacto(0)).toBe("R$ 0");
});

test("valorCompacto: nos limites passa para a unidade de cima em vez de mostrar 1.000 mil", () => {
  expect(valorCompacto(R(999))).toBe("R$ 999");
  expect(valorCompacto(R(1_000))).toBe("R$ 1,0 mil");
  expect(valorCompacto(R(999_999))).toBe("R$ 1,0 mi");
  expect(valorCompacto(R(1_000_000))).toBe("R$ 1,0 mi");
  expect(valorCompacto(R(999_999_999))).toBe("R$ 1,00 bi");
});

test("valorCompacto: valor negativo leva o sinal de menos", () => {
  expect(valorCompacto(-R(74_600))).toBe("−R$ 74,6 mil");
});

test("sentidoDe diz o sentido em palavra e símbolo, pelo que o Rust decidiu", () => {
  expect(sentidoDe({ media_anterior: 1, media_recente: 1, sentido: "sobe", variacao_percentual: 8 })).toEqual({ rotulo: "sobe", sinal: "▲", texto: "sobe +8,0%" });
  expect(sentidoDe({ media_anterior: 1, media_recente: 1, sentido: "cai", variacao_percentual: -3.2 })).toEqual({ rotulo: "cai", sinal: "▼", texto: "cai −3,2%" });
  expect(sentidoDe({ media_anterior: 1, media_recente: 1, sentido: "estavel", variacao_percentual: 0 })).toEqual({ rotulo: "estável", sinal: "●", texto: "estável 0,0%" });
  expect(sentidoDe({ media_anterior: 0, media_recente: 5, sentido: "sobe", variacao_percentual: null })?.texto).toBe("sobe");
  expect(sentidoDe(null)).toBeNull();
});

test("ultimoCompleto ignora o mês incompleto", () => {
  const meses = [{ competencia: "202605" }, { competencia: "202606" }, { competencia: "202607" }] as MesDaUnidade[];
  expect(ultimoCompleto(meses, ["202605", "202606"])?.competencia).toBe("202606");
  expect(ultimoCompleto(meses, [])).toBeNull();
});

test("faixaDeCobertura lista os meses incompletos de cada sistema e some quando está tudo completo", () => {
  const f = faturamentoExemplo();
  expect(faixaDeCobertura(f.cobertura)).toEqual([
    { sistema: "SIA", competencia: "202607", estabelecimentos: 7_241, texto: "SIA de 07/2026 incompleto (7.241 estabelecimentos): fora da conta" },
  ]);
  const completo = { sia: f.cobertura.sia.map((m) => ({ ...m, completo: true })), sih: f.cobertura.sih };
  expect(faixaDeCobertura(completo)).toEqual([]);
});

describe("oQueOlhar", () => {
  const p = (tipo: string, valor: number | null, gravidade: "atencao" | "info" = "atencao"): Pendencia => ({
    id: tipo, tipo, gravidade, titulo: tipo, texto: "", valor_envolvido_centavos: valor, perda_estimada: null,
    origem: { fonte: "SIH", competencias: [], conta: "", nao_prova: "" }, acao: { rotulo: "", destino: "origem" }, itens: [],
  });
  test("só pendências de produção, da mais cara à mais barata, no máximo cinco", () => {
    const todas = [
      p("queda_de_valor", 9_999), p("quantidade_atipica", 500), p("permanencia_fora_do_previsto", null, "info"),
      p("rejeicao_acima_dos_pares", 800), p("habilitacao_sem_producao", 1),
    ];
    expect(oQueOlhar(todas).map((x) => x.tipo)).toEqual(["rejeicao_acima_dos_pares", "quantidade_atipica", "permanencia_fora_do_previsto"]);
  });
  test("o mês incompleto fica de fora: já está na faixa do topo", () => {
    expect(oQueOlhar([p("mes_incompleto", null, "info")])).toEqual([]);
  });
  test("sem valor, atenção vem antes de info", () => {
    const r = oQueOlhar([p("permanencia_fora_do_previsto", null, "info"), p("quantidade_atipica", null, "atencao")]);
    expect(r.map((x) => x.tipo)).toEqual(["quantidade_atipica", "permanencia_fora_do_previsto"]);
  });
});

test("mesesEmTexto: intervalo quando os meses são seguidos, lista quando há buraco, nada quando vazio", () => {
  expect(mesesEmTexto(["202508", "202509", "202510"])).toBe("08–10/2025");
  expect(mesesEmTexto(["202511", "202512", "202601"])).toBe("11/2025–01/2026");
  expect(mesesEmTexto(["202508", "202510"])).toBe("08/2025, 10/2025");
  expect(mesesEmTexto(["202508"])).toBe("08/2025");
  expect(mesesEmTexto([])).toBe("");
});
