import test from "node:test";
import assert from "node:assert/strict";
import { extrairDadosDas, validarCorrespondenciaDas } from "../src/das-parser.js";

const texto2026 = [
  "Documento de Arrecadação do Simples Nacional",
  "CNPJ Razão Social",
  "65.939.082/0001-80 65.939.082 EMPRESA TESTE",
  "Período de Apuração Data de Vencimento Número do Documento",
  "outubro/2026 23/11/2026 07.08.26320.5560728-7",
  "Pagar este documento até 23/11/2026",
  "Valor Total do Documento 86,05"
].join(" ");

const texto2021 = [
  "Documento de Arrecadação do Simples Nacional",
  "CNPJ 40.439.707/0001-13",
  "Período de Apuração Data de Vencimento Número do Documento",
  "dezembro/2021 20/01/2022 07.08.26320.5582635-3",
  "Pagar este documento até 16/11/2026",
  "Valor Total do Documento 55,78"
].join(" ");

test("extrai campos do DAS atual, mesmo com títulos de coluna antes dos valores", () => {
  assert.deepEqual(extrairDadosDas(texto2026), {
    cnpj: "65939082000180", competencia: "10/2026", vencimento: "2026-11-23",
    valor_centavos: 8605, valido: true, campos_ausentes: []
  });
});

test("extrai DAS antigo com valor e vencimento recalculados", () => {
  const dados = extrairDadosDas(texto2021);
  assert.equal(dados.cnpj, "40439707000113");
  assert.equal(dados.competencia, "12/2021");
  assert.equal(dados.valor_centavos, 5578);
  assert.equal(dados.valido, true);
});

test("rejeita boleto pertencente a outro CNPJ", () => {
  assert.throws(() => validarCorrespondenciaDas(extrairDadosDas(texto2026), "40439707000113", "10/2026"), /não corresponde ao cliente selecionado/);
});

test("rejeita competência diferente da solicitada", () => {
  assert.throws(() => validarCorrespondenciaDas(extrairDadosDas(texto2026), "65939082000180", "09/2026"), /competência do PDF/);
});

test("não considera PDF incompleto como boleto válido", () => {
  const dados = extrairDadosDas("CNPJ 65.939.082/0001-80 Período de Apuração outubro/2026");
  assert.equal(dados.valido, false);
  assert.deepEqual(dados.campos_ausentes, ["vencimento", "valor total"]);
});
