import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { processImportQueue } from "./jobs/import-queue.js";
import { processApprovedSends } from "./jobs/send-queue.js";
import { handleWhatsAppWebhook, validMetaSignature } from "./webhooks/whatsapp.js";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true, service: "mei-facil-worker" }));

app.get("/webhooks/whatsapp", (req, res) => {
  const ok = req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  return ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
});

app.post("/webhooks/whatsapp", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  try {
    if (!validMetaSignature(req.body, req.get("x-hub-signature-256"))) return res.sendStatus(401);
    await handleWhatsAppWebhook(JSON.parse(req.body.toString("utf8")));
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err?.message ?? err);
    return res.sendStatus(500);
  }
});

const minutes = Math.max(1, Math.min(Number(process.env.POLL_EVERY_MINUTES || 2), 15));
cron.schedule(`*/${minutes} * * * *`, async () => {
  try { await processImportQueue(); await processApprovedSends(); }
  catch (err) { console.error("Queue cycle failed:", err); }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`MEI Fácil worker on :${port}`));
