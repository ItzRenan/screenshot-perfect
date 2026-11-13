import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCNPJ, formatPhone, isValidCNPJ, isValidPhone, onlyDigits } from "@/lib/format";
import { mensagemDeErro } from "@/lib/errors";
import type { Cliente } from "@/lib/queries";

type Erros = Partial<Record<"nome" | "cnpj" | "telefone", string>>;

export function ClienteDialog({
  open,
  onOpenChange,
  cliente,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cliente: Cliente | null;
}) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erros, setErros] = useState<Erros>({});

  useEffect(() => {
    if (!open) return;
    setNome(cliente?.nome ?? "");
    setCnpj(cliente ? formatCNPJ(cliente.cnpj) : "");
    setTelefone(cliente ? formatPhone(cliente.telefone) : "");
    setErros({});
  }, [open, cliente]);

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = { nome: nome.trim(), cnpj: onlyDigits(cnpj), telefone: onlyDigits(telefone) };

      const { data: existente, error: errBusca } = await supabase
        .from("clientes")
        .select("id")
        .eq("cnpj", dados.cnpj)
        .maybeSingle();
      if (errBusca) throw errBusca;
      if (existente && existente.id !== cliente?.id) {
        throw { code: "cnpj-duplicado" };
      }

      const { error } = cliente
        ? await supabase.from("clientes").update(dados).eq("id", cliente.id)
        : await supabase.from("clientes").insert(dados);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(cliente ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
    },
    onError: (error: { code?: string; message?: string }) => {
      console.error(error);
      if (error.code === "cnpj-duplicado" || error.code === "23505") {
        setErros({ cnpj: "Já existe um cliente com este CNPJ." });
        toast.error("Já existe um cliente com este CNPJ.");
        return;
      }
      toast.error(mensagemDeErro(error, "Não foi possível salvar o cliente."));
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const novos: Erros = {};
    if (nome.trim().length < 3) novos.nome = "Informe o nome completo (mínimo 3 letras).";
    if (!isValidCNPJ(cnpj)) novos.cnpj = "CNPJ inválido. Confira os 14 dígitos.";
    if (!isValidPhone(telefone)) novos.telefone = "Telefone inválido. Use DDD + número, ex.: (85) 98765-4321.";
    setErros(novos);
    if (Object.keys(novos).length) return;
    salvar.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar cliente" : "Novo cliente MEI"}</DialogTitle>
          <DialogDescription>
            O telefone será usado para enviar os boletos pelo WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <Campo id="nome" label="Nome" erro={erros.nome}>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" maxLength={120} />
          </Campo>
          <Campo id="cnpj" label="CNPJ" erro={erros.cnpj}>
            <Input
              id="cnpj"
              inputMode="numeric"
              value={cnpj}
              onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
            />
          </Campo>
          <Campo id="telefone" label="Telefone (WhatsApp)" erro={erros.telefone}>
            <Input
              id="telefone"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(formatPhone(e.target.value))}
              placeholder="(00) 00000-0000"
            />
          </Campo>
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
              {cliente ? "Salvar alterações" : "Cadastrar cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ id, label, erro, children }: { id: string; label: string; erro?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
