import { supabase } from "@/integrations/supabase/client";

export const BUCKET_BOLETOS = "boletos-mei";

function nomeArquivo(cliente: string, competencia: string): string {
  const slug = cliente
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `DAS-${slug || "cliente"}-${competencia.replace("/", "-")}.pdf`;
}

/** Gera um link temporário (60s) e só funciona para o usuário logado dono do arquivo. */
async function linkAssinado(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_BOLETOS)
    .createSignedUrl(path, 60, download ? { download } : undefined);
  if (error || !data) throw new Error("Não foi possível acessar o PDF. Verifique se o arquivo ainda existe.");
  return data.signedUrl;
}

/** Abre o PDF em nova aba. A aba é aberta antes da espera para não ser bloqueada pelo navegador. */
export async function visualizarPdf(path: string): Promise<void> {
  const aba = window.open("about:blank", "_blank");
  try {
    const url = await linkAssinado(path);
    if (aba) aba.location.href = url;
    else window.location.href = url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}

export async function baixarPdf(path: string, cliente: string, competencia: string): Promise<void> {
  const url = await linkAssinado(path, nomeArquivo(cliente, competencia));
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Confere se o arquivo é realmente um PDF (assinatura %PDF). */
export async function ehPdf(file: File): Promise<boolean> {
  const head = await file.slice(0, 5).text();
  return head.startsWith("%PDF");
}
