import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileUp, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUCKET_BOLETOS, ehPdf } from "@/lib/storage";
import { clientesQuery } from "@/lib/queries";
import { formatCNPJ, formatCurrency } from "@/lib/format";

type ImportItem = {
  id: string; lote_id: string; arquivo_path: string; status: string;
  cliente_id: string | null; boleto_id: string | null; extraido_json: Record<string, unknown> | null;
  erro: string | null; created_at: string;
};

export const Route = createFileRoute("/_authenticated/importacoes")({
  head: () => ({ meta: [{ title: "Importações em lote — MEI Fácil" }] }),
  component: ImportacoesPage,
});

function ImportacoesPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const { data: clients = [] } = useQuery(clientesQuery(""));
  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["mei-import-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mei_import_itens")
        .select("id,lote_id,arquivo_path,status,cliente_id,boleto_id,extraido_json,erro,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as ImportItem[];
    },
    refetchInterval: 15000,
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!files.length) throw new Error("Selecione ao menos um PDF.");
      if (files.length > 50) throw new Error("O limite por lote é de 50 PDFs.");
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name}: excede 10 MB.`);
        if (!(await ehPdf(f))) throw new Error(`${f.name}: não é um PDF válido.`);
      }
      const { data: lote, error: loteError } = await supabase.from("mei_import_lotes")
        .insert({ user_id: user.id, nome: `Importação ${new Date().toLocaleString("pt-BR")}`, total_itens: files.length })
        .select("id").single();
      if (loteError) throw loteError;
      const uploaded: string[] = [];
      try {
        const rows = [];
        for (const [i, file] of files.entries()) {
          const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
          const path = `${user.id}/importacoes/${lote.id}/${i}-${Date.now()}-${safe}`;
          const { error } = await supabase.storage.from(BUCKET_BOLETOS).upload(path, file, { contentType: "application/pdf", upsert: false });
          if (error) throw error;
          uploaded.push(path);
          rows.push({ lote_id: lote.id, user_id: user.id, arquivo_path: path, status: "aguardando_leitura" });
        }
        const { error: rowsError } = await supabase.from("mei_import_itens").insert(rows);
        if (rowsError) throw rowsError;
      } catch (e) {
        if (uploaded.length) await supabase.storage.from(BUCKET_BOLETOS).remove(uploaded);
        await supabase.from("mei_import_lotes").delete().eq("id", lote.id);
        throw e;
      }
      return lote.id;
    },
    onSuccess: () => {
      toast.success("PDFs enviados. A leitura será processada na fila.");
      setFiles([]);
      qc.invalidateQueries({ queryKey: ["mei-import-items"] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao importar PDFs."),
  });

  const saveReview = useMutation({
    mutationFn: async (item: ImportItem) => {
      const value = { ...(item.extraido_json ?? {}), ...(edits[item.id] ?? {}) };
      const cnpj = String(value.cnpj ?? "").replace(/\D/g, "");
      const competencia = String(value.competencia ?? "");
      const vencimento = String(value.vencimento ?? "");
      const valor = Number(String(value.valor ?? "").replace(",", "."));
      const clienteId = String(value.cliente_id ?? item.cliente_id ?? "");
      if (!/^\d{14}$/.test(cnpj) || !/^\d{2}\/\d{4}$/.test(competencia) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || !Number.isFinite(valor) || valor <= 0 || !clienteId) {
        throw new Error("Confira CNPJ, competência, vencimento, valor e cliente antes de aprovar.");
      }
      const client = clients.find(c => c.id === clienteId);
      if (!client || client.cnpj.replace(/\D/g, "") !== cnpj) {
        throw new Error("O CNPJ extraído não corresponde ao cliente selecionado.");
      }
      const { data: duplicate, error: dupError } = await supabase.from("boletos").select("id")
        .eq("cliente_id", clienteId).eq("competencia", competencia).limit(1);
      if (dupError) throw dupError;
      if (duplicate?.length) throw new Error("Já existe boleto para este cliente e competência.");
      const { data: boleto, error: boletoError } = await supabase.from("boletos").insert({
        cliente_id: clienteId, competencia, vencimento, valor, arquivo_path: item.arquivo_path,
        status: "pendente", user_id: user.id,
      }).select("id").single();
      if (boletoError) throw boletoError;
      const { error: sendError } = await supabase.from("envios").insert({
        boleto_id: boleto.id, user_id: user.id, status: "aprovado",
      });
      if (sendError) {
        await supabase.from("boletos").delete().eq("id", boleto.id);
        throw sendError;
      }
      const { error: itemError } = await supabase.from("mei_import_itens").update({
        status: "importado", cliente_id: clienteId, boleto_id: boleto.id, extraido_json: value, erro: null,
      }).eq("id", item.id);
      if (itemError) throw itemError;
    },
    onSuccess: () => {
      toast.success("Boleto aprovado e colocado na fila de envio.");
      qc.invalidateQueries({ queryKey: ["mei-import-items"] });
      qc.invalidateQueries({ queryKey: ["boletos"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível aprovar."),
  });

  const pending = useMemo(() => items.filter(i => !["importado", "duplicado"].includes(i.status)), [items]);
  const field = (item: ImportItem, key: string, fallback = "") =>
    edits[item.id]?.[key] ?? String(item.extraido_json?.[key] ?? fallback);
  const setField = (id: string, key: string, value: string) =>
    setEdits(old => ({ ...old, [id]: { ...(old[id] ?? {}), [key]: value } }));

  return (
    <>
      <PageHeader title="Importações em lote" description="Envie vários PDFs DAS de uma vez, revise os dados extraídos e aprove cada boleto." />
      <section className="surface mb-6 space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Nova importação</h2>
          <p className="text-sm text-muted-foreground">Até 50 PDFs por lote, com limite de 10 MB por arquivo.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="das-files">Arquivos PDF</Label>
          <Input id="das-files" type="file" accept="application/pdf,.pdf" multiple
            onChange={e => setFiles(Array.from(e.target.files ?? []))} />
          {files.length > 0 && <p className="text-sm text-muted-foreground">{files.length} arquivo(s) selecionado(s).</p>}
        </div>
        <Button variant="hero" disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          {upload.isPending ? "Enviando PDFs..." : "Enviar para processamento"}
        </Button>
      </section>

      <div className="mb-3 flex items-center justify-between">
        <div><h2 className="font-semibold">Fila de revisão</h2><p className="text-sm text-muted-foreground">{pending.length} item(ns) aguardando conclusão</p></div>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="size-4" /> Atualizar</Button>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando importações...</p> : items.length === 0 ? (
        <div className="surface p-8 text-center text-sm text-muted-foreground">Nenhum PDF importado ainda.</div>
      ) : <ul className="space-y-3">
        {items.map(item => {
          const extracted = item.extraido_json ?? {};
          const needsReview = ["revisao", "cliente_nao_identificado", "aguardando_aprovacao", "erro"].includes(item.status);
          return <li key={item.id} className="surface space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><p className="truncate font-medium">{item.arquivo_path.split("/").pop()}</p><p className="text-xs text-muted-foreground">Status: {item.status.replaceAll("_", " ")}</p></div>
              {item.status === "importado" ? <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="size-4" /> Aprovado</span> :
                <span className="flex items-center gap-1 text-sm text-amber-600"><AlertCircle className="size-4" /> Revisar</span>}
            </div>
            {item.erro && <p className="text-sm text-destructive">{item.erro}</p>}
            {needsReview && <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1"><Label>CNPJ extraído</Label><Input value={field(item, "cnpj")} onChange={e => setField(item.id, "cnpj", e.target.value)} placeholder="00.000.000/0000-00" /></div>
                <div className="space-y-1"><Label>Competência</Label><Input value={field(item, "competencia")} onChange={e => setField(item.id, "competencia", e.target.value)} placeholder="MM/AAAA" /></div>
                <div className="space-y-1"><Label>Valor (R$)</Label><Input value={field(item, "valor")} onChange={e => setField(item.id, "valor", e.target.value)} /></div>
                <div className="space-y-1"><Label>Vencimento</Label><Input type="date" value={field(item, "vencimento")} onChange={e => setField(item.id, "vencimento", e.target.value)} /></div>
                <div className="space-y-1 sm:col-span-2"><Label>Cliente correspondente</Label>
                  <Select value={field(item, "cliente_id", item.cliente_id ?? "")} onValueChange={v => setField(item.id, "cliente_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger><SelectContent>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.nome} · {formatCNPJ(c.cnpj)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {Array.isArray(extracted.missing_fields) && extracted.missing_fields.length > 0 &&
                <p className="text-xs text-amber-600">Campos não identificados: {(extracted.missing_fields as string[]).join(", ")}</p>}
              <Button variant="hero" size="sm" disabled={saveReview.isPending} onClick={() => saveReview.mutate(item)}>
                {saveReview.isPending ? "Salvando..." : "Aprovar boleto e enviar"}
              </Button>
            </>}
          </li>;
        })}
      </ul>}
    </>
  );
}
