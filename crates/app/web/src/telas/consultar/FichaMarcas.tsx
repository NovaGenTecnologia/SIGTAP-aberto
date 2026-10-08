import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Label, TextArea, TextField, ToggleButton } from "react-aria-components";
import { Botao } from "../../componentes/base/Botao";
import { useAvisos } from "../../componentes/base/Avisos";
import type { TipoMarcado } from "../../api/comandos";
import { useAnotar, useFavoritar, useMarcado } from "../../dados/marcados";

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Estrela({ cheia }: { cheia: boolean }) {
  return (
    <svg className="marcas__icone" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8l2.76 5.6 6.18.9-4.47 4.36 1.06 6.15L12 16.9l-5.53 2.91 1.06-6.15L3.06 9.3l6.18-.9z" fill={cheia ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Lapis() {
  return (
    <svg className="marcas__icone" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20l1-4.5L16.5 4a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Favorito do item (procedimento ou CID): grava na hora e avisa se falhar. */
export function BotaoFavorito({ tipo, codigo }: { tipo: TipoMarcado; codigo: string }) {
  const q = useMarcado(tipo, codigo);
  const favoritar = useFavoritar(tipo, codigo);
  const { avisar } = useAvisos();
  const favorito = q.data?.favorito ?? false;
  return (
    <ToggleButton className="marcas__botao" isSelected={favorito} isDisabled={!q.data || favoritar.isPending}
      onChange={(v) => favoritar.mutate(v, { onError: (e) => avisar(`Não foi possível ${v ? "favoritar" : "tirar o favorito"}. ${mensagem(e)}`, "erro") })}>
      <Estrela cheia={favorito} />Favorito
    </ToggleButton>
  );
}

/** Favorito e Anotar, no canto da linha do código e do nome. */
export function AcoesDaFicha({ codigo, anotando, aoAnotar }: { codigo: string; anotando: boolean; aoAnotar: () => void }) {
  return (
    <div className="marcas__acoes">
      <BotaoFavorito tipo="procedimento" codigo={codigo} />
      <button type="button" className="marcas__botao" aria-expanded={anotando} data-selected={anotando || undefined} onClick={aoAnotar}>
        <Lapis />Anotar
      </button>
    </div>
  );
}

/** Anotação recolhida (uma linha com "Editar") ou aberta (campo). Grava ao sair do campo e com Ctrl+Enter. */
export function NotaDaFicha({ codigo, aberta, aoAbrir, aoFechar }: { codigo: string; aberta: boolean; aoAbrir: () => void; aoFechar: () => void }) {
  const q = useMarcado("procedimento", codigo);
  const anotar = useAnotar("procedimento", codigo);
  const { avisar } = useAvisos();
  const salva = q.data?.anotacao ?? "";
  const [texto, setTexto] = useState(salva);
  const [salvo, setSalvo] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  // O campo abre com o que está gravado.
  useEffect(() => { if (aberta) { setTexto(salva); setSalvo(false); campo.current?.focus(); } }, [aberta]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravar = () => {
    const limpo = texto.trim();
    if (limpo === salva.trim()) return;
    anotar.mutate(limpo, {
      onSuccess: () => setSalvo(true),
      onError: (e) => avisar(`Não foi possível salvar a anotação. ${mensagem(e)}`, "erro"),
    });
  };
  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); gravar(); }
    else if (e.key === "Escape") { e.stopPropagation(); gravar(); aoFechar(); }
  };

  if (aberta) {
    return (
      <section className="marcas__nota" aria-label="Anotação">
        <TextField value={texto} onChange={(t) => { setTexto(t); setSalvo(false); }} className="marcas__campo">
          <Label className="marcas__rotulo">Anotação</Label>
          <TextArea ref={campo} rows={2} maxLength={4000} onBlur={gravar} onKeyDown={aoTeclar} className="marcas__texto" />
        </TextField>
        <div className="marcas__rodape">
          <span role="status" className="marcas__estado">{anotar.isPending ? "Salvando" : salvo ? "Salvo" : ""}</span>
          <span className="marcas__dica">Ctrl + Enter salva</span>
        </div>
      </section>
    );
  }
  if (!salva) return null;
  return (
    <div className="marcas__linha">
      <span className="marcas__rotulo">Anotação</span>
      <span className="marcas__resumo" title={salva}>{salva}</span>
      <Botao variante="discreto" onPress={aoAbrir}>Editar</Botao>
    </div>
  );
}
