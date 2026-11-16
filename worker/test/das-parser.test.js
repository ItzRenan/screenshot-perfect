import test from "node:test";
import assert from "node:assert/strict";
import { extrairDadosDas, validarCorrespondenciaDas } from "../src/das-parser.js";

const texto2026 = `
Documento de Arrecadação do Simples Nacional
CNPJ Razão Social
65.939.082/0001-80 65.939.082 EMPRESA TESTE
Período de Apuração Data de Vencimento Número do Documento
outubro/2026 23/11/2026 07.08.26320.5560728-7
Pagar este documento até 23/11/2026
Valor Total do Documento 86,05
`;

test("extrai CNPJ, competência, vencimento e valor do DAS", () => {
  const dados = extrairDadosDas(texto2026);
  assert.deepEqual(dados, {
    cnpj: "65939082000180",
    competencia: "10/2026",
    vencimento: "2026-11-23",
    valor_centavos: 8605,
    valido: true,
    campos_ausentes: [],
  });
});

test("rejeita boleto pertencente a outro CNPJ", () => {
  const dados = extrairDadosDas(texto2026);
  assert.throws(
    () => validarCorrespondenciaDas(dados, "40439707000113"),
    /não corresponde ao cliente selecionado/,
  );
});

test("não considera um PDF incompleto como boleto válido", () => {
  const dados = extrairDadosDas("CNPJ 65.939.082/0001-80 Período de Apuração outubro/2026");
  assert.equal(dados.valido, false);
  assert.deepEqual(dados.campos_ausentes, ["vencimento", "valor total"]);
});
