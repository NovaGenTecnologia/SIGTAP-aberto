import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { buscar } from "../api/comandos";
import { Dialogo } from "../componentes/base/Dialogo";
import { DESTINOS, ir } from "./rotas";
import { useSessao } from "./sessao";
import { useDebounce } from "./useDebounce";

interface Opcao { id: string; rotulo: string; grupo: "Ir para" | "Procedimentos"; aoEscolher: () => void }

export function PaletaDeBusca({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const [texto, setTexto] = useState("");
  const [ativa, setAtiva] = useState(0);
  const termo = useDebounce(texto.trim(), 200);
  const { competencia } = useSessao();
  const idLista = useId();

  useEffect(() => { if (aberta) { setTexto(""); setAtiva(0); } }, [aberta]);

  const achados = useQuery({
    queryKey: ["buscar", competencia, termo],
    queryFn: () => buscar(termo, competencia ?? undefined),
    enabled: aberta && termo.length >= 2,
  });

  const destinos: Opcao[] = DESTINOS
    .filter((d) => texto.trim() === "" || d.rotulo.toLowerCase().includes(texto.trim().toLowerCase()))
    .map((d) => ({ id: `d-${d.id}`, rotulo: d.rotulo, grupo: "Ir para", aoEscolher: () => { ir(d.id); aoFechar(); } }));
  const procedimentos: Opcao[] = (achados.data?.procedimentos ?? []).slice(0, 8).map((p) => ({
    id: `p-${p.codigo}`, rotulo: `${p.codigo_mascarado} ${p.nome}`, grupo: "Procedimentos",
    aoEscolher: () => { ir("consultar", p.codigo); aoFechar(); },
  }));
  const opcoes = [...procedimentos, ...destinos];

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAtiva((i) => Math.min(i + 1, opcoes.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtiva((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); opcoes[ativa]?.aoEscolher(); }
  }

  return (
    <Dialogo titulo="Buscar" aberto={aberta} aoFechar={aoFechar}>
      <div className="paleta">
        <input autoFocus role="combobox" aria-label="Buscar" aria-expanded="true" aria-controls={idLista}
          aria-activedescendant={opcoes[ativa] ? `${idLista}-${opcoes[ativa]!.id}` : undefined} aria-autocomplete="list"
          className="paleta__campo" placeholder="Código, nome, CID, CBO ou habilitação"
          value={texto} onChange={(e) => { setTexto(e.target.value); setAtiva(0); }} onKeyDown={aoTeclar} />
        <ul id={idLista} role="listbox" aria-label="Resultados" className="paleta__lista">
          {opcoes.map((o, i) => (
            <li key={o.id} id={`${idLista}-${o.id}`} role="option" aria-selected={i === ativa} className="paleta__opcao"
              data-ativa={i === ativa || undefined} onMouseEnter={() => setAtiva(i)} onClick={o.aoEscolher}>
              <span className="paleta__grupo">{o.grupo}</span>{o.rotulo}
            </li>
          ))}
        </ul>
        {achados.isError && <p role="alert" className="paleta__erro">{(achados.error as Error).message}</p>}
      </div>
    </Dialogo>
  );
}
