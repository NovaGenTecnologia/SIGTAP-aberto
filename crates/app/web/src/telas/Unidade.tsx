import type { ReactNode } from "react";
import type { TelaDaUnidade } from "../shell/rotas";
import { ir } from "../shell/rotas";
import { useSessao } from "../shell/sessao";
import { Carregando, EstadoErro, EstadoVazio } from "../componentes/dominio/Estados";
import { useUnidades } from "../dados/consultas";
import { useUnidade } from "../dados/unidade";
import { FaltaParaOPainel } from "./painel/FaltaParaOPainel";
import { Aptidao } from "./unidade/aptidao/Aptidao";
import { Cadastro } from "./unidade/cadastro/Cadastro";
import { CabecalhoDaUnidade } from "./unidade/CabecalhoDaUnidade";
import "./unidade/unidade.css";

const texto = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível ler a unidade.");
type Subtela = Exclude<TelaDaUnidade, { tela: "painel" }>;

/** Cadastro, Aptidão e Produção da unidade ativa: o cabeçalho comum decide os estados antes de cada tela. */
export function Unidade({ tela }: { tela: Subtela }) {
  const { competencia } = useSessao();
  const unidades = useUnidades();
  const minha = unidades.data?.minha ?? null;
  const ufCarregada = !!minha && !!unidades.data?.ufs.some((u) => u.uf === minha.uf && !u.erro);
  const cadastro = useUnidade(competencia ?? undefined, minha ? { uf: minha.uf, cnes: minha.cnes } : undefined, ufCarregada);
  const irma = tela.tela;
  const sozinho = (conteudo: ReactNode) => (
    <div className="un"><CabecalhoDaUnidade tela={irma} unidade={null} />{conteudo}</div>
  );

  if (unidades.isPending) return sozinho(<Carregando rotulo="Lendo a unidade" />);
  if (unidades.isError) return sozinho(<EstadoErro mensagem={texto(unidades.error)} aoTentar={() => void unidades.refetch()} />);
  if (!minha) {
    return sozinho(
      <>
        <div className="un__cartao">
          <EstadoVazio titulo="Nenhuma unidade escolhida" descricao="Escolha a sua unidade para ver o cadastro e a aptidão."
            acao={{ rotulo: "Escolher unidade", aoAcionar: () => ir("dados") }} />
        </div>
        <FaltaParaOPainel />
      </>,
    );
  }
  if (!ufCarregada) {
    return sozinho(
      <div className="un__cartao">
        <EstadoVazio titulo={`O cadastro do CNES de ${minha.uf} não está carregado`} descricao="Baixe o cadastro para ver as habilitações, os serviços e a aptidão da unidade."
          acao={{ rotulo: "Abrir em Dados", aoAcionar: () => ir("dados") }} />
      </div>,
    );
  }
  if (cadastro.isPending) return sozinho(<Carregando rotulo="Lendo o cadastro da unidade" />);
  if (cadastro.isError) return sozinho(<EstadoErro mensagem={texto(cadastro.error)} aoTentar={() => void cadastro.refetch()} />);

  const un = cadastro.data;
  if (tela.tela === "producao") {
    return (
      <div className="un">
        <CabecalhoDaUnidade tela="producao" unidade={un} />
        <div className="un__cartao"><EstadoVazio titulo="Em breve" descricao="A produção da unidade chega numa próxima versão." /></div>
      </div>
    );
  }
  return tela.tela === "cadastro"
    ? <Cadastro unidade={un} rota={tela} competencia={competencia ?? undefined} />
    : <Aptidao unidade={un} rota={tela} competencia={competencia ?? undefined} />;
}
