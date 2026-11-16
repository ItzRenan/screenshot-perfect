import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, Download, FilePlus2, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { clientesQuery, type Cliente } from "@/lib/queries";
import { formatCNPJ } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type MeiJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "paid" | "failed";
  error_message?: string | null;
  result?: { stage?: string; message?: string; mensagem?: string } | null;
  storage_path?: string | null;
  boleto_id?: string | null;
  competencia?: string;
  created_at?: string;
};

type EdgeInvoker = {
  invoke: (name: string, options: { body: Record<string, string> }) =>
    Promise<{ data: unknown; error: { message: string } | null }>;
};

async function chamarMeiJobs(body: Record<string, string>) {
  const functions = supabase.functions as unknown as EdgeInvoker;
  const { data, error } = await functions.invoke("mei-jobs", { body });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") throw new Error("Resposta inválida do serviço MEI.");
  const payload = data as Record<string, unknown>;
  if (typeof payload.error === "string") throw new Error(payload.error);
  return payload;
}

function competenciaAtual() {
  const hoje = new Date();
  return String(hoje.getMonth() + 1).padStart(2, "0") + "/" + hoje.getFullYear();
}

function statusLabel(job?: MeiJob) {
  if (!job) return "Preparando solicitação";
  if (job.status === "pending") return "Na fila de processamento";
  if (job.status === "processing") {
    const stage = job.result?.stage;
    if (stage === "awaiting_user") return "Aguardando validação manual";
    if (stage === "validating_pdf") return "Conferindo o PDF do DAS";
    if (stage === "processing_pgmei") return "Consultando o PGMEI";
    return "Processando solicitação";
  }
  if (job.status === "completed") return "DAS emitido";
  if (job.status === "paid") return "Competência já consta como paga";
  return "Não foi possível concluir";
}

