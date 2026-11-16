import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extrairDadosDas } from "./das-parser.js";

const caminho = process.argv[2];
if (!caminho) {
  console.error("Uso: npm run parse:das -- caminho/do/arquivo.pdf");
  process.exit(2);
}

const bytes = new Uint8Array(await readFile(caminho));
const pdf = await getDocument({ data: bytes }).promise;
const paginas = [];

for (let numero = 1; numero <= pdf.numPages; numero += 1) {
  const pagina = await pdf.getPage(numero);
  const conteudo = await pagina.getTextContent();
  paginas.push(conteudo.items.map((item) => ("str" in item ? item.str : "")).join(" "));
}

const resultado = extrairDadosDas(paginas.join("\\n"));
console.log(JSON.stringify(resultado, null, 2));
if (!resultado.valido) process.exitCode = 1;
