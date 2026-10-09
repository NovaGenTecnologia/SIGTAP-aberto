import { useEffect, useState } from "react";
import { useDebounce } from "../../../shell/useDebounce";

/** Campo de busca cujo texto mora na rota: grava depois da pausa de digitação e acompanha o Voltar/Avançar. */
export function useBuscaNaRota(daRota: string, gravar: (q: string) => void): [string, (v: string) => void] {
  const [digitado, setDigitado] = useState(daRota);
  const q = useDebounce(digitado, 300);
  useEffect(() => {
    // Voltar/avançar muda a rota por fora: o campo acompanha (o eco da própria digitação já é igual a `q`).
    if (daRota !== q) setDigitado(daRota);
    // só a rota manda aqui
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daRota]);
  useEffect(() => {
    if (q !== daRota) gravar(q);
    // só a pausa de digitação mexe na rota
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return [digitado, setDigitado];
}
