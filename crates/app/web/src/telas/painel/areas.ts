import type { Pendencia } from "../../api/tipos";

export type Area = "cadastro" | "aptidao" | "producao";
export const AREAS: Area[] = ["cadastro", "aptidao", "producao"];
export const ROTULO_DA_AREA: Record<Area, string> = { cadastro: "Cadastro", aptidao: "Aptidão", producao: "Produção" };

const AREA_DO_TIPO: Record<string, Area> = {
  produz_sem_aptidao: "aptidao", produz_com_ressalva: "aptidao",
  servico_fora_do_cadastro: "cadastro", habilitacao_sem_producao: "cadastro",
  rejeicao_acima_dos_pares: "producao", quantidade_atipica: "producao", permanencia_fora_do_previsto: "producao", mes_incompleto: "producao",
};

/** Tipo novo do backend, ainda sem área: cai na Produção, onde moram as pendências de dado de origem. */
export const areaDe = (p: Pendencia): Area => AREA_DO_TIPO[p.tipo] ?? "producao";

export function contarPorArea(ps: Pendencia[]): Record<Area, number> {
  const c: Record<Area, number> = { cadastro: 0, aptidao: 0, producao: 0 };
  for (const p of ps) c[areaDe(p)] += 1;
  return c;
}
