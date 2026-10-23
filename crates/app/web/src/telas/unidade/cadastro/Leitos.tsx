import type { LeitoCadastrado } from "../../../api/tipos";
import { inteiro } from "../../../util/formatos";
import { CodigoENome, TabelaDoCadastro, type ColunaDoCadastro } from "../TabelaDoCadastro";

type Linha = LeitoCadastrado & { id: string };

/** Leitos por tipo e especialidade; sem o nome no arquivo de apoio, mostra só o código. */
export function Leitos({ leitos, busca, aoBuscar }: { leitos: LeitoCadastrado[]; busca: string; aoBuscar: (t: string) => void }) {
  const linhas: Linha[] = leitos.map((l, i) => ({ ...l, id: `${l.tipo.codigo}/${l.especialidade.codigo}/${i}` }));
  const colunas: ColunaDoCadastro<Linha>[] = [
    { id: "tipo", rotulo: "Tipo", celula: (l) => <CodigoENome codigo={l.tipo.codigo} nome={l.tipo.nome} /> },
    { id: "esp", rotulo: "Especialidade", celula: (l) => <CodigoENome codigo={l.especialidade.codigo} nome={l.especialidade.nome} /> },
    { id: "ex", rotulo: "Existentes", numerica: true, celula: (l) => inteiro(l.existentes) },
    { id: "sus", rotulo: "SUS", numerica: true, celula: (l) => inteiro(l.sus) },
    { id: "nsus", rotulo: "Não SUS", numerica: true, celula: (l) => inteiro(l.nao_sus) },
  ];
  return (
    <TabelaDoCadastro rotulo="Leitos" colunas={colunas} linhas={linhas} busca={busca} aoBuscar={aoBuscar} nomeDoArquivo="leitos"
      texto={(l) => `${l.tipo.codigo} ${l.tipo.nome ?? ""} ${l.especialidade.codigo} ${l.especialidade.nome ?? ""}`}
      planilha={(ls) => ({
        titulo: "Leitos da unidade",
        abas: [{ nome: "Leitos", colunas: ["Tipo", "Nome do tipo", "Especialidade", "Nome da especialidade", "Existentes", "SUS", "Não SUS"],
          linhas: ls.map((l) => [l.tipo.codigo, l.tipo.nome, l.especialidade.codigo, l.especialidade.nome, l.existentes, l.sus, l.nao_sus]) }],
      })} />
  );
}
