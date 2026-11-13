import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Eye, History, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { historicoQuery } from "@/lib/queries";
import { formatCompetenciaInput, formatCurrency, formatDateTime } from "@/lib/format";
import { STATUS_ENVIO } from "@/lib/status";
import { visualizarPdf } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({
    meta: [
      { title: "Histórico de envios — MEI Fácil" },
      { name: "description", content: "Acompanhe os boletos DAS enviados aos clientes pelo WhatsApp." },
      { property: "og:title", content: "Histórico de envios — MEI Fácil" },
      { property: "og:description", content: "Acompanhe os boletos DAS enviados aos clientes pelo WhatsApp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(historicoQuery()),
  pendingComponent: () => <p className="text-sm text-muted-foreground">Carregando histórico...</p>,
  errorComponent: ({ error }) => (
    <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error instanceof Error ? error.message : "Não foi possível carregar o histórico."}
    </p>
  ),
  component: HistoricoPage,
});

function statusEnvio(s: string | null) {
  const key = s ?? "aguardando";
  return STATUS_ENVIO[key] ?? { label: key, className: "bg-muted text-muted-foreground ring-border" };
}

function HistoricoPage() {
  const { data: envios } = useSuspenseQuery(historicoQuery());
  const [cliente, setCliente] = useState("");
  const [competencia, setCompetencia] = useState("");

  const lista = useMemo(() => {
    const c = cliente.trim().toLowerCase();
    return envios.filter(
      (e) =>
        (!c || (e.boletos?.clientes?.nome ?? "").toLowerCase().includes(c)) &&
        (!competencia || (e.boletos?.competencia ?? "").startsWith(competencia)),
    );
  }, [envios, cliente, competencia]);

  async function verPdf(path: string | null | undefined) {
    if (!path) {
      toast.error("Este boleto não tem PDF anexado.");
      return;
    }
    try {
      await visualizarPdf(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o PDF.");
    }
  }

  return (
    <>
      <PageHeader title="Histórico de envios" description="Todos os boletos que você confirmou como enviados." />

      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Buscar por cliente"
            aria-label="Buscar por cliente"
            className="h-11 pl-9"
          />
        </div>
        <Input
          value={competencia}
          onChange={(e) => setCompetencia(formatCompetenciaInput(e.target.value))}
          placeholder="Competência (MM/AAAA)"
          aria-label="Buscar por competência"
          inputMode="numeric"
          className="h-11"
        />
      </div>

      {lista.length === 0 ? (
        <div className="surface grid place-items-center px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/15 text-primary">
            <History className="size-6" />
          </span>
          <p className="mt-4 font-medium text-foreground">
            {envios.length === 0 ? "Nenhum envio registrado ainda." : "Nenhum envio encontrado."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {envios.length === 0
              ? "Os envios aparecem aqui depois que você confirmar no botão do WhatsApp."
              : "Tente outro cliente ou outra competência."}
          </p>
        </div>
      ) : (
        <>
          <div className="surface hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3.5 font-medium">Cliente</th>
                  <th className="px-5 py-3.5 font-medium">Competência</th>
                  <th className="px-5 py-3.5 font-medium">Valor</th>
                  <th className="px-5 py-3.5 font-medium">Data do envio</th>
                  <th className="px-5 py-3.5 font-medium">Status</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((e) => {
                  const st = statusEnvio(e.status);
                  return (
                    <tr key={e.id} className="hover:bg-accent/40">
                      <td className="px-5 py-3.5 font-medium text-foreground">{e.boletos?.clientes?.nome ?? "—"}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{e.boletos?.competencia ?? "—"}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{formatCurrency(e.boletos?.valor)}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                        {formatDateTime(e.enviado_em ?? e.created_at)}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={st.label} className={st.className} />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Button variant="ghost" size="icon" aria-label="Ver PDF" onClick={() => verPdf(e.boletos?.arquivo_path)}>
                          <Eye className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 md:hidden">
            {lista.map((e) => {
              const st = statusEnvio(e.status);
              return (
                <li key={e.id} className="surface flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{e.boletos?.clientes?.nome ?? "—"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {e.boletos?.competencia} · {formatDateTime(e.enviado_em ?? e.created_at)}
                    </p>
                  </div>
                  <StatusBadge label={st.label} className={st.className} />
                  <Button variant="ghost" size="icon" aria-label="Ver PDF" onClick={() => verPdf(e.boletos?.arquivo_path)}>
                    <Eye className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            {lista.length} {lista.length === 1 ? "envio" : "envios"}
          </p>
        </>
      )}
    </>
  );
}
