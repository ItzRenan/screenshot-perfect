const moneyToNumber = (s) => Number(s.replace(/\./g, "").replace(",", "."));
export function parseDasText(text) {
  const normalized = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const cnpj = normalized.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)?.[0];
  const competence = normalized.match(/(?:PA|Per[ií]odo de Apura[cç][aã]o|Compet[eê]ncia)[^\d]{0,30}(\d{2})\/(\d{4})/i);
  const due = normalized.match(/(?:Pagar\s+até|Data\s+de\s+vencimento)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const amount = normalized.match(/(?:Valor\s+Total\s+do\s+Documento|Total\s+a\s+Pagar|Valor\s+total)[^\d]{0,30}([\d.]+,\d{2})/i);
  const result = {
    cnpj: cnpj?.replace(/\D/g, "") || null,
    competencia: competence ? `${competence[1]}/${competence[2]}` : null,
    vencimento: due ? due[1].split("/").reverse().join("-") : null,
    valor: amount ? moneyToNumber(amount[1]) : null
  };
  const missing = Object.entries(result).filter(([k,v]) => v == null || v === 0).map(([k]) => k);
  return { ...result, needs_review: missing.length > 0, missing_fields: missing };
}
