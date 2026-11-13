import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ClienteDialog } from "@/components/app/ClienteDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { clientesQuery, type Cliente } from "@/lib/queries";
import { formatCNPJ, formatPhone } from "@/lib/format";
import { mensagemDeErro } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes MEI — MEI Fácil" },
      { name: "description", content: "Cadastre, edite e pesquise seus clientes MEI por nome ou CNPJ." },
      { property: "og:title", content: "Clientes MEI — MEI Fácil" },
      { property: "og:description", content: "Cadastre, edite e pesquise seus clientes MEI por nome ou CNPJ." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(clientesQuery("")),
  component: ClientesPage,
});

function ClientesPage() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [excluindo, setExcluindo] = useState<Cliente | null>(null);

  const { data: clientes = [], isFetching, error } = useQuery(clientesQuery(busca));

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clientes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente excluído.");
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setExcluindo(null);
    },
    onError: (err: { code?: string; message?: string }) => {
      console.error(err);
      toast.error(
        err.code === "23503"
          ? "Este cliente possui boletos vinculados e não pode ser excluído."
          : mensagemDeErro(err, "Não foi possível excluir o cliente."),
      );
    },
  });

  function novo() {
    setEditando(null);
    setDialogAberto(true);
  }

  function editar(c: Cliente) {
    setEditando(c);
    setDialogAberto(true);
  }

  return (
    <>
      <PageHeader
        title="Clientes MEI"
        description="Cadastre os clientes que recebem os boletos DAS."
        action={
          <Button variant="hero" onClick={novo}>
            <Plus className="size-4" />
            Novo cliente
          </Button>
        }
      />

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Pesquisar por nome ou CNPJ"
          aria-label="Pesquisar clientes"
          className="h-11 pl-9"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error.message}
        </p>
      ) : clientes.length === 0 ? (
        <div className="surface grid place-items-center px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/15 text-primary">
            <Users className="size-6" />
          </span>
          <p className="mt-4 font-medium text-foreground">
            {busca ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {busca ? "Tente outro nome ou CNPJ." : "Cadastre o primeiro cliente para começar."}
          </p>
          {!busca && (
            <Button variant="hero" className="mt-5" onClick={novo}>
              <Plus className="size-4" />
              Cadastrar cliente
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Tabela (computador) */}
          <div className="surface hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3.5 font-medium">Nome</th>
                  <th className="px-5 py-3.5 font-medium">CNPJ</th>
                  <th className="px-5 py-3.5 font-medium">Telefone</th>
                  <th className="px-5 py-3.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clientes.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-accent/40">
                    <td className="px-5 py-3.5 font-medium text-foreground">{c.nome}</td>
                    <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{formatCNPJ(c.cnpj)}</td>
                    <td className="px-5 py-3.5 tabular-nums text-muted-foreground">{formatPhone(c.telefone)}</td>
                    <td className="px-5 py-3.5">
                      <Acoes onEditar={() => editar(c)} onExcluir={() => setExcluindo(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cartões (celular) */}
          <ul className="space-y-3 md:hidden">
            {clientes.map((c) => (
              <li key={c.id} className="surface flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{c.nome}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatCNPJ(c.cnpj)}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{formatPhone(c.telefone)}</p>
                </div>
                <Acoes onEditar={() => editar(c)} onExcluir={() => setExcluindo(c)} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}
          </p>
        </>
      )}

      <ClienteDialog open={dialogAberto} onOpenChange={setDialogAberto} cliente={editando} />

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo?.nome} será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={excluir.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (excluindo) excluir.mutate(excluindo.id);
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

function Acoes({ onEditar, onExcluir }: { onEditar: () => void; onExcluir: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={onEditar} aria-label="Editar cliente">
        <Pencil className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onExcluir}
        aria-label="Excluir cliente"
        className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
