import { interpretarTextoDAS } from "@/lib/das-parser";

export { interpretarTextoDAS } from "@/lib/das-parser";
export type { DadosDASExtraidos } from "@/lib/das-parser";

export async function extrairDadosDAS(file: File) {
  // Carrega o PDF.js e o worker somente no navegador, quando um PDF for selecionado.
  const [{ GlobalWorkerOptions, getDocument }, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;

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
