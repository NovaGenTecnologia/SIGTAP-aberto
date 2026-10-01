"use strict";
// Gera, uma vez, o QR Code do Pix e o "copia e cola" que o programa mostra no "Sobre".
// Só é preciso rodar de novo se a chave Pix, o nome ou a cidade mudarem. Nada disto vai no .exe além dos resultados.
//   npm install --no-save qrcode-generator      (ferramenta de desenvolvimento, MIT; não é dependência do programa)
//   node scripts/dev/gerar_qr_pix.js "<chave>" "<nome do recebedor>" "<cidade>"
const fs = require("fs"), path = require("path");
const qrcode = require("qrcode-generator"), Pix = require("./pix_payload.js");
const [chave, nome = "", cidade = ""] = process.argv.slice(2);
if (!chave) { console.error('uso: node scripts/dev/gerar_qr_pix.js "<chave>" "<nome>" "<cidade>"'); process.exit(1); }
const ui = path.join(__dirname, "..", "..", "crates", "app", "ui");
const codigo = Pix.payload(chave, nome, cidade);
const qr = qrcode(0, "M"); qr.addData(codigo, "Byte"); qr.make();
const n = qr.getModuleCount(), m = 4; let d = "";
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
const t = n + 2 * m;
fs.writeFileSync(path.join(ui, "pix-qr.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>\n`);
const ap = path.join(ui, "apoio.js"); let s = fs.readFileSync(ap, "utf8");
s = s.replace(/pixCopiaECola: ".*?",/, `pixCopiaECola: "${codigo}",`);
fs.writeFileSync(ap, s);
console.log("pix-qr.svg e apoio.js atualizados.\n" + codigo);
