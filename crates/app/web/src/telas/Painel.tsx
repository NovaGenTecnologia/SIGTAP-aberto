import { BlocoDeDados } from "../componentes/dominio/BlocoDeDados";
import { EstadoVazio } from "../componentes/dominio/Estados";
import { useUnidades } from "../dados/consultas";
import { ir } from "../shell/rotas";
import "./telas.css";

export function Painel() {
  const { data } = useUnidades();
  const unidade = data?.minha ?? null;
  return (
    <div className="tela">
      <h1>Painel</h1>
      {data && !unidade ? (
        <EstadoVazio titulo="Nenhuma unidade escolhida" descricao="Escolha a sua unidade para ver pendências, produção e aptidão."
          acao={{ rotulo: "Escolher unidade", aoAcionar: () => ir("dados") }} />
      ) : (
        <>
          {unidade && <p className="tela__unidade">{unidade.nome.trim() || `CNES ${unidade.cnes}`} ({unidade.uf})</p>}
          <BlocoDeDados titulo="Pendências"><EstadoVazio titulo="Pendências" descricao="Chegam na próxima etapa." /></BlocoDeDados>
        </>
      )}
    </div>
  );
}
