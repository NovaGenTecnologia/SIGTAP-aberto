import type { ReactNode } from "react";
import { Cell, Column, Row, Table, TableBody, TableHeader, TableLayout, Virtualizer, type SortDescriptor } from "react-aria-components";
import "./dados.css";

export interface Coluna<L> {
  id: string;
  rotulo: string;
  ordenavel?: boolean;
  numerica?: boolean;
  /** Largura em porcentagem da tabela ("20%"). Sem isso, as colunas dividem a largura por igual. */
  largura?: `${number}%`;
  /** Menor largura em px: abaixo dela a tabela rola por dentro em vez de cortar a coluna. */
  larguraMinima?: number;
  celula: (linha: L) => ReactNode;
}

export interface TabelaDeDadosProps<L extends { id: string }> {
  rotulo: string;
  colunas: Coluna<L>[];
  linhas: L[];
  /** Altura da tabela: px, ou texto CSS (ex.: "100%", "calc(100vh - 400px)"). */
  altura?: number | string;
  ordenacao?: SortDescriptor;
  aoOrdenar?: (o: SortDescriptor) => void;
  aoAbrir?: (linha: L) => void;
}

export function TabelaDeDados<L extends { id: string }>({ rotulo, colunas, linhas, altura = 420, ordenacao, aoOrdenar, aoAbrir }: TabelaDeDadosProps<L>) {
  return (
    <div className="tabela" style={{ height: altura }}>
      <Virtualizer layout={TableLayout} layoutOptions={{ rowHeight: 36, headingHeight: 36 }}>
        <Table aria-label={rotulo} sortDescriptor={ordenacao} onSortChange={aoOrdenar}
          onRowAction={aoAbrir ? (k) => { const l = linhas.find((x) => x.id === String(k)); if (l) aoAbrir(l); } : undefined}
          className="tabela__grade">
          <TableHeader columns={colunas} className="tabela__cabeca">
            {(c) => (
              <Column id={c.id} width={c.largura} minWidth={c.larguraMinima} isRowHeader={c.id === colunas[0]?.id} allowsSorting={c.ordenavel} className={`tabela__coluna${c.numerica ? " tabela__coluna--num" : ""}`}>
                {({ sortDirection }) => (<>{c.rotulo}{sortDirection && <span aria-hidden="true">{sortDirection === "ascending" ? " ▲" : " ▼"}</span>}</>)}
              </Column>
            )}
          </TableHeader>
          <TableBody items={linhas} dependencies={[colunas]} renderEmptyState={() => <p className="tabela__vazia">Nenhum resultado.</p>}>
            {(l) => (
              <Row id={l.id} columns={colunas} dependencies={[colunas]} className="tabela__linha">
                {(c) => <Cell className={`tabela__celula${c.numerica ? " tabela__celula--num num" : ""}`}>{c.celula(l)}</Cell>}
              </Row>
            )}
          </TableBody>
        </Table>
      </Virtualizer>
    </div>
  );
}
