import pdf from "pdf-parse";
import { supabase, bucket } from "../lib/supabase.js";
import { parseDasText } from "../lib/pgmei-parser.js";

export async function processImportQueue() {
  const { data: items, error } = await supabase.rpc("claim_mei_import_items", { p_limit: 10 });
  if (error) throw error;
  for (const item of items ?? []) {
    try {
      const { data: file, error: downloadError } = await supabase.storage.from(bucket).download(item.arquivo_path);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = parseDasText((await pdf(buffer)).text);
      const { data: clients, error: clientsError } = await supabase.from("clientes")
        .select("id,cnpj").eq("user_id", item.user_id);
      if (clientsError) throw clientsError;
      const match = (clients ?? []).find(c => (c.cnpj ?? "").replace(/\D/g, "") === parsed.cnpj);
      const status = parsed.needs_review ? "revisao" : match ? "aguardando_aprovacao" : "cliente_nao_identificado";
      const { error: updateError } = await supabase.from("mei_import_itens").update({
        status, cliente_id: match?.id ?? null, extraido_json: parsed, erro: null
      }).eq("id", item.id).eq("status", "lendo");
      if (updateError) throw updateError;
    } catch (err) {
      await supabase.from("mei_import_itens").update({
        status: "erro", erro: String(err?.message ?? err).slice(0, 1000)
      }).eq("id", item.id).eq("status", "lendo");
    }
  }
}
