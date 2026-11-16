import express from "express";
import puppeteer from "puppeteer";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { formatCNPJ, isAuthorizedToken, isCompetenciaValida } from "./utils.js";

const app = express();
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN;
const RESULTS_DIR = process.env.RESULTS_DIR || "/app/results";
const PROFILE_DIR = process.env.PROFILE_DIR || "/app/chrome-profile";
const PGMEI_URL = "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao";
const jobs = new Map();
let activeJobId = null;

if (!API_TOKEN || API_TOKEN.length < 32) {
  throw new Error("Configure API_TOKEN com pelo menos 32 caracteres.");
}

function auth(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(API_TOKEN))) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}

function formatCNPJ(digits) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function serialize(job) {
  return {
    id: job.id,
    status: job.status,
    cnpj: job.cnpj,
    competencia: job.competencia,
    message: job.message,
    paidMessage: job.paidMessage || null,
    fileAvailable: Boolean(job.filePath),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function update(job, status, message) {
  job.status = status;
  job.message = message;
  job.updatedAt = new Date().toISOString();
}

function requireJob(req, res, next) {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Sessão não encontrada." });
  req.job = job;
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/jobs", auth, async (req, res) => {
  try {
    const cnpj = String(req.body?.cnpj || "").replace(/\D/g, "");
    const competencia = String(req.body?.competencia || "");
    if (!/^\d{14}$/.test(cnpj)) return res.status(400).json({ error: "CNPJ deve conter 14 dígitos." });
    if (!/^(0[1-9]|1[0-2])\/20\d{2}$/.test(competencia)) {
      return res.status(400).json({ error: "Competência deve estar no formato MM/AAAA." });
    }
    if (activeJobId) {
      const active = jobs.get(activeJobId);
      if (active && !["completed", "paid", "failed", "cancelled"].includes(active.status)) {
        return res.status(409).json({ error: "Já existe uma sessão PGMEI em andamento.", job: serialize(active) });
      }
    }

    const id = crypto.randomUUID();
    const job = {
      id, cnpj, competencia, status: "starting", message: "Abrindo o PGMEI.",
      browser: null, page: null, filePath: null, paidMessage: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    jobs.set(id, job);
    activeJobId = id;

    job.browser = await puppeteer.launch({
      headless: false,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      userDataDir: PROFILE_DIR,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1000"],
      defaultViewport: null,
    });
    job.page = await job.browser.newPage();
    job.page.setDefaultNavigationTimeout(90000);
    await job.page.goto(PGMEI_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await job.page.waitForSelector("#cnpj", { timeout: 45000 });
    await job.page.click("#cnpj");
    await job.page.type("#cnpj", formatCNPJ(cnpj), { delay: 45 });
    await job.page.waitForSelector("#continuar", { timeout: 30000 });
    await job.page.click("#continuar");
    update(job, "awaiting_user", "O CNPJ foi preenchido. Abra a sessão visual e conclua manualmente eventual CAPTCHA ou confirmação apresentada pelo PGMEI.");
    return res.status(201).json(serialize(job));
  } catch (error) {
    const job = activeJobId ? jobs.get(activeJobId) : null;
    if (job) {
      update(job, "failed", error instanceof Error ? error.message : "Falha ao abrir o PGMEI.");
      await job.browser?.close().catch(() => {});
      job.browser = null;
    }
    activeJobId = null;
    return res.status(502).json({ error: "Não foi possível iniciar a sessão PGMEI." });
  }
});

app.get("/api/jobs/:id", auth, requireJob, (req, res) => res.json(serialize(req.job)));

app.post("/api/jobs/:id/continue", auth, requireJob, async (req, res) => {
  const job = req.job;
  if (job.status !== "awaiting_user") return res.status(409).json({ error: "A sessão não está aguardando confirmação manual.", job: serialize(job) });

  try {
    update(job, "checking_session", "Verificando se a etapa de identificação foi concluída.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (job.page.url().includes("/Identificacao")) {
      update(job, "awaiting_user", "O PGMEI ainda está na identificação. Conclua a etapa manualmente na janela do navegador e tente novamente.");
      return res.status(409).json({ error: "A etapa manual ainda não foi concluída.", job: serialize(job) });
    }

    update(job, "processing", "Acessando a emissão do DAS.");
    const menuToggle = await job.page.$("button.navbar-toggle");
    if (menuToggle && await menuToggle.isVisible()) await menuToggle.click();

    const linkEmissao = await job.page.waitForSelector('a[href*="emissao"]', { timeout: 30000 });
    await linkEmissao.click();
    await job.page.waitForSelector('button[data-id="anoCalendarioSelect"]', { timeout: 30000 });
    await job.page.click('button[data-id="anoCalendarioSelect"]');

    const ano = job.competencia.slice(3);
    const selecionouAno = await job.page.evaluate((year) => {
      const options = [...document.querySelectorAll(".dropdown-menu li a")];
      const option = options.find((item) => item.textContent?.trim().includes(year));
      option?.click();
      return Boolean(option);
    }, ano);
    if (!selecionouAno) throw new Error("Ano da competência não encontrado no PGMEI.");

    await job.page.click('button[type="submit"].btn-success');
    await job.page.waitForSelector("input.paSelecionado", { timeout: 30000 });
    const periodo = job.competencia.slice(3) + job.competencia.slice(0, 2);
    const selecionouMes = await job.page.evaluate((value) => {
      const checkbox = document.querySelector('input.paSelecionado[value="' + value + '"]');
      if (!checkbox) return false;
      checkbox.click();
      return true;
    }, periodo);
    if (!selecionouMes) throw new Error("Competência solicitada não está disponível no PGMEI.");

    const botaoGerar = await job.page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const button = buttons.find((item) => /apurar|gerar/i.test(item.textContent || ""));
      button?.click();
      return Boolean(button);
    });
    if (!botaoGerar) throw new Error("Botão de apuração não encontrado.");

    await new Promise((resolve) => setTimeout(resolve, 3500));
    const bodyText = await job.page.evaluate(() => document.body.innerText);
    if (/já existe pagamento|já foi pago|não será gerado DAS/i.test(bodyText)) {
      job.paidMessage = bodyText.match(/.{0,100}(?:já existe pagamento|já foi pago|não será gerado DAS).{0,180}/i)?.[0] || "O PGMEI informou que já existe pagamento para a competência.";
      update(job, "paid", "O PGMEI indicou que esta competência já está paga.");
      return res.json(serialize(job));
    }

    const printButton = await job.page.waitForSelector('a[href*="imprimir"], a.btn-success[role="button"]', { timeout: 30000 });
    const pdfResponsePromise = job.page.waitForResponse((response) => {
      const contentType = response.headers()["content-type"] || "";
      return response.status() === 200 && contentType.toLowerCase().includes("pdf");
    }, { timeout: 45000 });
    await printButton.click();
    const pdfResponse = await pdfResponsePromise;
    const buffer = await pdfResponse.buffer();
    if (buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("A resposta recebida não é um PDF válido.");

    await fs.mkdir(RESULTS_DIR, { recursive: true });
    job.filePath = path.join(RESULTS_DIR, `DAS_${job.cnpj}_${periodo}_${job.id}.pdf`);
    await fs.writeFile(job.filePath, buffer);
    update(job, "completed", "DAS baixado. O PDF está disponível para importação no MEI Fácil.");
    return res.json(serialize(job));
  } catch (error) {
    update(job, "failed", error instanceof Error ? error.message : "Falha ao processar a competência.");
    return res.status(502).json({ error: job.message, job: serialize(job) });
  }
});

app.get("/api/jobs/:id/file", auth, requireJob, async (req, res) => {
  if (!req.job.filePath) return res.status(404).json({ error: "O PDF ainda não está disponível." });
  return res.download(req.job.filePath);
});

app.post("/api/jobs/:id/close", auth, requireJob, async (req, res) => {
  await req.job.browser?.close().catch(() => {});
  update(req.job, "cancelled", "Sessão encerrada.");
  if (activeJobId === req.job.id) activeJobId = null;
  res.json(serialize(req.job));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`PGMEI session worker listening on port ${PORT}`);
});
