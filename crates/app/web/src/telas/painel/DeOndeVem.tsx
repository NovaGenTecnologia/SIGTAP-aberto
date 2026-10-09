import { Button, Dialog, DialogTrigger, Heading, Popover } from "react-aria-components";

export interface LinhaDeOrigem { rotulo: string; texto: string }

/** "De onde vem": balão com a fonte, a conta e o que o número não prova. Esc fecha e devolve o foco ao botão. */
export function DeOndeVem({ titulo, linhas }: { titulo: string; linhas: LinhaDeOrigem[] }) {
  return (
    <DialogTrigger>
      <Button className="painel__origem" aria-label={`De onde vem: ${titulo}`}>De onde vem</Button>
      <Popover className="balao painel__balao" placement="bottom end">
        <Dialog className="painel__dialogo">
          <Heading slot="title" className="painel__dialogo-titulo">{titulo}</Heading>
          <dl className="painel__dados">
            {linhas.filter((l) => l.texto).map((l) => (
              <div key={l.rotulo} className="painel__dado"><dt>{l.rotulo}</dt><dd>{l.texto}</dd></div>
            ))}
          </dl>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
