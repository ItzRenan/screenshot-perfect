import crypto from "node:crypto";

export function formatCNPJ(digits) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function isCompetenciaValida(value) {
  return /^(0[1-9]|1[0-2])\/20\d{2}$/.test(value);
}

export function isAuthorizedToken(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const candidate = Buffer.from(provided);
  const secret = Buffer.from(expected);
  return candidate.length === secret.length && crypto.timingSafeEqual(candidate, secret);
}
