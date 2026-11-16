import puppeteer from "@cloudflare/puppeteer";

const PGMEI_URL =
  "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function authorized(request, env) {
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + (env.API_TOKEN || "");
  if (!env.API_TOKEN || supplied.length !== expected.length) return false;

  // Constant-time comparison without requiring Node crypto in the Worker runtime.
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "mei-facil-browser-poc" });
    }

    if (request.method !== "POST" || url.pathname !== "/probe/pgmei") {
      return json({ error: "Rota não encontrada." }, 404);
    }

    if (!authorized(request, env)) {
      return json({ error: "Não autorizado." }, 401);
    }

    if (!env.BROWSER) {
      return json({ error: "Binding Browser Run (BROWSER) não configurado." }, 503);
    }

    let browser;
    try {
      // This proof of concept only checks whether Browser Run can reach the PGMEI.
      // It does not enter taxpayer data, solve CAPTCHA, or attempt DAS issuance.
      browser = await puppeteer.launch(env.BROWSER, { keep_alive: 120000 });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(45000);

      await page.goto(PGMEI_URL, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        hasCnpjInput: Boolean(document.querySelector("#cnpj")),
        pageText: (document.body?.innerText || "").slice(0, 1200),
      }));

      const cdp = await page.createCDPSession();
      const liveView = await cdp.send("Cloudflare.getLiveView", {
        mode: "tab",
        expiresInMs: 300000,
      });
      await cdp.detach();

      const sessionId =
        typeof browser.sessionId === "function" ? browser.sessionId() : null;

      // Disconnect the controller but leave the remote browser alive for inspection.
      await browser.disconnect();

      return json({
        ok: true,
        sessionId,
        liveViewUrl: liveView.devtoolsFrontendUrl,
        ...pageInfo,
        note:
          "Teste de conectividade apenas. Nenhum CNPJ foi preenchido e nenhum DAS foi emitido. O link de visualização é temporário e deve ser tratado como credencial.",
      });
    } catch (error) {
      if (browser) {
        await browser.disconnect().catch(() => {});
      }
      return json(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Falha desconhecida ao iniciar Browser Run.",
        },
        502,
      );
    }
  },
};
