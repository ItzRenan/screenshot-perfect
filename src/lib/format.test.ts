import { describe, expect, it } from "vitest";
import { competenciaDe, formatCNPJ, formatPhone, isValidCNPJ, isValidPhone } from "./format";

describe("CNPJ", () => {
  it("aceita um CNPJ válido com ou sem máscara", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
    expect(isValidCNPJ("11222333000181")).toBe(true);
  });
  it("rejeita dígito verificador errado", () => {
    expect(isValidCNPJ("11.222.333/0001-82")).toBe(false);
  });
  it("rejeita sequências repetidas e tamanhos errados", () => {
    expect(isValidCNPJ("00000000000000")).toBe(false);
    expect(isValidCNPJ("1122233300018")).toBe(false);
  });
  it("formata com a máscara padrão", () => {
    expect(formatCNPJ("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("Telefone", () => {
  it("aceita celular com DDD (11 dígitos) e fixo (10 dígitos)", () => {
    expect(isValidPhone("(85) 98765-4321")).toBe(true);
    expect(isValidPhone("8532654321")).toBe(true);
  });
  it("rejeita telefone sem DDD", () => {
    expect(isValidPhone("987654321")).toBe(false);
  });
  it("formata celular", () => {
    expect(formatPhone("85987654321")).toBe("(85) 98765-4321");
  });
});

describe("Competência", () => {
  it("usa o formato MM/AAAA", () => {
    expect(competenciaDe(new Date(2026, 10, 13))).toBe("11/2026");
    expect(competenciaDe(new Date(2026, 0, 5))).toBe("01/2026");
  });
});
