import test from "node:test";
import assert from "node:assert/strict";
import { normalizarCnpj, normalizarCompetencia, iniciarIdentificacaoPgmei, continuarConsultaPgmei } from "../src/pgmei-flow.js";

test("normaliza CNPJ com pontuação", () => {
  assert.equal(normalizarCnpj("65.939.082/0001-80"), "65939082000180");
});

test("rejeita CNPJ fora do formato de 14 dígitos", () => {
  assert.throws(() => normalizarCnpj("123"), /CNPJ inválido/);
});

test("normaliza competência para ano e chave PGMEI", () => {
  assert.deepEqual(normalizarCompetencia("10/2026"), { mes: "10", ano: "2026", chave: "202610" });
});

test("rejeita competência fora do formato MM/AAAA", () => {
  assert.throws(() => normalizarCompetencia("2026-10"), /Competência inválida/);
});

test("inicia a identificação e pausa para validação humana sem tentar resolver CAPTCHA", async () => {
  const calls = [];
  const page = {
    goto: async (url) => calls.push(["goto", url]),
    waitForSelector: async (selector) => calls.push(["wait", selector]),
    click: async (selector) => calls.push(["click", selector]),
    type: async (selector, value) => calls.push(["type", selector, value]),
    url: () => "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao",
  };
  const result = await iniciarIdentificacaoPgmei({ page, cnpj: "65939082000180" });
  assert.equal(result.status, "awaiting_user");
  assert.ok(calls.some((call) => call[0] === "type" && call[2] === "65939082000180"));
  assert.ok(!calls.some((call) => /captcha|solver|challenge/i.test(String(call[1] || ""))));
});

test("não continua a consulta enquanto a página permanecer na identificação", async () => {
  const page = { url: () => "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao" };
  await assert.rejects(
    () => continuarConsultaPgmei({ page, cnpj: "65939082000180", competencia: "10/2026" }),
    (error) => error.code === "MANUAL_VERIFICATION_REQUIRED",
  );
});
