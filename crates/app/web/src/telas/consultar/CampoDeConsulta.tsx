import { Fragment, useId, useRef, useState } from "react";
import { useMarcados } from "../../dados/marcados";
import { usePesquisasRecentes } from "../../dados/pesquisasRecentes";
import { mascararProcedimento } from "../../util/campos";

const MAX_FAVORITOS = 3;

interface Sugestao { id: string; tipo: "recente" | "favorito"; texto: string; codigo?: string }

export interface CampoDeConsultaProps {
  valor: string;
  aoMudar: (texto: string) => void;
  aoEscolherRecente: (texto: string) => void;
  aoAbrirFavorito: (codigo: string) => void;
  /** Enter com a lista fechada: a pessoa terminou de escrever. */
  aoEnviar?: (texto: string) => void;
  autoFoco?: boolean;
}

function Estrela() {
  return (
    <svg className="sugestoes__icone" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8l2.76 5.6 6.18.9-4.47 4.36 1.06 6.15L12 16.9l-5.53 2.91 1.06-6.15L3.06 9.3l6.18-.9z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Relogio() {
  return (
    <svg className="sugestoes__icone" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * O campo único de Consultar. Vazio, ao receber o foco, oferece as pesquisas recentes e os favoritos
 * (combobox: o foco fica no campo e a opção ativa vai em `aria-activedescendant`). Sem animação:
 * é uma ação de teclado repetida o dia todo.
 */
export function CampoDeConsulta({ valor, aoMudar, aoEscolherRecente, aoAbrirFavorito, aoEnviar, autoFoco }: CampoDeConsultaProps) {
  const idBase = useId();
  const idLista = `${idBase}-lista`;
  const campo = useRef<HTMLInputElement>(null);
  const [aberta, setAberta] = useState(false);
  const [ativa, setAtiva] = useState(0);
  const { itens: recentes, limpar } = usePesquisasRecentes();
  const favoritos = (useMarcados("procedimento").data ?? []).filter((i) => i.favorito && i.existe).slice(0, MAX_FAVORITOS);

  const sugestoes: Sugestao[] = [
    ...recentes.map((t, i): Sugestao => ({ id: `${idBase}-r${i}`, tipo: "recente", texto: t })),
    ...favoritos.map((f): Sugestao => ({ id: `${idBase}-f${f.codigo}`, tipo: "favorito", texto: f.nome, codigo: f.codigo })),
  ];
  const mostrar = aberta && valor === "" && sugestoes.length > 0;
  const ativaValida = Math.min(ativa, Math.max(sugestoes.length - 1, 0));
  const opcaoAtiva = mostrar ? sugestoes[ativaValida] : undefined;

  function abrir() {
    setAtiva(0);
    setAberta(true);
  }

  function escolher(s: Sugestao) {
    setAberta(false);
    if (s.tipo === "recente") aoEscolherRecente(s.texto);
    else if (s.codigo) aoAbrirFavorito(s.codigo);
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (valor !== "" || sugestoes.length === 0) return;
      e.preventDefault();
      if (!mostrar) { abrir(); return; }
      setAtiva(e.key === "ArrowDown" ? Math.min(ativaValida + 1, sugestoes.length - 1) : Math.max(ativaValida - 1, 0));
    } else if (e.key === "Enter") {
      if (opcaoAtiva) { e.preventDefault(); escolher(opcaoAtiva); }
      else if (valor.trim()) { e.preventDefault(); aoEnviar?.(valor.trim()); }
    } else if (e.key === "Escape" && mostrar) {
      e.preventDefault();
      e.stopPropagation();
      setAberta(false);
    } else if (e.key === "Escape" && valor !== "") {
      e.preventDefault();
      e.stopPropagation();
      aoMudar("");
    }
  }

  return (
    <div className="consulta-campo">
      <div className="consulta-campo__linha">
        <input ref={campo} type="text" role="combobox" aria-label="Buscar" aria-autocomplete="list" aria-haspopup="listbox"
          aria-expanded={mostrar} aria-controls={mostrar ? idLista : undefined} aria-activedescendant={opcaoAtiva?.id}
          className="campo__entrada consulta-campo__entrada" placeholder="Código, nome do procedimento ou CID" autoComplete="off" spellCheck={false}
          autoFocus={autoFoco} value={valor}
          onChange={(e) => { aoMudar(e.target.value); setAtiva(0); setAberta(e.target.value === ""); }}
          onFocus={(e) => { if (e.target.value === "") abrir(); }}
          onClick={(e) => { if ((e.target as HTMLInputElement).value === "" && !mostrar) abrir(); }}
          onBlur={() => setAberta(false)}
          onKeyDown={aoTeclar} />
        {valor !== "" && (
          <button type="button" className="campo__limpar consulta-campo__limpar" aria-label="Limpar busca"
            onClick={() => { aoMudar(""); campo.current?.focus(); abrir(); }}>×</button>
        )}
      </div>
      {mostrar && (
        // mouseDown não tira o foco do campo: o clique na opção chega ao botão/linha com o campo ainda focado.
        <div className="sugestoes" onMouseDown={(e) => e.preventDefault()}>
          {recentes.length > 0 && (
            <button type="button" className="sugestoes__limpar" onClick={() => { limpar(); campo.current?.focus(); }}>Limpar histórico</button>
          )}
          <ul id={idLista} role="listbox" aria-label="Sugestões" className="sugestoes__lista">
            {recentes.length > 0 && <li role="presentation" className="sugestoes__grupo">Pesquisas recentes</li>}
            {sugestoes.map((s, i) => (
              <Fragment key={s.id}>
                {s.tipo === "favorito" && i === recentes.length && <li role="presentation" className="sugestoes__grupo">Favoritos</li>}
                <li id={s.id} role="option" aria-selected={i === ativaValida} data-ativa={i === ativaValida || undefined}
                  className={`sugestoes__opcao sugestoes__opcao--${s.tipo}`} onMouseEnter={() => setAtiva(i)} onClick={() => escolher(s)}>
                  {s.tipo === "recente" ? <Relogio /> : <Estrela />}
                  {s.tipo === "favorito" && <span className="num sugestoes__codigo">{mascararProcedimento(s.codigo ?? "")}</span>}
                  <span className="sugestoes__texto">{s.texto}</span>
                </li>
              </Fragment>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
