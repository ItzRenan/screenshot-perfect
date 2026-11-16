const PGMEI_URL = "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao";

export function normalizarCompetencia(valor) {
  const match = String(valor ?? "").match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  if (!match) throw new Error("Competência inválida. Use MM/AAAA.");
  return { mes: match[1], ano: match[2], chave: match[2] + match[1] };
}

export function normalizarCnpj(valor) {
  const cnpj = String(valor ?? "").replace(/\D/g, "");
  if (!/^\d{14}$/.test(cnpj)) throw new Error("CNPJ inválido: informe os 14 dígitos.");
  return cnpj;
}

function erro(codigo, mensagem) {
  const error = new Error(mensagem);
  error.code = codigo;
  return error;
}

/** Abre a identificação e preenche o CNPJ; não tenta resolver desafios. */
export async function iniciarIdentificacaoPgmei({ page, cnpj: cnpjInformado }) {
  if (!page) throw new Error("Página do navegador não informada.");
  const cnpj = normalizarCnpj(cnpjInformado);
  await page.goto(PGMEI_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#cnpj", { timeout: 30000 });
  await page.click("#cnpj");
  await page.type("#cnpj", cnpj, { delay: 35 });
  await page.click("#continuar");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return {
    cnpj,
    status: page.url().includes("/Identificacao") ? "awaiting_user" : "ready",
  };
}

/** Executa a navegação após o operador concluir eventual validação manual. */
export async function continuarConsultaPgmei({ page, cnpj: cnpjInformado, competencia }) {
  if (!page) throw new Error("Página do navegador não informada.");
  const cnpj = normalizarCnpj(cnpjInformado);
  const periodo = normalizarCompetencia(competencia);
  if (page.url().includes("/Identificacao")) {
    throw erro("MANUAL_VERIFICATION_REQUIRED", "Conclua manualmente a validação do PGMEI na sessão visual.");
  }

  const linkEmissao = await page.waitForSelector('a[href*="emissao"]', { timeout: 30000 });
  await linkEmissao.click();
  await page.waitForSelector('button[data-id="anoCalendarioSelect"]', { timeout: 20000 });
  await page.click('button[data-id="anoCalendarioSelect"]');
  const anoSelecionado = await page.evaluate((ano) => {
    const opcao = Array.from(document.querySelectorAll(".dropdown-menu li a"))
      .find((item) => item.textContent.trim() === ano);
    if (!opcao) return false;
    opcao.click();
    return true;
  }, periodo.ano);
  if (!anoSelecionado) throw erro("YEAR_NOT_AVAILABLE", "O ano solicitado não está disponível no PGMEI.");

  await page.click('button[type="submit"].btn-success');
  await page.waitForSelector("input.paSelecionado", { timeout: 20000 });
  const mesSelecionado = await page.evaluate((chave) => {
    const checkbox = document.querySelector('input.paSelecionado[value="' + chave + '"]');
    if (!checkbox) return false;
    checkbox.click();
    return true;
  }, periodo.chave);
  if (!mesSelecionado) throw erro("COMPETENCY_NOT_AVAILABLE", "A competência solicitada não está disponível para emissão.");

  const botaoGerar = await page.evaluate(() => {
    const botao = Array.from(document.querySelectorAll("button"))
      .find((item) => /apurar|gerar/i.test(item.textContent || ""));
    if (!botao) return false;
    botao.click();
    return true;
  });
  if (!botaoGerar) throw erro("GENERATE_BUTTON_NOT_FOUND", "Botão de apuração não encontrado.");

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const mensagem = await page.evaluate(() => {
    const elementos = document.querySelectorAll(".alert, .notification, [class*='toast'], [class*='modal'], .swal-text, .modal-body");
    for (const elemento of elementos) {
      const texto = (elemento.textContent || "").trim();
      if (/já existe pagamento|já foi pago|não será gerado DAS/i.test(texto)) return texto;
    }
    return null;
  });

  if (mensagem) {
    return { status: "ja_pago", cnpj, competencia, mensagem, consultado_em: new Date().toISOString() };
  }

  const botaoPdf = await page.waitForSelector('a[href*="imprimir"], a.btn-success[role="button"]', { timeout: 30000 });
  const respostaPdf = page.waitForResponse((response) =>
    response.status() === 200 && /application\/pdf/i.test(response.headers()["content-type"] || ""),
    { timeout: 45000 },
  );
  await botaoPdf.click();
  const response = await respostaPdf;
  const pdf = await response.buffer();
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("A resposta de impressão não é um PDF válido.");
  }
  return { status: "pdf_gerado", cnpj, competencia, pdf, consultado_em: new Date().toISOString() };
}

/** Compatibilidade com chamadores que aguardam a validação na mesma chamada. */
export async function consultarPgmei({ page, cnpj, competencia, timeoutVerificacaoMs = 180000 }) {
  const inicio = await iniciarIdentificacaoPgmei({ page, cnpj });
  if (inicio.status === "awaiting_user") {
    const started = Date.now();
    while (Date.now() - started < timeoutVerificacaoMs && page.url().includes("/Identificacao")) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (page.url().includes("/Identificacao")) {
    throw erro("MANUAL_VERIFICATION_REQUIRED", "A validação do PGMEI ainda está pendente. Conclua o desafio manualmente na sessão do navegador.");
  }
  return continuarConsultaPgmei({ page, cnpj, competencia });
}
