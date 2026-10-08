import { Button, Dialog, DialogTrigger, Heading, Popover } from "react-aria-components";
import "./dominio.css";

export interface Origem { fonte: string; competencia?: string; limites?: string[] }

export function NumeroComOrigem({ rotulo, valor, origem }: { rotulo: string; valor: string; origem: Origem }) {
  return (
    <span className="numero">
      <span className="numero__valor num">{valor}</span>
      <DialogTrigger>
        <Button className="numero__origem" aria-label={`De onde vem: ${rotulo}`}>De onde vem</Button>
        <Popover className="balao numero__balao" placement="bottom start">
          <Dialog className="numero__dialogo">
            <Heading slot="title" className="numero__titulo">{rotulo}</Heading>
            <dl className="numero__dados">
              <dt>Fonte</dt><dd>{origem.fonte}</dd>
              {origem.competencia && (<><dt>Competência</dt><dd>{origem.competencia}</dd></>)}
            </dl>
            {origem.limites && origem.limites.length > 0 && (
              <ul className="numero__limites">{origem.limites.map((l) => <li key={l}>{l}</li>)}</ul>
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
    </span>
  );
}
