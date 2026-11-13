import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Clock3, FileText, Send, UserPlus, Users } from "lucide-react";
import type { ComponentType } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { dashboardQuery, type Atividade } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel — MEI Fácil" },
      { name: "description", content: "Resumo de clientes MEI e boletos DAS da competência atual." },
      { property: "og:title", content: "Painel — MEI Fácil" },
      { property: "og:description", content: "Resumo de clientes MEI e boletos DAS da competência atual." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery()),
  pendingComponent: () => <p className="text-sm text-muted-foreground">Carregando painel...</p>,
  errorComponent: ({ error }) => (
    <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error.message}
    </p>
  ),
  component: Painel,
});

function Painel() {
  const { data } = useSuspenseQuery(dashboardQuery());

  const stats: { label: string; value: number; icon: ComponentType<{ className?: string }>; tone: string }[] = [
    { label: "Clientes cadastrados", value: data.totalClientes, icon: Users, tone: "text-primary bg-primary/15" },
    { label: `Boletos de ${data.competencia}`, value: data.boletosCompetencia, icon: CalendarClock, tone: "text-primary-glow bg-primary-glow/15" },
    { label: "Boletos pendentes", value: data.pendentes, icon: Clock3, tone: "text-warning bg-warning/15" },
    { label: "Boletos enviados", value: data.enviados, icon: CheckCircle2, tone: "text-success bg-success/15" },
  ];

  return (
    <>
      <PageHeader
        title="Painel"
        description={`Competência atual: ${data.competencia}`}
        action={
          <Button asChild variant="hero">
            <Link to="/clientes">
              <UserPlus className="size-4" />
              Gerenciar clientes
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-5 lg:grid-cols-4">
        {stats.map((s, i) => (
          <div key={s.label} className="surface animate-rise p-4 md:p-5" style={{ animationDelay: `${i * 60}ms` }}>
            <span className={cn("grid size-10 place-items-center rounded-lg", s.tone)}>
              <s.icon className="size-5" />
            </span>
            <p className="mt-4 font-display text-3xl font-semibold text-foreground">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground md:text-sm">{s.label}</p>
          </div>
        ))}
      </div>

      <section className="surface mt-6 p-5 md:p-7">
        <h2 className="text-lg font-semibold text-foreground">Histórico de atividades</h2>
        {data.atividades.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/clientes">Cadastrar o primeiro cliente</Link>
            </Button>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-border">
            {data.atividades.map((a) => (
              <AtividadeItem key={a.id} atividade={a} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const ICONES = { cliente: Users, boleto: FileText, envio: Send } as const;

function AtividadeItem({ atividade }: { atividade: Atividade }) {
  const Icon = ICONES[atividade.tipo];
  return (
    <li className="flex items-center gap-4 py-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{atividade.titulo}</p>
        <p className="truncate text-xs text-muted-foreground">{atividade.detalhe}</p>
      </div>
      <time className="shrink-0 text-xs text-muted-foreground">{formatDateTime(atividade.data)}</time>
    </li>
  );
}
