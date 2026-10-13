import type { EquipamentoCadastrado } from "../../../api/tipos";
import { inteiro } from "../../../util/formatos";
import { CodigoENome, TabelaDoCadastro, type ColunaDoCadastro } from "../TabelaDoCadastro";

type Linha = EquipamentoCadastrado & { id: string };

/** Equipamentos da unidade; sem o nome no arquivo de apoio, mostra só o código. */
export function Equipamentos({ equipamentos, busca, aoBuscar }: { equipamentos: EquipamentoCadastrado[]; busca: string; aoBuscar: (t: string) => void }) {
  const linhas: Linha[] = equipamentos.map((e, i) => ({ ...e, id: `${e.equipamento.codigo}/${i}` }));
  const colunas: ColunaDoCadastro<Linha>[] = [
    { id: "eq", rotulo: "Equipamento", celula: (l) => <CodigoENome codigo={l.equipamento.codigo} nome={l.equipamento.nome} /> },
    { id: "ex", rotulo: "Existentes", numerica: true, celula: (l) => inteiro(l.existentes) },
    { id: "uso", rotulo: "Em uso", numerica: true, celula: (l) => inteiro(l.em_uso) },
    { id: "sus", rotulo: "Disponível ao SUS", celula: (l) => (l.disponivel_sus ? "Sim" : "Não") },
  ];
  return (
    <TabelaDoCadastro rotulo="Equipamentos" colunas={colunas} linhas={linhas} busca={busca} aoBuscar={aoBuscar} nomeDoArquivo="equipamentos"
      texto={(l) => `${l.equipamento.codigo} ${l.equipamento.nome ?? ""}`}
      planilha={(ls) => ({
        titulo: "Equipamentos da unidade",
        abas: [{ nome: "Equipamentos", colunas: ["Equipamento", "Nome", "Existentes", "Em uso", "Disponível ao SUS"],
          linhas: ls.map((l) => [l.equipamento.codigo, l.equipamento.nome, l.existentes, l.em_uso, l.disponivel_sus ? "Sim" : "Não"]) }],
      })} />
  );
}
