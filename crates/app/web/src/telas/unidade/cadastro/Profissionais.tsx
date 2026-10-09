import type { ProfissionalCadastrado } from "../../../api/tipos";
import { CodigoENome, TabelaDoCadastro, type ColunaDoCadastro } from "../TabelaDoCadastro";

type Linha = ProfissionalCadastrado & { id: string };

const horas = (p: ProfissionalCadastrado) =>
  [p.horas_ambulatorio && `${p.horas_ambulatorio} h ambulatório`, p.horas_hospital && `${p.horas_hospital} h hospital`, p.horas_outros && `${p.horas_outros} h outros`]
    .filter(Boolean).join(" · ") || "—";

/** Profissionais da unidade (arquivo de pessoas do CNES). Nunca CPF: o Rust não o devolve e a tela não o pede. */
export function Profissionais({ profissionais, busca, aoBuscar }: { profissionais: ProfissionalCadastrado[]; busca: string; aoBuscar: (t: string) => void }) {
  const linhas: Linha[] = profissionais.map((p, i) => ({ ...p, id: `${i}` }));
  const colunas: ColunaDoCadastro<Linha>[] = [
    { id: "nome", rotulo: "Nome", celula: (l) => l.nome },
    { id: "cbo", rotulo: "Ocupação (CBO)", celula: (l) => <CodigoENome codigo={l.cbo.codigo} nome={l.cbo.nome} /> },
    { id: "vinc", rotulo: "Vínculo", celula: (l) => <CodigoENome codigo={l.vinculo.codigo} nome={l.vinculo.nome} /> },
    { id: "sus", rotulo: "Atende pelo SUS", celula: (l) => (l.atende_sus ? "Sim" : "Não") },
    { id: "h", rotulo: "Horas", celula: horas },
  ];
  return (
    <TabelaDoCadastro rotulo="Profissionais" colunas={colunas} linhas={linhas} busca={busca} aoBuscar={aoBuscar} nomeDoArquivo="profissionais"
      texto={(l) => `${l.nome} ${l.cbo.codigo} ${l.cbo.nome ?? ""} ${l.vinculo.codigo} ${l.vinculo.nome ?? ""}`}
      planilha={(ls) => ({
        titulo: "Profissionais da unidade",
        abas: [{ nome: "Profissionais", colunas: ["Nome", "CBO", "Ocupação", "Vínculo", "Atende pelo SUS", "Horas ambulatório", "Horas hospital", "Horas outros"],
          linhas: ls.map((l) => [l.nome, l.cbo.codigo, l.cbo.nome, l.vinculo.codigo, l.atende_sus ? "Sim" : "Não", l.horas_ambulatorio, l.horas_hospital, l.horas_outros]) }],
      })} />
  );
}
