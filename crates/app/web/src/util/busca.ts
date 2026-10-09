/** Minúsculas e sem acento, para filtrar listas por texto. */
export const semAcento = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** `texto` contém `busca`, sem diferenciar maiúscula nem acento; busca vazia casa com tudo. */
export const contem = (texto: string, busca: string): boolean => {
  const b = semAcento(busca).trim();
  return b === "" || semAcento(texto).includes(b);
};
