import { useMemo, useState } from "react";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clientesQuery } from "@/lib/queries";
import { competenciaDe, formatCNPJ, isValidCompetencia, parseValorBRL, vencimentoPadrao } from "@/lib/format";
import { BUCKET_BOLETOS, ehPdf } from "@/lib/storage";
import { extrairDadosDAS } from "@/lib/das-pdf";
import { onlyDigits } from "@/lib/format";

const MAX_BYTES = 10 * 1024 * 1024;
type Linha = { id: string; file: File; clienteId: string; competencia: string; valor: string; vencimento: string; erro?: string; aviso?: string };

export function BoletoBatchImportDialog({ open, onOpenChange, userId }: { open: boolean; onOpenChange: (open: boolean) => void; userId: string }) {
  const queryClient = useQueryClient();
  const { data: clientes = [] } = useQuery(clientesQuery(""));
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);
  const competenciaAtual = useMemo(() => competenciaDe(new Date()), []);

  function atualizar(id: string, patch: Partial<Linha>) {
    setLinhas((atual) => atual.map((l) => l.id === id ? { ...l, ...patch, erro: undefined } : l));
  }

  async function selecionar(files: FileList | null) {
    if (!files) return;
    const novas = await Promise.all(Array.from(files).map(async (file) => {
      const linha: Linha = {
        id: crypto.randomUUID(), file, clienteId: "", competencia: competenciaAtual, valor: "",
        vencimento: vencimentoPadrao(competenciaAtual, 20),
      };
      if (file.size > MAX_BYTES || !(await ehPdf(file))) {
        linha.aviso = file.size > MAX_BYTES ? "Arquivo acima de 10 MB." : "Arquivo não é um PDF válido.";
        return linha;
      }
      try {
        const dados = await extrairDadosDAS(file);
        if (!dados.textoEncontrado) {
          linha.aviso = "O PDF não possui texto selecionável. Preencha os dados manualmente.";
          return linha;
        }
        if (dados.cnpj) {
          const correspondentes = clientes.filter((cliente) => onlyDigits(cliente.cnpj) === onlyDigits(dados.cnpj!));
          if (correspondentes.length === 1) linha.clienteId = correspondentes[0].id;
          else if (correspondentes.length > 1) linha.aviso = "CNPJ encontrado, mas há mais de um cadastro correspondente.";
          else linha.aviso = "CNPJ extraído, mas não existe cliente cadastrado com esse documento.";
        } else {
          linha.aviso = "Não foi possível identificar um CNPJ válido no PDF.";
        }
        if (dados.competencia) linha.competencia = dados.competencia;
        if (dados.valor) linha.valor = dados.valor;
        if (dados.vencimento) linha.vencimento = dados.vencimento;
        if (!dados.competencia || !dados.valor || !dados.vencimento) {
          linha.aviso = [linha.aviso, "Alguns campos não foram identificados; confira antes de importar."].filter(Boolean).join(" ");
        }
      } catch {
        linha.aviso = "Não foi possível ler este PDF. Confira os dados manualmente.";
      }
      return linha;
    }));
    setLinhas((atual) => [...atual, ...novas]);
  }

  async function importar() {
    if (!linhas.length || salvando) return;
    setSalvando(true);
    const falhas: Linha[] = [];
    let sucesso = 0;
    try {
      for (const linha of linhas) {
        const valor = parseValorBRL(linha.valor);
        let erro = "";
        if (!linha.clienteId) erro = "Selecione o cliente.";
        else if (!isValidCompetencia(linha.competencia)) erro = "Competência inválida (MM/AAAA).";
        else if (valor == null || valor <= 0) erro = "Informe um valor válido.";
        else if (!linha.vencimento) erro = "Informe o vencimento.";
        else if (linha.file.size > MAX_BYTES) erro = "PDF acima de 10 MB.";
        else if (!(await ehPdf(linha.file))) erro = "Arquivo não é um PDF válido.";

        if (erro) { falhas.push({ ...linha, erro }); continue; }

        const { data: duplicado, error: erroDup } = await supabase.from("boletos").select("id")
          .eq("cliente_id", linha.clienteId).eq("competencia", linha.competencia).limit(1);
        if (erroDup) { falhas.push({ ...linha, erro: "Falha ao verificar duplicidade." }); continue; }
        if (duplicado?.length) { falhas.push({ ...linha, erro: "Já existe boleto deste cliente nesta competência." }); continue; }

        const path = `${userId}/${linha.clienteId}/${linha.competencia.replace("/", "-")}-${Date.now()}-${linha.id}.pdf`;
        const { error: uploadError } = await supabase.storage.from(BUCKET_BOLETOS).upload(path, linha.file, { contentType: "application/pdf", upsert: false });
        if (uploadError) { falhas.push({ ...linha, erro: "Falha no upload do PDF." }); continue; }

        const { error: insertError } = await supabase.from("boletos").insert({
          cliente_id: linha.clienteId, competencia: linha.competencia, valor: valor!, vencimento: linha.vencimento,
          arquivo_path: path, status: "pendente",
        });
        if (insertError) {
          await supabase.storage.from(BUCKET_BOLETOS).remove([path]);
          falhas.push({ ...linha, erro: "Falha ao gravar o boleto." });
          continue;
        }
        sucesso++;
      }
      setLinhas(falhas);
      if (sucesso) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["boletos"] }),
          queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        ]);
        toast.success(`${sucesso} boleto(s) importado(s).`);
      }
      if (falhas.length) toast.warning(`${falhas.length} arquivo(s) precisam de correção.`);
      else onOpenChange(false);
    } catch {
      toast.error("Ocorreu um erro durante a importação. Os itens restantes foram mantidos para revisão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!salvando) { onOpenChange(value); if (!value) setLinhas([]); } }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importação de boletos em lote</DialogTitle>
          <DialogDescription>Selecione vários PDFs. O sistema tenta identificar CNPJ, competência, valor e vencimento automaticamente; revise todos os campos antes de salvar.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-muted/40 p-5 text-sm hover:bg-accent/40">
          <FileUp className="size-5 text-primary" /> Selecionar vários PDFs
          <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(e) => selecionar(e.target.files)} />
        </label>
        {linhas.length > 0 && <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{linhas.length} arquivo(s) na fila</p>
          {linhas.map((linha) => (
            <div key={linha.id} className="rounded-lg border border-border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{linha.file.name}</p>
                <Button type="button" variant="ghost" size="icon" aria-label="Remover arquivo" onClick={() => setLinhas((atual) => atual.filter((l) => l.id !== linha.id))}><Trash2 className="size-4" /></Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <Select value={linha.clienteId} onValueChange={(v) => atualizar(linha.id, { clienteId: v })}>
                  <SelectTrigger aria-label="Cliente"><SelectValue placeholder="Cliente" /></SelectTrigger>
                  <SelectContent>{clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} · {formatCNPJ(c.cnpj)}</SelectItem>)}</SelectContent>
                </Select>
                <Input aria-label="Competência" placeholder="MM/AAAA" value={linha.competencia} onChange={(e) => atualizar(linha.id, { competencia: e.target.value })} />
                <Input aria-label="Valor" placeholder="Valor (ex.: 75,90)" value={linha.valor} onChange={(e) => atualizar(linha.id, { valor: e.target.value })} />
                <Input aria-label="Vencimento" type="date" value={linha.vencimento} onChange={(e) => atualizar(linha.id, { vencimento: e.target.value })} />
              </div>
              {linha.aviso && <p className="mt-2 text-xs text-muted-foreground">{linha.aviso}</p>}{linha.erro && <p className="mt-2 text-xs text-destructive">{linha.erro}</p>}
            </div>
          ))}
        </div>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" disabled={salvando} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" variant="hero" disabled={salvando || linhas.length === 0 || clientes.length === 0} onClick={importar}>
            {salvando && <Loader2 className="size-4 animate-spin" />}
            {salvando ? "Importando..." : `Importar ${linhas.length} arquivo(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
