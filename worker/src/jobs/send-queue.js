import { supabase, bucket } from "../lib/supabase.js";

async function sendDocument({ phone, name, competence, amount, due, fileUrl }) {
  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const endpoint = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp", to: phone, type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR" },
      components: [
        { type: "header", parameters: [{ type: "document", document: { link: fileUrl, filename: `DAS-MEI-${competence.replace("/", "-")}.pdf` } }] },
        { type: "body", parameters: [
          { type: "text", text: name }, { type: "text", text: competence },
          { type: "text", text: amount }, { type: "text", text: due }
        ] }
      ]
    }
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `WhatsApp API ${response.status}`);
  return data.messages?.[0]?.id ?? null;
}

export async function processApprovedSends() {
  const { data: claimed, error } = await supabase.rpc("claim_mei_approved_sends", { p_limit: 10 });
  if (error) throw error;
  for (const send of claimed ?? []) {
    try {
      const { data: full, error: readError } = await supabase.from("envios")
        .select("id,boleto_id,user_id,status,boletos(id,competencia,valor,vencimento,arquivo_path,clientes(nome,telefone))")
        .eq("id", send.id).single();
      if (readError) throw readError;
      const boleto = full.boletos;
      const client = boleto?.clientes;
      if (!boleto?.arquivo_path || !client?.telefone) throw new Error("Dados do boleto ou telefone do cliente incompletos.");
      const ttl = Math.max(120, Math.min(Number(process.env.SIGNED_URL_TTL_SECONDS || 600), 3600));
      const { data: signed, error: urlError } = await supabase.storage.from(bucket).createSignedUrl(boleto.arquivo_path, ttl);
      if (urlError) throw urlError;
      let phone = client.telefone.replace(/\D/g, "");
      if (!phone.startsWith("55")) phone = `55${phone}`;
      const messageId = await sendDocument({
        phone, name: client.nome, competence: boleto.competencia,
        amount: Number(boleto.valor).toFixed(2).replace(".", ","),
        due: new Date(`${boleto.vencimento}T12:00:00Z`).toLocaleDateString("pt-BR"),
        fileUrl: signed.signedUrl
      });
      const { error: updateError } = await supabase.from("envios").update({
        status: "enviado", enviado_em: new Date().toISOString(),
        whatsapp_message_id: messageId, erro: null
      }).eq("id", send.id).eq("status", "processando");
      if (updateError) throw updateError;
    } catch (err) {
      await supabase.from("envios").update({
        status: "falha", erro: String(err?.message ?? err).slice(0, 1000)
      }).eq("id", send.id).eq("status", "processando");
    }
  }
}
