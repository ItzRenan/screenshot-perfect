const PGMEI_URL = "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao";

const MESES = {
  "01": "janeiro", "02": "fevereiro", "03": "março", "04": "abril",
  "05": "maio", "06": "junho", "07": "julho", "08": "agosto",
  "09": "setembro", "10": "outubro", "11": "novembro", "12": "dezembro",
};

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

export async function consultarPgmei({ page, cnpj: cnpjInformado, competencia, timeoutVerificacaoMs = 180000 }) {
  if (!page) throw new Error("Página do navegador não informada.");
  const cnpj = normalizarCnpj(cnpjInformado);
  const periodo = normalizarCompetencia(competencia);

  await page.goto(PGMEI_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#cnpj", { timeout: 30000 });
  await page.locator("#cnpj").fill(cnpj);
  await page.locator("#continuar").click();

  // Não tenta resolver nem contornar CAPTCHA. A sessão precisa ser validada por uma pessoa.
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutVerificacaoMs) {
    if (!page.url().includes("/Identificacao")) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (page.url().includes("/Identificacao")) {
    const error = new Error("A validação do PGMEI ainda está pendente. Conclua o desafio manualmente na sessão do navegador e tente novamente.");
    error.code = "MANUAL_VERIFICATION_REQUIRED";
    throw error;
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
  if (!anoSelecionado) {
    const error = new Error("O ano solicitado não está disponível no PGMEI.");
    error.code = "YEAR_NOT_AVAILABLE";
    throw error;
  }

  await page.locator('button[type="submit"].btn-success').click();
  await page.waitForSelector("input.paSelecionado", { timeout: 20000 });
  const mesSelecionado = await page.evaluate((chave) => {
    const checkbox = document.querySelector('input.paSelecionado[value="' + chave + '"]');
    if (!checkbox) return false;
    checkbox.click();
    return true;
  }, periodo.chave);
  if (!mesSelecionado) {
    const error = new Error("A competência solicitada não está disponível para emissão.");
    error.code = "COMPETENCY_NOT_AVAILABLE";
    throw error;
  }

  await page.evaluate(() => {
    const botao = Array.from(document.querySelectorAll("button"))
      .find((item) => /apurar|gerar/i.test(item.textContent || ""));
    if (!botao) return false;
    botao.click();
    return true;
  }).then((ok) => {
    if (!ok) {
      const error = new Error("Botão de apuração não encontrado.");
      error.code = "GENERATE_BUTTON_NOT_FOUND";
      throw error;
    }
  });

  await page.waitForTimeout(3000);
  const mensagem = await page.evaluate(() => {
    const elementos = document.querySelectorAll(".alert, .notification, [class*='toast'], [class*='modal'], .swal-text, .modal-body");
    for (const elemento of elementos) {
      const texto = (elemento.textContent || "").trim();
      if (/já existe pagamento|já foi pago|não será gerado DAS/i.test(texto)) return texto;
    }
    return null;
  });

  if (mensagem) {
    return {
      status: "ja_pago",
      cnpj,
      competencia,
      mensagem,
      consultado_em: new Date().toISOString(),
    };
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

  return {
    status: "pdf_gerado",
    cnpj,
    competencia,
    pdf,
    consultado_em: new Date().toISOString(),
  };
}
