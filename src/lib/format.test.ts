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

import { isValidCompetencia, parseValorBRL, vencimentoPadrao, formatDate } from "./format";

describe("Boletos", () => {
  it("vencimento padrão é no mês seguinte à competência", () => {
    expect(vencimentoPadrao("11/2026", 20)).toBe("2026-12-20");
    expect(vencimentoPadrao("12/2026", 20)).toBe("2027-01-20");
  });
  it("valida competência MM/AAAA", () => {
    expect(isValidCompetencia("11/2026")).toBe(true);
    expect(isValidCompetencia("13/2026")).toBe(false);
    expect(isValidCompetencia("1/2026")).toBe(false);
  });
  it("converte valores em reais", () => {
    expect(parseValorBRL("75,90")).toBe(75.9);
    expect(parseValorBRL("1.234,56")).toBe(1234.56);
    expect(parseValorBRL("abc")).toBeNull();
  });
  it("formata data sem mudar o dia por fuso", () => {
    expect(formatDate("2026-12-20")).toBe("20/12/2026");
  });
});