export function MeiEmissionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [clienteId, setClienteId] = useState("");
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: clientes = [], isLoading: carregandoClientes } = useQuery(clientesQuery(""));

  const clienteSelecionado = useMemo(
    () => clientes.find((cliente) => cliente.id === clienteId),
    [clientes, clienteId],
  );

  const solicitar = useMutation({
    mutationFn: async () => {
      if (!clienteId) throw new Error("Selecione um cliente.");
      if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(competencia)) {
        throw new Error("Informe a competência no formato MM/AAAA.");
      }
      const payload = await chamarMeiJobs({ action: "create", clienteId, competencia });
      if (typeof payload.id !== "string") throw new Error("O serviço não retornou o identificador da solicitação.");
      return payload.id;
    },
    onSuccess: (id) => {
      setJobId(id);
      toast.success("Solicitação de emissão enviada.");
      queryClient.invalidateQueries({ queryKey: ["mei-jobs"] });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível solicitar a emissão."),
  });

  const continuar = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Solicitação não informada.");
      return chamarMeiJobs({ action: "continue", jobId });
    },
    onSuccess: () => {
      toast.success("Continuação iniciada. O worker está processando o DAS.");
      void consulta.refetch();
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível continuar a emissão."),
  });

  const consulta = useQuery({
    queryKey: ["mei-jobs", jobId],
    queryFn: async () => {
      if (!jobId) throw new Error("Solicitação não informada.");
      const payload = await chamarMeiJobs({ action: "status", jobId });
      return payload as unknown as MeiJob;
    },
    enabled: Boolean(jobId && open),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "paid" || status === "failed" ? false : 4000;
    },
    refetchIntervalInBackground: false,
  });

  async function baixarPdf() {
    if (!jobId) return;
    try {
      const payload = await chamarMeiJobs({ action: "file", jobId });
      if (typeof payload.url !== "string") throw new Error("O serviço não retornou o link do PDF.");
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível obter o PDF.");
    }
  }

  function fechar() {
    onOpenChange(false);
    if (consulta.data?.status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["boletos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }

  const job = consulta.data;
  const concluido = job?.status === "completed";
  const pago = job?.status === "paid";
  const falhou = job?.status === "failed";
  const aguardandoValidacao = job?.status === "processing" && job.result?.stage === "awaiting_user";

  return (
    <Dialog open={open} onOpenChange={(value) => value ? onOpenChange(true) : fechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-5 text-primary" /> Emitir DAS pelo PGMEI
          </DialogTitle>
          <DialogDescription>
            Solicite a emissão, acompanhe o processamento e acesse o PDF quando estiver disponível.
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="mei-cliente">Cliente</label>
              <Select value={clienteId} onValueChange={setClienteId} disabled={carregandoClientes || solicitar.isPending}>
                <SelectTrigger id="mei-cliente">
                  <SelectValue placeholder={carregandoClientes ? "Carregando clientes..." : "Selecione um cliente"} />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((cliente: Cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nome} · {formatCNPJ(cliente.cnpj)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {clientes.length === 0 && !carregandoClientes && (
                <p className="text-xs text-muted-foreground">Cadastre um cliente antes de solicitar a emissão.</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="mei-competencia">Competência</label>
              <Input
                id="mei-competencia"
                value={competencia}
                onChange={(event) => setCompetencia(event.target.value)}
                placeholder="MM/AAAA"
                maxLength={7}
                disabled={solicitar.isPending}
              />
              <p className="text-xs text-muted-foreground">Informe a competência que deseja emitir, no formato mês/ano.</p>
            </div>
            {clienteSelecionado && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{clienteSelecionado.nome}</p>
                <p className="text-muted-foreground">CNPJ {formatCNPJ(clienteSelecionado.cnpj)}</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={fechar} disabled={solicitar.isPending}>Cancelar</Button>
              <Button onClick={() => solicitar.mutate()} disabled={!clienteId || !/^(0[1-9]|1[0-2])\/\d{4}$/.test(competencia) || solicitar.isPending}>
                {solicitar.isPending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
                Solicitar emissão
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                {consulta.isLoading || consulta.isFetching ? (
                  <Loader2 className="mt-0.5 size-5 animate-spin text-primary" />
                ) : concluido || pago ? (
                  <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
                ) : falhou ? (
                  <AlertCircle className="mt-0.5 size-5 text-destructive" />
                ) : (
                  <Clock3 className="mt-0.5 size-5 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{statusLabel(job)}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">Solicitação {jobId}</p>
                  {clienteSelecionado && <p className="mt-1 text-sm text-muted-foreground">{clienteSelecionado.nome} · {competencia}</p>}
                  {job?.error_message && <p className="mt-2 text-sm text-destructive">{job.error_message}</p>}
                  {job?.result?.message && <p className="mt-2 text-sm text-muted-foreground">{job.result.message}</p>}
                  {job?.result?.mensagem && <p className="mt-2 text-sm text-muted-foreground">{job.result.mensagem}</p>}
                </div>
              </div>
            </div>

            {aguardandoValidacao && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <p className="font-medium">Validação manual necessária</p>
                <p className="mt-1 text-muted-foreground">
                  A Receita solicitou uma validação na sessão do navegador. O operador responsável precisa concluir essa etapa antes de continuar a emissão.
                </p>
              </div>
            )}
            {concluido && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                O PDF foi validado e registrado na área de boletos.
              </div>
            )}
            {pago && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                O PGMEI informou que esta competência já consta como paga. Nenhum novo boleto foi registrado.
              </div>
            )}
            {falhou && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                A solicitação não foi concluída. Confira a mensagem acima antes de tentar novamente.
              </div>
            )}
            {consulta.isError && (
              <p role="alert" className="text-sm text-destructive">{consulta.error.message}</p>
            )}
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              {aguardandoValidacao && (
                <Button onClick={() => continuar.mutate()} disabled={continuar.isPending}>
                  {continuar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Continuar após validação
                </Button>
              )}
              {concluido && <Button onClick={baixarPdf}><Download className="size-4" /> Abrir PDF</Button>}
              {!concluido && !pago && !falhou && (
                <Button variant="outline" onClick={() => consulta.refetch()} disabled={consulta.isFetching}>
                  {consulta.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Atualizar status
                </Button>
              )}
              <Button variant="outline" onClick={fechar}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
