import { describe, expect, it } from "vitest";
import { interpretarTextoDAS } from "./das-parser";

describe("interpretarTextoDAS", () => {
  it("extrai corretamente o DAS com vencimento original diferente do prazo de pagamento", () => {
    const texto = `
      Documento de Arrecadação do Simples Nacional
      CNPJ Razão Social 40.439.707/0001-13
      Período de Apuração Data de Vencimento
      DANILO EWERTON PEREIRA DE FRANCA 03950894330
      dezembro/2021
      Número do Documento
      20/01/2022
      Pagar este documento até
      07.08.26320.5582635-3
      16/11/2026
      Valor Total do Documento 55,78
    `;
    expect(interpretarTextoDAS(texto)).toMatchObject({
      cnpj: "40.439.707/0001-13",
      competencia: "12/2021",
      valor: "55,78",
      vencimento: "2026-11-16",
      vencimentoOriginal: "2022-01-20",
      textoEncontrado: true,
    });
  });

  it("extrai DAS em que vencimento original e prazo para pagamento são iguais", () => {
    const texto = `
      CNPJ 65.939.082/0001-80
      Período de Apuração outubro/2026
      Data de Vencimento 23/11/2026
      Pagar este documento até 23/11/2026
      Valor Total do Documento 86,05
    `;
    expect(interpretarTextoDAS(texto)).toMatchObject({
      cnpj: "65.939.082/0001-80",
      competencia: "10/2026",
      valor: "86,05",
      vencimento: "2026-11-23",
      vencimentoOriginal: "2026-11-23",
    });
  });

  it("rejeita datas impossíveis e não inventa dados em texto sem campos", () => {
    const resultado = interpretarTextoDAS("PDF sem dados de arrecadação");
    expect(resultado).toMatchObject({
      cnpj: null,
      competencia: null,
      valor: null,
      vencimento: null,
      vencimentoOriginal: null,
      textoEncontrado: false,
    });
  });

  it("não confunde prazo de pagamento com vencimento original quando o campo original é inválido", () => {
    const texto = `
      CNPJ 40.439.707/0001-13
      dezembro/2021
      Data de Vencimento 31/02/2022
      Pagar este documento até 16/11/2026
      Valor Total do Documento 55,78
    `;
    expect(interpretarTextoDAS(texto)).toMatchObject({
      competencia: "12/2021",
      vencimento: "2026-11-16",
      vencimentoOriginal: null,
    });
  });
});
