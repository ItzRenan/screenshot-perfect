import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Eye, FileText, FileUp, MessageCircle, MoreVertical, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { BoletoImportDialog } from "@/components/app/BoletoImportDialog";
import { BoletoBatchImportDialog } from "@/components/app/BoletoBatchImportDialog";
import { WhatsAppDialog } from "@/components/app/WhatsAppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { boletosQuery, type BoletoComCliente } from "@/lib/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { STATUS_BOLETO, statusBoleto, type StatusBoleto } from "@/lib/status";
import { BUCKET_BOLETOS, baixarPdf, visualizarPdf } from "@/lib/storage";
import { mensagemDeErro } from "@/lib/errors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/boletos")({
  head: () => ({
    meta: [
      { title: "Boletos DAS — MEI Fácil" },
      { name: "description", content: "Importe, confira e envie os boletos DAS dos seus clientes MEI." },
      { property: "og:title", content: "Boletos DAS — MEI Fácil" },
      { property: "og:description", content: "Importe, confira e envie os boletos DAS dos seus clientes MEI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(boletosQuery()),
  pendingComponent: () => <p className="text-sm text-muted-foreground">Carregando boletos...</p>,
  errorComponent: ({ error }) => (
    <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error instanceof Error ? error.message : "Não foi possível carregar os boletos."}
    </p>
  ),
  component: BoletosPage,
});

const FILTROS: { value: StatusBoleto | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "pendente", label: "Pendentes" },
  { value: "conferido", label: "Conferidos" },
  { value: "enviado", label: "Enviados" },
];

function BoletosPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: boletos } = useSuspenseQuery(boletosQuery());
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<StatusBoleto | "todos">("todos");
  const [importar, setImportar] = useState(false);
  const [importarLote, setImportarLote] = useState(false);
  const [enviando, setEnviando] = useState<BoletoComCliente | null>(null);
  const [excluindo, setExcluindo] = useState<BoletoComCliente | null>(null);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return boletos.filter((b) => {
      if (filtro !== "todos" && statusBoleto(b.status) !== filtro) return false;
      if (!termo) return true;
      return (b.clientes?.nome ?? "").toLowerCase().includes(termo) || b.competencia.includes(termo);
    });
  }, [boletos, busca, filtro]);

  const mudarStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusBoleto }) => {
      const { error } = await supabase.from("boletos").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(`Boleto marcado como ${STATUS_BOLETO[v.status].label.toLowerCase()}.`);
      queryClient.invalidateQueries({ queryKey: ["boletos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: { code?: string | undefined; message?: string | undefined }) =>
      toast.error(mensagemDeErro(e, "Não foi possível alterar o status.")),
  });

  const excluir = useMutation({
    mutationFn: async (b: BoletoComCliente) => {
      const { error } = await supabase.from("boletos").delete().eq("id", b.id);
      if (error) throw error;
      if (b.arquivo_path) {
        const { error: errArq } = await supabase.storage.from(BUCKET_BOLETOS).remove([b.arquivo_path]);
        if (errArq) console.error(errArq);
      }
    },
    onSuccess: () => {
      toast.success("Boleto excluído.");
      for (const key of ["boletos", "historico", "dashboard"]) queryClient.invalidateQueries({ queryKey: [key] });
      setExcluindo(null);
    },
    onError: (e: { code?: string | undefined; message?: string | undefined }) =>
      toast.error(mensagemDeErro(e, "Não foi possível excluir o boleto.")),
  });

  async function acaoPdf(b: BoletoComCliente, tipo: "ver" | "baixar") {
    if (!b.arquivo_path) {
      toast.error("Este boleto não tem PDF anexado.");
      return;
    }
    try {
      if (tipo === "ver") await visualizarPdf(b.arquivo_path);
      else await baixarPdf(b.arquivo_path, b.clientes?.nome ?? "cliente", b.competencia);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o PDF.");
    }
  }

  return (
    <>
      <PageHeader
        title="Boletos DAS"
        description="Importe os PDFs, confira os dados e envie pelo WhatsApp."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportarLote(true)}>
              <FileUp className="size-4" />
              Importar em lote
            </Button>
            <Button variant="hero" onClick={() => setImportar(true)}>
              <FileUp className="size-4" />
              Importar boleto
            </Button>
          </div>
        }
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar por cliente ou competência"
            aria-label="Pesquisar boletos"
            className="h-11 pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1">
          {FILTROS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFiltro(f.value)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                filtro === f.value && "bg-accent text-accent-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {lista.length === 0 ? (
        <div className="surface grid place-items-center px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/15 text-primary">
            <FileText className="size-6" />
          </span>
          <p className="mt-4 font-medium text-foreground">
            {boletos.length === 0 ? "Nenhum boleto importado ainda." : "Nenhum boleto encontrado."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {boletos.length === 0 ? "Importe o PDF do DAS para começar." : "Tente outra busca ou outro filtro."}
          </p>
          {boletos.length === 0 && (
            <Button variant="hero" className="mt-5" onClick={() => setImportar(true)}>
              <FileUp className="size-4" />
              Importar boleto
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {lista.map((b) => {
            const st = STATUS_BOLETO[statusBoleto(b.status)];
            return (
              <li key={b.id} className="surface flex flex-col gap-4 p-4 md:flex-row md:items-center md:p-5">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                    <FileText className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{b.clientes?.nome ?? "Cliente removido"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Competência {b.competencia} · Vence {formatDate(b.vencimento)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 md:justify-end">
                  <p className="font-display text-base font-semibold tabular-nums text-foreground">{formatCurrency(b.valor)}</p>
                  <StatusBadge label={st.label} className={st.className} />
                  <div className="flex items-center gap-1">
                    <Button variant="success" size="sm" onClick={() => setEnviando(b)}>
                      <MessageCircle className="size-4" />
                      <span className="hidden sm:inline">Enviar pelo WhatsApp</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Mais ações">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => acaoPdf(b, "ver")}>
                          <Eye className="size-4" /> Visualizar PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => acaoPdf(b, "baixar")}>
                          <Download className="size-4" /> Baixar PDF
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {statusBoleto(b.status) !== "pendente" && (
                          <DropdownMenuItem onClick={() => mudarStatus.mutate({ id: b.id, status: "pendente" })}>
                            Marcar como pendente
                          </DropdownMenuItem>
                        )}
                        {statusBoleto(b.status) !== "conferido" && (
                          <DropdownMenuItem onClick={() => mudarStatus.mutate({ id: b.id, status: "conferido" })}>
                            Marcar como conferido
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setExcluindo(b)}>
                          <Trash2 className="size-4" /> Excluir boleto
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <BoletoImportDialog open={importar} onOpenChange={setImportar} userId={user.id} />
      <BoletoBatchImportDialog open={importarLote} onOpenChange={setImportarLote} userId={user.id} />
      <WhatsAppDialog boleto={enviando} onOpenChange={(o) => !o && setEnviando(null)} />

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir boleto?</AlertDialogTitle>
            <AlertDialogDescription>
              O boleto de {excluindo?.clientes?.nome} ({excluindo?.competencia}), o PDF e o histórico de envios dele serão
              apagados. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={excluir.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (excluindo) excluir.mutate(excluindo);
              }}
            >
              {excluir.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
