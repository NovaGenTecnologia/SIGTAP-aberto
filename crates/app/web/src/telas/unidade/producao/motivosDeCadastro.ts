import type { AbaDeCadastro, TelaDaUnidade } from "../../../shell/rotas";

/**
 * Motivos de rejeição (MOTERRO) cuja descrição oficial fala de um item do cadastro da unidade: o link só existe onde o texto
 * oficial justifica. Qualquer outro motivo (inclusive os que citam CPF ou CBO) fica sem link.
 */
const ABA_DO_MOTIVO: Record<string, AbaDeCadastro> = {
  "060072": "servicos", "060055": "servicos",
  "050098": "habilitacoes", "060120": "habilitacoes",
  "050008": "leitos", "060020": "leitos", "060021": "leitos", "060022": "leitos",
  "060110": "profissionais", "060065": "profissionais",
};

export function destinoDoMotivo(codigo: string): { rotulo: string; tela: TelaDaUnidade } | null {
  const aba = ABA_DO_MOTIVO[codigo.trim()];
  return aba ? { rotulo: "Ver no Cadastro", tela: { tela: "cadastro", aba, q: "" } } : null;
}
