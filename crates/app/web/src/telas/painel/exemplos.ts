import type { Pendencia } from "../../api/tipos";

export const queda: Pendencia = {
  id: "queda_de_valor:sia", tipo: "queda_de_valor", gravidade: "atencao",
  titulo: "Valor aprovado do SIA em queda", texto: "O valor aprovado no SIA caiu 22%.",
  valor_envolvido_centavos: 4_120_000,
  perda_estimada: { centavos: 16_480_000, horizonte_meses: 12, premissa: "se a queda se mantiver" },
  origem: { fonte: "SIA", competencias: ["202604", "202605", "202606"], conta: "(média anterior − média recente) × 3", nao_prova: "Não prova a causa da queda." },
  acao: { rotulo: "Ver itens", destino: "origem" }, itens: [],
};
export const semAptidao: Pendencia = {
  id: "produz_sem_aptidao", tipo: "produz_sem_aptidao", gravidade: "atencao",
  titulo: "Produz sem aptidão no cadastro", texto: "3 procedimentos produzidos sem aptidão.",
  valor_envolvido_centavos: 900_000, perda_estimada: null,
  origem: { fonte: "SIA, SIH e CNES", competencias: [], conta: "valor produzido", nao_prova: "Não diz se o cadastro está errado." },
  acao: { rotulo: "Ver itens", destino: "itens" },
  itens: [{ codigo: "0301010072", nome: "CONSULTA", valor_centavos: 500_000 }],
};
export const semValor: Pendencia = {
  id: "mes_incompleto", tipo: "mes_incompleto", gravidade: "info", titulo: "Mês incompleto na fonte",
  texto: "O SIA de 09/2026 está incompleto.", valor_envolvido_centavos: null, perda_estimada: null,
  origem: { fonte: "SIA", competencias: [], conta: "", nao_prova: "" }, acao: { rotulo: "Ver itens", destino: "origem" }, itens: [],
};
