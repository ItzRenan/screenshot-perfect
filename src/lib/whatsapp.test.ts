import { describe, expect, it } from "vitest";
import { linkWhatsApp, MENSAGEM_PADRAO, preencherMensagem, telefoneInternacional } from "./whatsapp";

describe("Mensagem do WhatsApp", () => {
  it("preenche cliente, competência, valor e vencimento", () => {
    const msg = preencherMensagem(MENSAGEM_PADRAO, {
      cliente: "Maria",
      competencia: "11/2026",
      valor: "R$ 75,90",
      vencimento: "20/12/2026",
      escritorio: "",
    });
    expect(msg).toContain("Olá, Maria!");
    expect(msg).toContain("competência 11/2026");
    expect(msg).toContain("vencimento em 20/12/2026");
    expect(msg).not.toContain("{");
  });
});

describe("Telefone do WhatsApp", () => {
  it("adiciona o código do Brasil (55) ao telefone com DDD", () => {
    expect(telefoneInternacional("85987654321")).toBe("5585987654321");
  });
  it("não duplica o 55 quando já existe", () => {
    expect(telefoneInternacional("5585987654321")).toBe("5585987654321");
  });
  it("abre wa.me no aplicativo e web.whatsapp.com no navegador", () => {
    expect(linkWhatsApp("85987654321", "Oi", "app")).toBe("https://wa.me/5585987654321?text=Oi");
    expect(linkWhatsApp("85987654321", "Oi", "web")).toBe(
      "https://web.whatsapp.com/send?phone=5585987654321&text=Oi",
    );
  });
});
