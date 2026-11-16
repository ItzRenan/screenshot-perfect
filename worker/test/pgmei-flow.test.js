import test from "node:test";
import assert from "node:assert/strict";
import { normalizarCnpj, normalizarCompetencia } from "../src/pgmei-flow.js";

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
