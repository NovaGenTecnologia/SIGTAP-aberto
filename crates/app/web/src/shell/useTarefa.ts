import { useEffect, useState } from "react";
import { ouvirFimTarefa, ouvirProgresso } from "../api/eventos";
import type { FimTarefa, Progresso } from "../api/tipos";

export function useTarefa(aoTerminar?: (f: FimTarefa) => void) {
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  useEffect(() => {
    let parar1: (() => void) | undefined, parar2: (() => void) | undefined, vivo = true;
    void ouvirProgresso((p) => setProgresso(p)).then((f) => { if (vivo) parar1 = f; else f(); }).catch(() => {});
    void ouvirFimTarefa((f) => { setProgresso(null); aoTerminar?.(f); }).then((f) => { if (vivo) parar2 = f; else f(); }).catch(() => {});
    return () => { vivo = false; parar1?.(); parar2?.(); };
  }, [aoTerminar]);
  return { emAndamento: progresso !== null, progresso };
}
