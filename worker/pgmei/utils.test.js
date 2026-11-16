import test from "node:test";
import assert from "node:assert/strict";
import { formatCNPJ, isAuthorizedToken, isCompetenciaValida } from "./utils.js";

test("formatCNPJ formats exactly 14 digits", () => {
  assert.equal(formatCNPJ("40439707000113"), "40.439.707/0001-13");
});

test("isCompetenciaValida accepts MM/YYYY and rejects invalid months", () => {
  assert.equal(isCompetenciaValida("12/2021"), true);
  assert.equal(isCompetenciaValida("01/2026"), true);
  assert.equal(isCompetenciaValida("13/2026"), false);
  assert.equal(isCompetenciaValida("00/2026"), false);
  assert.equal(isCompetenciaValida("1/2026"), false);
});

test("isAuthorizedToken handles equal and unequal token lengths safely", () => {
  assert.equal(isAuthorizedToken("a".repeat(40), "a".repeat(40)), true);
  assert.equal(isAuthorizedToken("wrong", "a".repeat(40)), false);
  assert.equal(isAuthorizedToken(undefined, "a".repeat(40)), false);
});
