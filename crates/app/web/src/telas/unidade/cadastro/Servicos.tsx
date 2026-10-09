import type { ServicoCadastrado } from "../../../api/tipos";
import { CodigoENome, TabelaDoCadastro, type ColunaDoCadastro } from "../TabelaDoCadastro";

type Linha = ServicoCadastrado & { id: string };
const simNao = (v: boolean) => (v ? "Sim" : "Não");

/** Serviços e classificações da unidade, com o terceiro que presta o serviço quando há. */
export function Servicos({ servicos, busca, aoBuscar }: { servicos: ServicoCadastrado[]; busca: string; aoBuscar: (t: string) => void }) {
  const linhas: Linha[] = servicos.map((s, i) => ({ ...s, id: `${s.servico.codigo}/${s.classificacao.codigo}/${s.terceiro}/${i}` }));
  const colunas: ColunaDoCadastro<Linha>[] = [
    { id: "serv", rotulo: "Serviço", celula: (l) => <CodigoENome codigo={l.servico.codigo} nome={l.servico.nome} /> },
    { id: "class", rotulo: "Classificação", celula: (l) => <CodigoENome codigo={l.classificacao.codigo} nome={l.classificacao.nome} /> },
    { id: "amb", rotulo: "Ambulatorial SUS", celula: (l) => simNao(l.ambulatorial_sus) },
    { id: "hosp", rotulo: "Hospitalar SUS", celula: (l) => simNao(l.hospitalar_sus) },
    { id: "terc", rotulo: "Terceiro", celula: (l) => l.terceiro || "—" },
  ];
  return (
    <TabelaDoCadastro rotulo="Serviços" colunas={colunas} linhas={linhas} busca={busca} aoBuscar={aoBuscar} nomeDoArquivo="servicos"
      texto={(l) => `${l.servico.codigo} ${l.servico.nome ?? ""} ${l.classificacao.codigo} ${l.classificacao.nome ?? ""} ${l.terceiro}`}
      planilha={(ls) => ({
        titulo: "Serviços da unidade",
        abas: [{ nome: "Serviços", colunas: ["Serviço", "Nome do serviço", "Classificação", "Nome da classificação", "Ambulatorial SUS", "Hospitalar SUS", "Terceiro"],
          linhas: ls.map((l) => [l.servico.codigo, l.servico.nome, l.classificacao.codigo, l.classificacao.nome, simNao(l.ambulatorial_sus), simNao(l.hospitalar_sus), l.terceiro || null]) }],
      })} />
  );
}
