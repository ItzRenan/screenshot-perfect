import { createClient } from "@supabase/supabase-js";
import { normalizarCnpj, normalizarCompetencia } from "./pgmei-flow.js";
import { validarCorrespondenciaDas } from "./das-parser.js";

const BUCKET = "boletos-mei";

export function createWorkerSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente do worker.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function enfileirarJob({ supabase, userId, clienteId, competencia }) {
  if (!supabase) throw new Error("Cliente Supabase não informado.");
  if (!userId || !clienteId) throw new Error("Usuário e cliente são obrigatórios.");
  normalizarCompetencia(competencia);

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id, user_id, cnpj")
    .eq("id", clienteId)
    .eq("user_id", userId)
    .single();

  if (clienteError || !cliente) throw new Error("Cliente não encontrado para este usuário.");
  normalizarCnpj(cliente.cnpj);

  const { data, error } = await supabase
    .from("mei_jobs")
    .insert({ user_id: userId, cliente_id: clienteId, competencia, status: "pending" })
    .select("id, user_id, cliente_id, competencia, status, created_at")
    .single();

  if (error) throw new Error("Não foi possível criar o job MEI: " + error.message);
  return data;
}

export async function reivindicarProximoJob(supabase) {
  const { data, error } = await supabase.rpc("claim_mei_job");
  if (error) throw new Error("Falha ao reivindicar job MEI: " + error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function obterClienteDoJob(supabase, job) {
  if (!job?.cliente_id || !job?.user_id) throw new Error("Job sem vínculo de cliente/usuário.");
  const { data, error } = await supabase
    .from("clientes")
    .select("id, user_id, cnpj, nome")
    .eq("id", job.cliente_id)
    .eq("user_id", job.user_id)
    .single();

  if (error || !data) throw new Error("O cliente do job não existe ou não pertence ao usuário.");
  return { ...data, cnpj: normalizarCnpj(data.cnpj) };
}

export async function concluirJobComDas({ supabase, job, cliente, pdfBuffer, dadosDas }) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Arquivo recebido não é um PDF válido.");
  }
  const competencia = normalizarCompetencia(job.competencia);
  validarCorrespondenciaDas(dadosDas, cliente.cnpj, competencia.mes + "/" + competencia.ano);

  const storagePath = job.user_id + "/" + job.id + "/DAS_" +
    cliente.cnpj + "_" + competencia.chave + ".pdf";

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) throw new Error("Falha ao armazenar PDF no bucket privado: " + uploadError.message);

  const { data, error } = await supabase.rpc("complete_mei_job", {
    p_job_id: job.id,
    p_storage_path: storagePath,
    p_pdf_cnpj: dadosDas.cnpj,
    p_pdf_competencia: dadosDas.competencia,
    p_valor: dadosDas.valor_centavos / 100,
    p_vencimento: dadosDas.vencimento,
  });

  if (error) {
    // Best-effort cleanup: never leave a PDF orphaned after DB finalization fails.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw new Error("Falha ao finalizar job e registrar boleto: " + error.message);
  }

  return { boletoId: data, storagePath };
}

export async function marcarJobPago(supabase, jobId, mensagem) {
  const { error } = await supabase
    .from("mei_jobs")
    .update({
      status: "paid",
      error_message: null,
      locked_at: null,
      completed_at: new Date().toISOString(),
      result: { mensagem: String(mensagem ?? "PGMEI informou que a competência já está paga.") },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "processing");

  if (error) throw new Error("Falha ao marcar job como pago: " + error.message);
}

export async function falharJob(supabase, jobId, erro, retry = true) {
  const { data, error } = await supabase.rpc("fail_mei_job", {
    p_job_id: jobId,
    p_error: String(erro?.message ?? erro ?? "Falha não especificada"),
    p_retry: retry,
  });
  if (error) throw new Error("Falha ao registrar erro do job: " + error.message);
  return data;
}

export async function gerarUrlDownload(supabase, storagePath, expiresIn = 60) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error("Não foi possível gerar URL temporária do PDF: " + error.message);
  return data.signedUrl;
}
