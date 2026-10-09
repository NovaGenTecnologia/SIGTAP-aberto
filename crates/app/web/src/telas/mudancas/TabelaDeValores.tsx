import { useState } from "react";
import type { ValorAlterado } from "../../api/tipos";
import { comSinal, percentual, reais } from "../../util/formatos";
import { ir } from "../../shell/rotas";
import { totalDoValor, variacaoDoValor } from "./modelo";

const PRIMEIRAS = 10;

export function SelosDeAfeta({ produz, apta }: { produz: boolean; apta: boolean | null }) {
  if (!produz && !apta) return null;
  return (
    <span className="mud__selos">
      {produz && <span className="mud__selo mud__selo--produz">produz</span>}
      {apta && <span className="mud__selo mud__selo--apta">apta</span>}
    </span>
  );
}

function Variacao({ v }: { v: ValorAlterado }) {
  const p = variacaoDoValor(v.antes, v.depois);
  if (p === null) return <span>—</span>;
  const r = Math.round(p);
  return <span>{r > 0 ? "+" : ""}{percentual(p)}</span>;
}

function Impacto({ centavos }: { centavos: number }) {
  return <span className={`num mud__impacto${centavos < 0 ? " mud__impacto--queda" : ""}`}>{comSinal(centavos)}</span>;
}

/** Valores alterados da tabela, na ordem do Rust (maior impacto na UF primeiro); as dez primeiras e o resto sob demanda. */
export function TabelaDeValores({ valores, soAfeta }: { valores: ValorAlterado[]; soAfeta: boolean }) {
  const [todas, setTodas] = useState(false);
  if (valores.length === 0) {
    return <p className="mud__vazio">{soAfeta ? "Nada nesta mudança afeta a sua unidade" : "Nenhum valor mudou entre as duas competências"}</p>;
  }
  const visiveis = todas ? valores : valores.slice(0, PRIMEIRAS);
  return (
    <div className="mud__cartao">
      <div className="mud__rolagem" role="region" aria-label="Valores alterados, tabela" tabIndex={0}>
        <table className="mud__tabela">
          <thead>
            <tr>
              <th scope="col">Procedimento</th>
              <th scope="col" className="mud__direita">Antes</th>
              <th scope="col" className="mud__direita">Depois</th>
              <th scope="col" className="mud__direita">Variação</th>
              <th scope="col" className="mud__direita">Impacto na unidade</th>
              <th scope="col" className="mud__direita">Impacto na UF</th>
              <th scope="col">Afeta</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((v) => (
              <tr key={v.procedimento}>
                <th scope="row" className="mud__proc">
                  <a className="mud__codigo" href={`#/consultar/${v.procedimento}`} onClick={(e) => { e.preventDefault(); ir("consultar", v.procedimento); }}>{v.procedimento}</a>
                  {v.nome && <span className="mud__nome">{v.nome}</span>}
                </th>
                <td className="num mud__direita">{reais(totalDoValor(v.antes))}</td>
                <td className="num mud__direita mud__forte">{reais(totalDoValor(v.depois))}</td>
                <td className="num mud__direita"><Variacao v={v} /></td>
                <td className="mud__direita"><Impacto centavos={v.impacto_unidade_anual_centavos} /></td>
                <td className="mud__direita"><Impacto centavos={v.impacto_uf_anual_centavos} /></td>
                <td><SelosDeAfeta produz={v.unidade_produz} apta={v.unidade_apta} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!todas && valores.length > PRIMEIRAS && (
        <button type="button" className="mud__mais" onClick={() => setTodas(true)}>Ver mais {valores.length - PRIMEIRAS} {valores.length - PRIMEIRAS === 1 ? "valor" : "valores"}</button>
      )}
    </div>
  );
}
