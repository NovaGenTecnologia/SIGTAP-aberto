import { useEffect, useState } from "react";

/** Conta segundos enquanto `ativo`. `contador` liga em 2 s e `aviso` em 8 s; desativar zera. */
export function useEspera(ativo: boolean): { segundos: number; contador: boolean; aviso: boolean } {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (!ativo) { setSegundos(0); return; }
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return { segundos, contador: ativo && segundos >= 2, aviso: ativo && segundos >= 8 };
}
