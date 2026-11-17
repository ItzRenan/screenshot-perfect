import express from "express";
import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import {
  createWorkerSupabaseClient,
  enfileirarJob,
  reivindicarProximoJob,
  obterClienteDoJob,
  concluirJobComPdf,
  marcarJobPago,
  falharJob,
  gerarUrlDownload,
} from "./supabase-queue.js";
import { iniciarIdentificacaoPgmei, continuarConsultaPgmei } from "./pgmei-flow.js";

const app = express();
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const PROFILE_ROOT = process.env.PROFILE_DIR || "/app/chrome-profile";
const POLL_MS = Number(process.env.POLL_MS || 3000);
const supabase = createWorkerSupabaseClient();
const sessions = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validJobId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}
let stopping = false;
let polling = false;

if (!API_TOKEN || API_TOKEN.length < 32) {
  throw new Error("Configure API_TOKEN com pelo menos 32 caracteres.");
}

function auth(req, res, next) {
  const supplied = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const providedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(API_TOKEN);
  if (providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}

async function updateStage(jobId, stage, extra = {}) {
  const { error } = await supabase.from("mei_jobs")
    .update({ result: { stage, ...extra }, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "processing");
  if (error) throw new Error("Não foi possível atualizar a etapa do job: " + error.message);
}

async function closeSession(jobId) {
  const session = sessions.get(jobId);
  if (!session) return;
  sessions.delete(jobId);
  await session.browser.close().catch(() => {});
  await fs.rm(session.profileDir, { recursive: true, force: true }).catch(() => {});
}

async function processAfterManualCheck(jobId) {
  const session = sessions.get(jobId);
  if (!session) throw new Error("Sessão do navegador não está mais disponível. Reenvie a solicitação para uma nova tentativa.");
  await updateStage(jobId, "processing_pgmei");
  const result = await continuarConsultaPgmei({
    page: session.page,
    cnpj: session.cliente.cnpj,
    competencia: session.job.competencia,
  });

  if (result.status === "ja_pago") {
    await marcarJobPago(supabase, jobId, result.mensagem);
    await closeSession(jobId);
    return { status: "paid", message: result.mensagem };
  }

  await updateStage(jobId, "validating_pdf");
  const saved = await concluirJobComPdf({
    supabase,
    job: session.job,
    cliente: session.cliente,
    pdfBuffer: result.pdf,
  });
  await closeSession(jobId);
  return { status: "completed", boletoId: saved.boletoId, storagePath: saved.storagePath };
}

async function handleClaimedJob(job) {
  let browser;
  const profileDir = path.join(PROFILE_ROOT, job.id);
  try {
    const cliente = await obterClienteDoJob(supabase, job);
    await fs.mkdir(profileDir, { recursive: true });
    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROMIUM_PATH,
      userDataDir: profileDir,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1000"],
      defaultViewport: null,
    });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);
    const identification = await iniciarIdentificacaoPgmei({ page, cnpj: cliente.cnpj });
    sessions.set(job.id, { browser, page, job, cliente, profileDir });
    browser = null;

    if (identification.status === "awaiting_user") {
      await updateStage(job.id, "awaiting_user", {
        message: "Conclua manualmente a validação na sessão visual e depois solicite a continuação.",
      });
      return;
    }

    await processAfterManualCheck(job.id);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await closeSession(job.id);
    if (error?.code === "MANUAL_VERIFICATION_REQUIRED") {
      await updateStage(job.id, "awaiting_user", { message: error.message });
      return;
    }
    await falharJob(supabase, job.id, error, true).catch((failure) => {
      process.stderr.write("Falha ao registrar erro de job: " + failure.message + "\n");
    });
  }
}

async function pollQueue() {
  if (polling || stopping || sessions.size > 0) return;
  polling = true;
  try {
    // The database claim uses SKIP LOCKED; one browser session is intentionally processed per worker.
    const job = await reivindicarProximoJob(supabase);
    if (job) await handleClaimedJob(job);
  } catch (error) {
    process.stderr.write("Erro no consumidor da fila MEI: " + error.message + "\n");
  } finally {
    polling = false;
  }
}

app.get("/health", (_req, res) => res.json({
  ok: true,
  worker: "mei-facil",
  queueConsumer: !stopping,
}));

