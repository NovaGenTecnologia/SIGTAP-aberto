import { useEffect, useState } from "react";

const MINIMA = 420;
const RESERVADA = 360; // topo, cabeçalho da tela, abas, barra de ações e rodapé

const calcular = () => Math.max(MINIMA, window.innerHeight - RESERVADA);

/** A altura que a tabela de Dados pode ocupar: acompanha a janela, sem ficar menor que um mínimo legível. */
export function useAlturaMaxima(): number {
  const [altura, setAltura] = useState(calcular);
  useEffect(() => {
    const aoRedimensionar = () => setAltura(calcular());
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);
  return altura;
}
