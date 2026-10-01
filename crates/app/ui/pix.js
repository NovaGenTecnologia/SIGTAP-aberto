"use strict";
// Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central). Só monta texto: nada sai do computador.
const Pix = (() => {
  const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").toUpperCase().trim();
  const campo = (id, valor) => id + String(valor.length).padStart(2, "0") + valor;
  function crc16(texto) { // CRC16/CCITT-FALSE: polinômio 0x1021, inicial 0xFFFF
    let crc = 0xffff;
    for (let i = 0; i < texto.length; i++) {
      crc ^= texto.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }
  // Sem valor: quem paga digita quanto quer. O nome e a cidade são só informativos; o banco mostra o titular da chave.
  function payload(chave, nome, cidade) {
    const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave);
    const base = campo("00", "01") + campo("01", "11") + campo("26", conta) + campo("52", "0000") + campo("53", "986")
      + campo("58", "BR") + campo("59", semAcento(nome || "SIGTAP ABERTO").slice(0, 25) || "SIGTAP ABERTO")
      + campo("60", semAcento(cidade || "BRASIL").slice(0, 15) || "BRASIL") + campo("62", campo("05", "***")) + "6304";
    return base + crc16(base);
  }
  return { payload, crc16 };
})();
if (typeof module !== "undefined") module.exports = Pix;
