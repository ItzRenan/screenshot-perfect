export const STATUS_BOLETO = {
  pendente: { label: "Pendente", className: "bg-warning/15 text-warning ring-warning/30" },
  conferido: { label: "Conferido", className: "bg-primary/15 text-primary ring-primary/30" },
  enviado: { label: "Enviado", className: "bg-success/15 text-success ring-success/30" },
} as const;

export type StatusBoleto = keyof typeof STATUS_BOLETO;

export function statusBoleto(value: string | null | undefined): StatusBoleto {
  return value === "conferido" || value === "enviado" ? value : "pendente";
}

export const STATUS_ENVIO: Record<string, { label: string; className: string }> = {
  enviado: { label: "Enviado", className: "bg-success/15 text-success ring-success/30" },
  aguardando: { label: "Aguardando", className: "bg-warning/15 text-warning ring-warning/30" },
  falhou: { label: "Não enviado", className: "bg-destructive/15 text-destructive ring-destructive/30" },
};
