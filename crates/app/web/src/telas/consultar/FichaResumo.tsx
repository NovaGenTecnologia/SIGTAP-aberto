import { useId, useState, type ReactNode } from "react";
import type { Ficha } from "../../api/tipos";
import { Botao } from "../../componentes/base/Botao";
import { NumeroComOrigem } from "../../componentes/dominio/NumeroComOrigem";
import { ir } from "../../shell/rotas";
import { montarResumo, type ItemDoResumo, type LinhaDoResumo } from "./modelo/resumo";

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="ficha-bloco">
      <h2 id={id}>{titulo}</h2>
      {children}
    </section>
  );
}

function Descricao({ texto }: { texto: string }) {
  const [aberta, setAberta] = useState(false);
  const longa = texto.length > 120;
  return (
    <div className="ficha-resumo__descricao">
      <p className="ficha-resumo__rotulo">Descrição oficial</p>
      <p className={aberta || !longa ? "" : "ficha-resumo__recolhida"}>{texto}</p>
      {longa && <Botao variante="discreto" aria-expanded={aberta} onPress={() => setAberta(!aberta)}>{aberta ? "Recolher" : "Mostrar inteira"}</Botao>}
    </div>
  );
}

function Itens({ rotulo, itens, tabela, codigo }: { rotulo: string; itens: ItemDoResumo[]; tabela: string; codigo: string }) {
  if (!itens.length) return null;
  return (
    <div className="ficha-itens">
      <h3>
        {rotulo} <span className="ficha-itens__contagem">{itens.length}</span>
        <Botao variante="discreto" aria-label={`Ver ${rotulo} em Exigências`} onPress={() => ir("consultar", codigo, "exigencias", tabela)}>ver</Botao>
      </h3>
      <ul aria-label={rotulo}>
        {itens.map((i, n) => (
          <li key={`${i.codigo}-${n}`}>
            <span className="num ficha-itens__codigo">{i.codigo}</span>
            <span>{i.nome ?? <span className="ficha-itens__sem">sem nome nesta competência</span>}</span>
            {i.texto && <details><summary>Texto oficial</summary><p>{i.texto}</p></details>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FichaResumo({ ficha }: { ficha: Ficha }) {
  const r = montarResumo(ficha);
  const ver = (rotulo: string, tabela: string) => (
    <Botao variante="discreto" aria-label={`Ver ${rotulo} em Exigências`} onPress={() => ir("consultar", ficha.codigo, "exigencias", tabela)}>ver</Botao>
  );
  const origem = (l: LinhaDoResumo) => ({
    fonte: "Tabela SIGTAP", competencia: ficha.rotulo,
    limites: [l.rotulo === "Total" ? "Soma de serviço hospitalar, profissional e ambulatorial." : "Em reais; no arquivo oficial, em centavos."],
  });
  return (
    <div className="ficha-resumo">
      {r.descricao && <Descricao texto={r.descricao} />}
      <div className="ficha-resumo__colunas">
        <Bloco titulo="Para cobrar">
          <dl>
            {r.cobrar.map((l) => (
              <div key={l.rotulo} className="ficha-linha">
                <dt>{l.rotulo}</dt>
                <dd>{l.valor}{l.ver && <> {ver(l.rotulo, l.ver)}</>}{l.nota && <small className="ficha-linha__nota">{l.nota}</small>}</dd>
              </div>
            ))}
          </dl>
        </Bloco>
        <div className="ficha-resumo__lateral">
          <Bloco titulo="Valores">
            <dl>
              {r.valores.map((l) => (
                <div key={l.rotulo} className={`ficha-linha${l.rotulo === "Total" ? " ficha-linha--total" : ""}`}>
                  <dt>{l.rotulo}</dt>
                  <dd>{l.origem ? <NumeroComOrigem rotulo={l.rotulo} valor={l.valor} origem={origem(l)} /> : l.valor}{l.nota && <small className="ficha-linha__nota">{l.nota}</small>}</dd>
                </div>
              ))}
            </dl>
          </Bloco>
          <Bloco titulo="Regras e atributos">
            <dl>
              <div className="ficha-linha">
                <dt>Incremento</dt>
                <dd>{r.incremento.length ? <ul className="ficha-lista">{r.incremento.map((t) => <li key={t}>{t}</li>)}</ul> : "Nenhum"}</dd>
              </div>
            </dl>
            <Itens rotulo="Regras condicionadas" itens={r.regrasItens} tabela="rl_procedimento_regra_cond" codigo={ficha.codigo} />
            <Itens rotulo="Atributos complementares" itens={r.atributosItens} tabela="rl_procedimento_detalhe" codigo={ficha.codigo} />
          </Bloco>
        </div>
      </div>
    </div>
  );
}
