import { onlyDigits } from "./format";

export const MENSAGEM_PADRAO =
  "Olá, {cliente}! Segue em anexo o boleto DAS referente à competência {competencia}, no valor de {valor}, com vencimento em {vencimento}. Qualquer dúvida, estou à disposição.\n\n{escritorio}";

export const VARIAVEIS_MENSAGEM = ["{cliente}", "{competencia}", "{valor}", "{vencimento}", "{escritorio}"] as const;

export type DadosMensagem = {
  cliente: string;
  competencia: string;
  valor: string;
  vencimento: string;
  escritorio: string;
};

/** Substitui as variáveis da mensagem pelos dados do boleto. */
export function preencherMensagem(modelo: string, dados: DadosMensagem): string {
  return modelo
    .replace(/\{cliente\}/g, dados.cliente)
    .replace(/\{competencia\}/g, dados.competencia)
    .replace(/\{valor\}/g, dados.valor)
    .replace(/\{vencimento\}/g, dados.vencimento)
    .replace(/\{escritorio\}/g, dados.escritorio)
    .trim();
}

/** Número no formato internacional do Brasil (55 + DDD + número). */
export function telefoneInternacional(telefone: string): string {
  const d = onlyDigits(telefone);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  return `55${d}`;
}

/** Link que abre a conversa no WhatsApp com a mensagem pronta (envio feito manualmente). */
export function linkWhatsApp(telefone: string, mensagem: string, destino: "app" | "web"): string {
  const numero = telefoneInternacional(telefone);
  const texto = encodeURIComponent(mensagem);
  return destino === "web"
    ? `https://web.whatsapp.com/send?phone=${numero}&text=${texto}`
    : `https://wa.me/${numero}?text=${texto}`;
}
