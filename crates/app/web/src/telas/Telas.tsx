import { lazy, Suspense } from "react";
import { useRota } from "../shell/rotas";
import { Conferir } from "./Conferir";
import { Consultar } from "./Consultar";
import { Dados } from "./Dados";
import { Mudancas } from "./Mudancas";
import { Painel } from "./Painel";

const Galeria = import.meta.env.DEV || import.meta.env.VITE_GALERIA === "1"
  ? lazy(() => import("../galeria/Galeria").then((m) => ({ default: m.Galeria })))
  : null;

export function Telas() {
  const { destino } = useRota();
  switch (destino) {
    case "consultar": return <Consultar />;
    case "mudancas": return <Mudancas />;
    case "conferir": return <Conferir />;
    case "dados": return <Dados />;
    case "galeria": return Galeria ? <Suspense fallback={null}><Galeria /></Suspense> : <Painel />;
    default: return <Painel />;
  }
}
