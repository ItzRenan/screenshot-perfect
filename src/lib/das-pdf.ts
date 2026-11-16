import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { interpretarTextoDAS } from "@/lib/das-parser";

GlobalWorkerOptions.workerSrc = pdfWorker;

export { interpretarTextoDAS } from "@/lib/das-parser";
export type { DadosDASExtraidos } from "@/lib/das-parser";

export async function extrairDadosDAS(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data, isEvalSupported: false }).promise;
  try {
    const paginas: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      paginas.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return interpretarTextoDAS(paginas.join(" "));
  } finally {
    await pdf.destroy();
  }
}
