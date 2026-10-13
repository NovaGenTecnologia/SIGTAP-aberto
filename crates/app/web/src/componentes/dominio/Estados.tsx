import { Botao } from "../base/Botao";
import { Marca } from "./Marca";
import { useEspera } from "./useEspera";
import "./dominio.css";

export function EstadoVazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: { rotulo: string; aoAcionar: () => void } }) {
  return (
    <div className="estado">
      <h2 className="estado__titulo">{titulo}</h2>
      {descricao && <p className="estado__texto">{descricao}</p>}
      {acao && <Botao variante="primario" onPress={acao.aoAcionar}>{acao.rotulo}</Botao>}
    </div>
  );
}

export function EstadoErro({ mensagem, aoTentar }: { mensagem: string; aoTentar: () => void }) {
  return (
    <div className="estado estado--erro" role="alert">
      <p className="estado__texto">{mensagem}</p>
      <Botao onPress={aoTentar}>Tentar de novo</Botao>
    </div>
  );
}

export function Carregando({ rotulo = "Carregando" }: { rotulo?: string }) {
  return (
    <div className="carregando" role="status" aria-busy="true" aria-label={rotulo}>
      <div className="esqueleto esqueleto--titulo" /><div className="esqueleto" /><div className="esqueleto esqueleto--curto" />
    </div>
  );
}

export function CarregandoComEspera({ rotulo, semIndicador = false }: { rotulo: string; semIndicador?: boolean }) {
  const { segundos, contador, aviso } = useEspera(true);
  return (
    <div className="carregando carregando--espera" role="status" aria-busy="true" aria-label={rotulo}>
      {!semIndicador && <Marca variante="simbolo" animacao="carregando" altura={96} decorativa />}
      <span>{rotulo}</span>
      {contador && <span className="num carregando__tempo">{segundos} s</span>}
      {aviso && <span className="carregando__aviso">Ainda em andamento</span>}
    </div>
  );
}
