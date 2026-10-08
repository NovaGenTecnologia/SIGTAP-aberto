import type { Ficha, RelacaoOficial } from "../../../api/tipos";

// Nomes e grupos de apresentação (não são dados): portados de crates/app/ui/app.js (NOME_RELACAO, GRUPOS_ABA).
const NOMES: Record<string, string> = {
  "rl_procedimento_cid.co_procedimento": "CID",
  "rl_procedimento_ocupacao.co_procedimento": "CBO",
  "rl_procedimento_habilitacao.co_procedimento": "Habilitação",
  "rl_procedimento_servico.co_procedimento": "Serviço",
  "rl_procedimento_leito.co_procedimento": "Leito",
  "rl_procedimento_incremento.co_procedimento": "Incremento",
  "rl_procedimento_compativel.co_procedimento_principal": "Compatíveis",
  "rl_procedimento_compativel.co_procedimento_compativel": "É compatível de",
  "rl_excecao_compatibilidade.co_procedimento_restricao": "Exceção: restrição",
  "rl_excecao_compatibilidade.co_procedimento_principal": "Exceção: principal",
  "rl_excecao_compatibilidade.co_procedimento_compativel": "Exceção: compatível",
  "rl_procedimento_regra_cond.co_procedimento": "Regras condicionadas",
  "rl_procedimento_sia_sih.co_procedimento": "Origem SIA/SIH",
  "rl_procedimento_origem.co_procedimento": "Origem",
  "rl_procedimento_origem.co_procedimento_origem": "É origem de",
  "rl_procedimento_renases.co_procedimento": "RENASES",
  "rl_procedimento_tuss.co_procedimento": "TUSS",
  "rl_procedimento_comp_rede.co_procedimento": "Redes",
  "rl_procedimento_detalhe.co_procedimento": "Atributos",
  "rl_procedimento_modalidade.co_procedimento": "Modalidade",
  "rl_procedimento_registro.co_procedimento": "Instrumento",
};

// Ordem de uso do faturista. Relação nova, sem grupo, cai em "Relações".
const GRUPOS: { id: GrupoDeRelacoes["id"]; rotulo: string; chaves: string[] }[] = [
  { id: "exigencias", rotulo: "Exigências para cobrar", chaves: [
    "rl_procedimento_registro.co_procedimento", "rl_procedimento_cid.co_procedimento", "rl_procedimento_ocupacao.co_procedimento",
    "rl_procedimento_habilitacao.co_procedimento", "rl_procedimento_servico.co_procedimento", "rl_procedimento_leito.co_procedimento",
    "rl_procedimento_modalidade.co_procedimento"] },
  { id: "valores", rotulo: "Valores e regras", chaves: [
    "rl_procedimento_incremento.co_procedimento", "rl_procedimento_regra_cond.co_procedimento", "rl_procedimento_detalhe.co_procedimento"] },
  { id: "relacoes", rotulo: "Relações", chaves: [
    "rl_procedimento_compativel.co_procedimento_principal", "rl_procedimento_compativel.co_procedimento_compativel",
    "rl_excecao_compatibilidade.co_procedimento_principal", "rl_excecao_compatibilidade.co_procedimento_compativel",
    "rl_excecao_compatibilidade.co_procedimento_restricao", "rl_procedimento_origem.co_procedimento", "rl_procedimento_origem.co_procedimento_origem",
    "rl_procedimento_sia_sih.co_procedimento", "rl_procedimento_renases.co_procedimento", "rl_procedimento_tuss.co_procedimento",
    "rl_procedimento_comp_rede.co_procedimento"] },
];

// A descrição do procedimento aparece no Resumo, não como relação.
const OCULTAS = new Set(["tb_descricao.co_procedimento"]);

export interface GrupoDeRelacoes {
  id: "exigencias" | "valores" | "relacoes";
  rotulo: string;
  relacoes: RelacaoOficial[];
  vazias: RelacaoOficial[];
}

export const chaveDaRelacao = (r: RelacaoOficial): string => `${r.tabela}.${r.coluna}`;

export function nomeDaRelacao(r: RelacaoOficial): string {
  return NOMES[chaveDaRelacao(r)] ?? `${r.tabela} (${r.coluna})`;
}

export function agruparRelacoes(f: Ficha): GrupoDeRelacoes[] {
  const visiveis = f.relacoes.filter((r) => !OCULTAS.has(chaveDaRelacao(r)));
  const conhecidas = new Set(GRUPOS.flatMap((g) => g.chaves));
  return GRUPOS.map((g) => {
    const doGrupo = g.id === "relacoes"
      ? [
          ...g.chaves.flatMap((k) => visiveis.filter((r) => chaveDaRelacao(r) === k)),
          ...visiveis.filter((r) => !conhecidas.has(chaveDaRelacao(r))),
        ]
      : g.chaves.flatMap((k) => visiveis.filter((r) => chaveDaRelacao(r) === k));
    return {
      id: g.id, rotulo: g.rotulo,
      relacoes: doGrupo.filter((r) => r.linhas.length > 0),
      vazias: doGrupo.filter((r) => r.linhas.length === 0),
    };
  });
}

/** A tabela faz parte das exigências para cobrar (filtro "Exigências" do histórico). */
export const ehExigencia = (tabela: string): boolean => GRUPOS[0]!.chaves.some((k) => k.startsWith(`${tabela}.`));
