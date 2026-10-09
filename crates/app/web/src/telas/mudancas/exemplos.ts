import type { ValorAlterado } from "../../api/tipos";

const base = { sa: 1000, sh: 0, sp: 0 };
export const valor = (procedimento: string, depois: number, over: Partial<ValorAlterado> = {}): ValorAlterado => ({
  procedimento, nome: `PROC ${procedimento}`, antes: base, depois: { ...base, sa: depois },
  impacto_uf_anual_centavos: 500_000, impacto_unidade_anual_centavos: 0,
  unidade_produz: false, unidade_apta: false, afeta: false, ...over,
});
