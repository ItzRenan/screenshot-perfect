import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MEI Fácil — Gestão de boletos DAS" },
      { name: "description", content: "Painel para administrar clientes MEI e boletos DAS com envio pelo WhatsApp." },
      { property: "og:title", content: "MEI Fácil — Gestão de boletos DAS" },
      { property: "og:description", content: "Painel para administrar clientes MEI e boletos DAS com envio pelo WhatsApp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/painel" });
  },
});