app.post("/api/jobs", auth, async (req, res) => {
  try {
    const job = await enfileirarJob({
      supabase,
      userId: String(req.body?.userId || ""),
      clienteId: String(req.body?.clienteId || ""),
      competencia: String(req.body?.competencia || ""),
    });
    return res.status(201).json(job);
  } catch (error) {
    const duplicate = /duplicate key|unique constraint/i.test(error.message);
    return res.status(duplicate ? 409 : 400).json({ error: duplicate ? "Já existe uma solicitação para esta competência." : "Não foi possível criar a solicitação. Confira os dados e tente novamente." });
  }
});

app.get("/api/jobs/:id", auth, async (req, res) => {
  if (!validJobId(req.params.id)) return res.status(400).json({ error: "Identificador de solicitação inválido." });
  const { data, error } = await supabase.from("mei_jobs")
    .select("id, user_id, cliente_id, competencia, status, attempts, error_message, result, storage_path, boleto_id, created_at, updated_at, completed_at")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Não foi possível consultar o job." });
  if (!data) return res.status(404).json({ error: "Job não encontrado." });
  return res.json(data);
});

app.post("/api/jobs/:id/continue", auth, async (req, res) => {
  if (!validJobId(req.params.id)) return res.status(400).json({ error: "Identificador de solicitação inválido." });
  const session = sessions.get(req.params.id);
  if (!session) return res.status(409).json({ error: "Sessão visual não está ativa. O job pode ter sido interrompido ou o worker reiniciado." });
  try {
    if (session.continuing) return res.status(409).json({ error: "A continuação deste job já está em andamento." });
    if (session.page.url().includes("/Identificacao")) {
      return res.status(409).json({ error: "O PGMEI ainda está na identificação. Conclua a validação na sessão visual e tente novamente." });
    }
    session.continuing = true;
    const jobId = req.params.id;
    // Return immediately: PDF generation can take longer than an Edge Function request.
    void processAfterManualCheck(jobId).catch(async (error) => {
      await closeSession(jobId);
      await falharJob(supabase, jobId, error, true).catch((failure) => {
        process.stderr.write("Falha ao registrar erro de continuação: " + failure.message + "\\n");
      });
    });
    return res.status(202).json({ id: jobId, status: "processing", message: "Consulta retomada; acompanhe o status da solicitação." });
  } catch (error) {
    await closeSession(req.params.id);
    await falharJob(supabase, req.params.id, error, true).catch(() => {});
    return res.status(502).json({ error: error.message });
  }
});

app.get("/api/jobs/:id/file", auth, async (req, res) => {
  if (!validJobId(req.params.id)) return res.status(400).json({ error: "Identificador de solicitação inválido." });
  const { data, error } = await supabase.from("mei_jobs")
    .select("storage_path, status")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Não foi possível consultar o arquivo." });
  if (!data || data.status !== "completed" || !data.storage_path) {
    return res.status(404).json({ error: "PDF ainda não está disponível." });
  }
  try {
    const url = await gerarUrlDownload(supabase, data.storage_path, 60);
    return res.json({ url, expiresIn: 60 });
  } catch {
    return res.status(502).json({ error: "Não foi possível gerar o link temporário." });
  }
});

app.post("/api/jobs/:id/close", auth, async (req, res) => {
  if (!validJobId(req.params.id)) return res.status(400).json({ error: "Identificador de solicitação inválido." });
  await closeSession(req.params.id);
  try {
    const status = await falharJob(supabase, req.params.id, "Sessão encerrada pelo operador.", false);
    return res.json({ id: req.params.id, status });
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  process.stdout.write("MEI Fácil worker API listening on port " + PORT + "\n");
});

const leaseTimer = setInterval(async () => {
  if (sessions.size === 0 || stopping) return;
  const now = new Date().toISOString();
  const renewals = [...sessions.keys()].map((jobId) =>
    supabase.from("mei_jobs")
      .update({ locked_at: now, updated_at: now })
      .eq("id", jobId)
      .eq("status", "processing")
  );
  const results = await Promise.allSettled(renewals);
  for (const result of results) {
    if (result.status === "rejected" || result.value?.error) {
      process.stderr.write("Aviso: não foi possível renovar o lease de um job PGMEI.\n");
    }
  }
}, 60000);
const pollTimer = setInterval(() => { void pollQueue(); }, POLL_MS);
void pollQueue();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(pollTimer);
  clearInterval(leaseTimer);
  server.close();
  await Promise.all([...sessions.keys()].map(closeSession));
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
