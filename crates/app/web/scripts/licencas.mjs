import { init } from "license-checker-rseidelsohn";

const PERMITIDAS = new Set([
  "MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "BlueOak-1.0.0",
  "OFL-1.1", "Python-2.0", "CC-BY-4.0", "Unlicense",
]);

init({ start: process.cwd(), production: true, excludePrivatePackages: true }, (erro, pacotes) => {
  if (erro) { console.error(erro); process.exit(2); }
  const fora = [];
  for (const [nome, info] of Object.entries(pacotes)) {
    const licencas = String(info.licenses).replace(/[()*]/g, "").split(/\s+(?:OR|AND)\s+/);
    if (!licencas.some((l) => PERMITIDAS.has(l))) fora.push(`${nome}: ${info.licenses}`);
  }
  if (fora.length) { console.error("Licenças fora da lista permitida:\n" + fora.join("\n")); process.exit(1); }
  console.log(`${Object.keys(pacotes).length} pacotes de produção conferidos; todos com licença compatível com a AGPL-3.0.`);
});
