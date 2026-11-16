import { createHmac, timingSafeEqual } from "node:crypto";
import { supabase } from "../lib/supabase.js";

export function validMetaSignature(rawBody, signature) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex"));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function handleWhatsAppWebhook(body) {
  for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
    for (const status of change.value?.statuses ?? []) {
      const map = { sent: "enviado", delivered: "entregue", read: "lido", failed: "falha" };
      const next = map[status.status];
      if (!next) continue;
      const patch = { status: next };
      if (status.status === "delivered") patch.entregue_em = new Date(Number(status.timestamp) * 1000).toISOString();
      if (status.status === "read") patch.lido_em = new Date(Number(status.timestamp) * 1000).toISOString();
      if (status.status === "failed") patch.erro = JSON.stringify(status.errors ?? []).slice(0, 1000);
      const { error } = await supabase.from("envios").update(patch).eq("whatsapp_message_id", status.id);
      if (error) throw error;
    }
  }
}
