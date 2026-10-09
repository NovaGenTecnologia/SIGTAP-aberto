import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { unidadesBuscar } from "../../../api/comandos";
import type { UnidadeRef } from "../../../api/tipos";
import { Botao } from "../../../componentes/base/Botao";
import { CampoBusca } from "../../../componentes/base/CampoBusca";
import { useTerceiros } from "../../../dados/unidade";
import { useDebounce } from "../../../shell/useDebounce";

const mensagem = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Não foi possível concluir.");
const nomeDe = (t: UnidadeRef) => (t.nome.trim() ? t.nome : `CNES ${t.cnes}`);

/** Estabelecimentos que o usuário declarou como terceiros da unidade: o cadastro público não os lista. */
export function Terceiros({ uf, cnes, terceiros }: { uf: string; cnes: string; terceiros: UnidadeRef[] }) {
  const { adicionar, remover } = useTerceiros(uf, cnes);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [removido, setRemovido] = useState<UnidadeRef | null>(null);
  const busca = useDebounce(texto.trim(), 250);
  const achados = useQuery({ queryKey: ["unidades-buscar", busca], queryFn: () => unidadesBuscar(busca), enabled: busca.length >= 2 });

  async function incluir(t: { uf: string; cnes: string }) {
    setErro(null);
    setRemovido(null);
    try { await adicionar.mutateAsync(t); } catch (e) { setErro(mensagem(e)); }
  }
  async function tirar(t: UnidadeRef) {
    setErro(null);
    try { await remover.mutateAsync(t); setRemovido(t); } catch (e) { setErro(mensagem(e)); }
  }
  async function desfazer() {
    const t = removido;
    if (!t) return;
    setRemovido(null);
    await incluir(t);
  }

  return (
    <div className="un__bloco">
      <div>
        <h2 className="un__secao">Declarados por você</h2>
        <p className="un__sub">Serviços que estes estabelecimentos prestam contam na Aptidão.</p>
      </div>

      {terceiros.length === 0 ? (
        <p className="un__vazio un__cartao">Nenhum terceiro declarado</p>
      ) : (
        <ul className="un__cartao un__lista" aria-label="Terceiros declarados">
          {terceiros.map((t) => (
            <li key={`${t.uf}:${t.cnes}`} className="un__item">
              <div>
                <span className="un__codigo">{nomeDe(t)}</span>
                <span className="un__nome">{t.uf} · CNES {t.cnes}</span>
              </div>
              <Botao variante="discreto" onPress={() => void tirar(t)} aria-label={`Remover ${nomeDe(t)}`}>Remover</Botao>
            </li>
          ))}
        </ul>
      )}

      {removido && (
        <p role="status" className="un__aviso">
          <span>{nomeDe(removido)} removido.</span>
          <Botao variante="discreto" onPress={() => void desfazer()}>Desfazer</Botao>
        </p>
      )}
      {erro && <p role="alert" className="un__erro">{erro}</p>}

      <div className="un__barra">
        <CampoBusca rotulo="Buscar estabelecimento por nome ou CNES" value={texto} onChange={setTexto} />
      </div>
      {busca.length >= 2 && achados.data && (
        achados.data.length === 0 ? (
          <p className="un__vazio">Nenhum estabelecimento encontrado para «{busca}»</p>
        ) : (
          <ul className="un__cartao un__lista" aria-label="Resultados da busca">
            {achados.data.map((e) => (
              <li key={`${e.uf}:${e.cnes}`} className="un__item">
                <div>
                  <span className="un__codigo">{e.nome.trim() ? e.nome : `CNES ${e.cnes}`}</span>
                  <span className="un__nome">{[`${e.municipio_nome ? `${e.municipio_nome} ` : ""}(${e.uf})`, `CNES ${e.cnes}`, e.tipo_nome].filter(Boolean).join(" · ")}</span>
                </div>
                <Botao onPress={() => void incluir({ uf: e.uf, cnes: e.cnes })} aria-label={`Adicionar ${e.nome.trim() ? e.nome : `CNES ${e.cnes}`}`}>Adicionar</Botao>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
