import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extrairDadosDas } from "./das-parser.js";

export async function parseDasBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError("O conteúdo do DAS deve ser um Buffer ou Uint8Array.");
  }
  if (buffer.byteLength < 5 || Buffer.from(buffer).subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("O arquivo informado não possui assinatura PDF.");
  }

  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const paginas = [];
  for (let numero = 1; numero <= pdf.numPages; numero += 1) {
    const pagina = await pdf.getPage(numero);
    const conteudo = await pagina.getTextContent();
    paginas.push(conteudo.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return extrairDadosDas(paginas.join("\n"));
}

async function main() {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error("Uso: npm run parse:das -- caminho/do/arquivo.pdf");
    process.exit(2);
  }
  const resultado = await parseDasBuffer(await readFile(caminho));
  console.log(JSON.stringify(resultado, null, 2));
  if (!resultado.valido) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  await main();
}
