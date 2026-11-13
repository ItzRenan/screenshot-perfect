import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clientesQuery, configuracoesQuery } from "@/lib/queries";
import {
  competenciaDe,
  formatCNPJ,
  formatCompetenciaInput,
  isValidCompetencia,
  parseValorBRL,
  vencimentoPadrao,
} from "@/lib/format";
import { BUCKET_BOLETOS, ehPdf } from "@/lib/storage";
import { mensagemDeErro } from "@/lib/errors";

const MAX_BYTES = 10 * 1024 * 1024;
type Erros = Partial<Record<"arquivo" | "cliente" | "competencia" | "valor" | "vencimento", string>>;

export function BoletoImportDialog({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const { data: clientes = [] } = useQuery(clientesQuery(""));
  const { data: config } = useQuery(configuracoesQuery());
  const fileRef = useRef<HTMLInputElement>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [clienteId, setClienteId] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [vencEditado, setVencEditado] = useState(false);
  const [erros, setErros] = useState<Erros>({});

  const dia = config?.dia_vencimento_padrao ?? 20;

  useEffect(() => {
    if (!open) return;
    const atual = competenciaDe(new Date());
    setArquivo(null);
    setClienteId("");
    setCompetencia(atual);
    setValor("");
    setVencimento(vencimentoPadrao(atual, dia));
    setVencEditado(false);
    setErros({});
    if (fileRef.current) fileRef.current.value = "";
  }, [open, dia]);

  function mudarCompetencia(v: string) {
    const masked = formatCompetenciaInput(v);
    setCompetencia(masked);
    if (!vencEditado && isValidCompetencia(masked)) setVencimento(vencimentoPadrao(masked, dia));
  }

  const salvar = useMutation({
    mutationFn: async (dados: { file: File; valor: number }) => {
      const { data: existente, error: errDup } = await supabase
        .from("boletos")
        .select("id")
        .eq("cliente_id", clienteId)
        .eq("competencia", competencia)
        .limit(1);
      if (errDup) throw errDup;
      if (existente && existente.length > 0) throw { code: "boleto-duplicado" };

      const path = `${userId}/${clienteId}/${competencia.replace("/", "-")}-${Date.now()}.pdf`;
      const { error: errUp } = await supabase.storage
        .from(BUCKET_BOLETOS)
        .upload(path, dados.file, { contentType: "application/pdf", upsert: false });
      if (errUp) throw { code: "upload", message: errUp.message };

      const { error } = await supabase.from("boletos").insert({
        cliente_id: clienteId,
        competencia,
        valor: dados.valor,
        vencimento,
        arquivo_path: path,
        status: "pendente",
      });
      if (error) {
        await supabase.storage.from(BUCKET_BOLETOS).remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Boleto importado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["boletos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    },
    onError: (error: { code?: string | undefined; message?: string | undefined }) => {
      console.error(error);
      if (error.code === "boleto-duplicado") {
        setErros({ competencia: "Este cliente já tem um boleto nesta competência." });
        toast.error("Este cliente já tem um boleto cadastrado nesta competência.");
        return;
      }
      if (error.code === "upload") {
        toast.error(
          /exceeded|too large|size/i.test(error.message ?? "")
            ? "O PDF é maior que 10 MB."
            : "Não foi possível enviar o PDF. Tente novamente.",
        );
        return;
      }
      toast.error(mensagemDeErro(error, "Não foi possível salvar o boleto."));
    },
  });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const novos: Erros = {};
    const v = parseValorBRL(valor);
    if (!arquivo) novos.arquivo = "Selecione o PDF do DAS.";
    else if (arquivo.size > MAX_BYTES) novos.arquivo = "O PDF deve ter no máximo 10 MB.";
    else if (!(await ehPdf(arquivo))) novos.arquivo = "O arquivo selecionado não é um PDF válido.";
    if (!clienteId) novos.cliente = "Selecione o cliente.";
    if (!isValidCompetencia(competencia)) novos.competencia = "Informe a competência no formato MM/AAAA.";
    if (v == null || v <= 0) novos.valor = "Informe um valor válido, ex.: 75,90.";
    if (!vencimento) novos.vencimento = "Informe a data de vencimento.";
    setErros(novos);
    if (Object.keys(novos).length || !arquivo || v == null) return;
    salvar.mutate({ file: arquivo, valor: v });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar boleto DAS</DialogTitle>
          <DialogDescription>O PDF fica guardado de forma privada e só você pode acessá-lo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <Campo label="Arquivo PDF" htmlFor="arquivo" erro={erros.arquivo}>
            <label
              htmlFor="arquivo"
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input bg-muted/40 px-4 py-4 text-sm transition-colors hover:border-primary/60 hover:bg-accent/40"
            >
              <FileUp className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 truncate text-muted-foreground">
                {arquivo ? arquivo.name : "Clique para selecionar o PDF (até 10 MB)"}
              </span>
            </label>
            <input
              ref={fileRef}
              id="arquivo"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </Campo>

          <Campo label="Cliente" erro={erros.cliente}>
            {clientes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Cadastre um cliente antes de importar boletos.</p>
            ) : (
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger aria-label="Cliente">
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {formatCNPJ(c.cnpj)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo label="Competência" htmlFor="competencia" erro={erros.competencia}>
              <Input
                id="competencia"
                inputMode="numeric"
                placeholder="MM/AAAA"
                value={competencia}
                onChange={(e) => mudarCompetencia(e.target.value)}
              />
            </Campo>
            <Campo label="Valor (R$)" htmlFor="valor" erro={erros.valor}>
              <Input id="valor" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            </Campo>
            <Campo label="Vencimento" htmlFor="vencimento" erro={erros.vencimento}>
              <Input
                id="vencimento"
                type="date"
                value={vencimento}
                onChange={(e) => {
                  setVencimento(e.target.value);
                  setVencEditado(true);
                }}
              />
            </Campo>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={salvar.isPending || clientes.length === 0}>
              {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
              {salvar.isPending ? "Enviando..." : "Importar boleto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  label,
  htmlFor,
  erro,
  children,
}: {
  label: string;
  htmlFor?: string | undefined;
  erro?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
