const MESES = {
  janeiro: "01", fevereiro: "02", marco: "03", março: "03", abril: "04",
  maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09",
  outubro: "10", novembro: "11", dezembro: "12",
};

function compactar(texto) {
  return texto.normalize("NFC").replace(/[\u00a0\t]+/g, " ").replace(/ +/g, " ").replace(/\s*\n\s*/g, " ").trim();
}
function normalizarCnpj(valor) { return String(valor ?? "").replace(/\D/g, ""); }
function valorEmCentavos(valor) {
  if (!valor) return null;
  const numero = Number(valor.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

export function extrairDadosDas(textoPdf) {
  const texto = compactar(textoPdf);
  const cnpjMatch = texto.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/);
  const periodoMatch = texto.match(/\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(\d{4})\b/i);
  const vencimentoMatch = texto.match(/Pagar este documento até\s+(\d{2}\/\d{2}\/\d{4})/i) || texto.match(/Data de Vencimento\s+(\d{2}\/\d{2}\/\d{4})/i);
  const valorMatch = texto.match(/Valor Total do Documento\s+(\d{1,3}(?:\.\d{3})*,\d{2})/i) || texto.match(/\bValor:\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const mesNome = periodoMatch?.[1]?.toLocaleLowerCase("pt-BR");
  const mes = mesNome ? MESES[mesNome] : null;
  const competencia = mes && periodoMatch?.[2] ? mes + "/" + periodoMatch[2] : null;
  const cnpj = cnpjMatch ? normalizarCnpj(cnpjMatch[1]) : null;
  const vencimento = vencimentoMatch?.[1] ? vencimentoMatch[1].split("/").reverse().join("-") : null;
  const valorCentavos = valorEmCentavos(valorMatch?.[1]);
  const ausentes = [];
  if (!cnpj) ausentes.push("CNPJ");
  if (!competencia) ausentes.push("período de apuração");
  if (!vencimento) ausentes.push("vencimento");
  if (valorCentavos == null) ausentes.push("valor total");
  return { cnpj, competencia, vencimento, valor_centavos: valorCentavos, valido: ausentes.length === 0, campos_ausentes: ausentes };
}

export function validarCorrespondenciaDas(dados, cnpjEsperado, competenciaEsperada) {
  const esperado = normalizarCnpj(cnpjEsperado);
  if (!/^\d{14}$/.test(esperado)) throw new Error("CNPJ esperado inválido.");
  if (!dados.cnpj) throw new Error("O PDF não contém CNPJ identificável.");
  if (dados.cnpj !== esperado) throw new Error("O CNPJ do PDF (" + dados.cnpj + ") não corresponde ao cliente selecionado.");
  if (competenciaEsperada && dados.competencia !== competenciaEsperada) {
    throw new Error("A competência do PDF (" + (dados.competencia ?? "não identificada") + ") não corresponde à solicitada (" + competenciaEsperada + ").");
  }
  if (!dados.valido) throw new Error("Não foi possível identificar: " + dados.campos_ausentes.join(", ") + ".");
  return true;
}
