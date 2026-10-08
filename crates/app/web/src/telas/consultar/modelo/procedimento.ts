// Apresentação curta dos campos de um procedimento na lista (o texto completo continua na ficha).

export function complexidadeCurta(c: string | null): string {
  return c ? c.replace(/\s+Complexidade$/, "") : "—";
}

/** "BPA (Consolidado)", "BPA (Individualizado)" viram "BPA"; sem repetir. */
export function instrumentosCurtos(instrumentos: string[]): string {
  const siglas = [...new Set(instrumentos.map((i) => i.replace(/\s*\(.*$/, "").trim()).filter(Boolean))];
  return siglas.length ? siglas.join(" · ") : "—";
}
