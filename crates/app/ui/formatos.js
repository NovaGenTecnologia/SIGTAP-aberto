// Formatação para exibição. Funções puras (testadas em scripts/testes_ui.js).
"use strict";

const Formatos = (() => {
  /** Centavos (inteiro) → "1.192,51". */
  function moeda(centavos) {
    if (typeof centavos !== "number" || !Number.isFinite(centavos)) return "";
    const neg = centavos < 0;
    const v = Math.abs(Math.trunc(centavos));
    const inteiro = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const dec = String(v % 100).padStart(2, "0");
    return (neg ? "-" : "") + inteiro + "," + dec;
  }

  /** Centésimos de percentual → "20%" ou "12,5%". */
  function percentual(centesimos) {
    if (typeof centesimos !== "number") return "";
    const v = centesimos / 100;
    return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "").replace(".", ",")) + "%";
  }

  /** Idade em meses → "130 anos", "18 anos e 11 meses", "6 meses", "0 meses". */
  function idade(meses) {
    if (typeof meses !== "number") return "";
    const a = Math.floor(meses / 12), m = meses % 12;
    const pa = a === 1 ? "1 ano" : `${a} anos`;
    const pm = m === 1 ? "1 mês" : `${m} meses`;
    if (a === 0) return pm;
    return m === 0 ? pa : `${pa} e ${pm}`;
  }

  /** Inteiro com separador de milhar. */
  function inteiro(n) {
    return typeof n === "number" ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : String(n ?? "");
  }

  /** AAAAMM → MM/AAAA. */
  function competencia(c) {
    return c && c.length === 6 ? `${c.slice(4)}/${c.slice(0, 4)}` : c || "";
  }

  /** Código de 10 dígitos → GG.SS.FF.PPP-D. */
  function mascara(c) {
    return /^\d{10}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}.${c.slice(6, 9)}-${c[9]}` : c;
  }

  /** Texto de um campo da ficha (valor oficial + regra de exibição). */
  function campo(c) {
    if (!c) return "";
    if (c.sentinela) return c.sentinela;
    if (c.unidade === "centavos") return moeda(c.valor);
    if (c.unidade === "centesimos_de_percentual") return percentual(c.valor);
    if (c.unidade === "meses") return idade(c.valor);
    if (c.descricao && c.situacao === "oficial") return c.descricao;
    if (typeof c.valor === "number") return inteiro(c.valor);
    return c.valor ?? "";
  }

  /** Bytes em MB (ou GB) com vírgula decimal: 19800000 → "19,8 MB". */
  function mb(bytes) {
    const n = Number(bytes) || 0;
    const [v, u] = n >= 1e9 ? [n / 1e9, "GB"] : [n / 1e6, "MB"];
    return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${u}`;
  }

  /** Nota com o valor como está no arquivo oficial, quando a exibição o converte. */
  function notaOficial(c) {
    if (!c) return "";
    if (c.sentinela) return `${c.valor} no arquivo oficial${c.sentinela_inferida ? " (significado inferido: a coluna não está no leiaute)" : ""}`;
    if (c.unidade === "meses") return `${inteiro(c.valor)} meses no arquivo oficial`;
    if (c.situacao === "oficial") return `código ${c.valor}`;
    if (c.situacao === "sem_descricao") return `código ${c.valor}: ${c.descricao}`;
    if (c.situacao === "desconhecido") return `código ${c.valor} sem descrição no leiaute oficial`;
    return "";
  }

  return { moeda, percentual, idade, inteiro, competencia, mascara, campo, notaOficial, mb };
})();

if (typeof module !== "undefined") module.exports = Formatos;
