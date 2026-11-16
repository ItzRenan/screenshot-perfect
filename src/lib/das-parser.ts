import { isValidCNPJ } from "@/lib/format";

export type DadosDASExtraidos = {
  cnpj: string | null;
  competencia: string | null;
  valor: string | null;
  vencimento: string | null;
  vencimentoOriginal: string | null;
  textoEncontrado: boolean;
};

function normalizarTexto(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function capturar(texto: string, padroes: RegExp[]): string | null {
  for (const regex of padroes) {
    const match = texto.match(regex);
    if (match?.[1]) return normalizarTexto(match[1]);
  }
  return null;
}

function dataISO(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/(\d{2})[\/. -](\d{2})[\/. -](\d{4})/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  const d = Number(dia), mo = Number(mes), y = Number(ano);
  if (y < 2000 || y > 2099) return null;
  const data = new Date(Date.UTC(y, mo - 1, d));
  if (data.getUTCFullYear() !== y || data.getUTCMonth() !== mo - 1 || data.getUTCDate() !== d) return null;
  return `${ano}-${mes}-${dia}`;
}

function valorBR(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+,[0-9]{2})/);
  return match?.[1] ?? null;
}

export function interpretarTextoDAS(textoBruto: string): DadosDASExtraidos {
  const texto = normalizarTexto(textoBruto);
  const cnpjCandidates = texto.match(/(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})/g) ?? [];
  const cnpj = cnpjCandidates.find((v) => isValidCNPJ(v)) ?? null;

  const competenciaRaw = capturar(texto, [
    /(?:per[ií]odo de apura[cç][aã]o|compet[eê]ncia|per[ií]odo apura[cç][aã]o|PA)\s*[:\-]?\s*(\d{2}\/\d{4})/i,
    /(?:per[ií]odo de apura[cç][aã]o|compet[eê]ncia|PA)[^0-9]{0,30}(\d{2}\/\d{4})/i,
  ]);
  const meses: Record<string, string> = {
    janeiro: "01", fevereiro: "02", março: "03", marco: "03", abril: "04",
    maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09",
    outubro: "10", novembro: "11", dezembro: "12",
  };
  const competenciaExtenso = texto.match(/\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(20\d{2})/i);
  const mesExtenso = competenciaExtenso?.[1]?.toLocaleLowerCase("pt-BR");
  const competenciaPorExtenso = mesExtenso && meses[mesExtenso]
    ? meses[mesExtenso] + "/" + competenciaExtenso[2]
    : null;
  const competenciaCandidata = competenciaPorExtenso ?? competenciaRaw;
  const competencia = competenciaCandidata && /^(0[1-9]|1[0-2])\/20\d{2}$/.test(competenciaCandidata)
    ? competenciaCandidata
    : null;

  const vencimentoOriginalRaw = capturar(texto, [
    /data de vencimento[\\s\\S]{0,160}?(\d{2}\/\d{2}\/\d{4})/i,
    /data de vencimento[\\s\\S]{0,160}?(\d{2}\.\d{2}\.\d{4})/i,
  ]);
  const vencimentoOriginal = dataISO(vencimentoOriginalRaw);
  const dataLimiteRaw = capturar(texto, [
    /pagar este documento até\s*(\d{2}\/\d{2}\/\d{4})/i,
    /pagar este documento até\s*(\d{2}\.\d{2}\.\d{4})/i,
  ]);
  const dataLimitePagamento = dataISO(dataLimiteRaw) ?? vencimentoOriginal;
  const vencimento = dataLimitePagamento;

  const valorRaw = capturar(texto, [
    /(?:valor total do documento|valor total|valor a pagar|valor do DAS|total a recolher)\s*[:\-]?\s*(?:R\$\s*)?([0-9.]+,[0-9]{2})/i,
  ]);
  const valor = valorBR(valorRaw);

  return { cnpj, competencia, valor, vencimento, vencimentoOriginal, textoEncontrado: texto.length > 30 };
}

