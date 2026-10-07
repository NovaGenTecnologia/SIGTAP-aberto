import { useEffect, useState } from "react";
import type { CompetenciaInfo } from "../api/tipos";
import { Botao } from "../componentes/base/Botao";
import { Menu } from "../componentes/base/Menu";
import { Sobre } from "../telas/Sobre";
import { PaletaDeBusca } from "./PaletaDeBusca";
import { SeletorDeCompetencia } from "./SeletorDeCompetencia";
import { TrocaDeUnidade } from "./TrocaDeUnidade";

export function Topo({ competencias, bloqueado }: { competencias: CompetenciaInfo[]; bloqueado: boolean }) {
  const [paleta, setPaleta] = useState(false);
  const [sobre, setSobre] = useState(false);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !bloqueado) { e.preventDefault(); setPaleta(true); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [bloqueado]);
  return (
    <header className="topo">
      <div className="topo__marca"><strong>SIGTAP</strong> Aberto</div>
      <TrocaDeUnidade desativado={bloqueado} />
      <div className="topo__espaco" />
      <Botao onPress={() => setPaleta(true)} isDisabled={bloqueado}>
        Buscar <kbd className="topo__atalho">Ctrl K</kbd>
      </Botao>
      <SeletorDeCompetencia competencias={competencias} desativado={bloqueado} />
      <Menu rotulo="Mais" itens={[{ id: "sobre", rotulo: "Sobre" }]} aoEscolher={(id) => { if (id === "sobre") setSobre(true); }}>Mais</Menu>
      <Sobre aberto={sobre} aoFechar={() => setSobre(false)} />
      <PaletaDeBusca aberta={paleta} aoFechar={() => setPaleta(false)} />
    </header>
  );
}
