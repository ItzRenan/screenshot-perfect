import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { configuracoesQuery, type BoletoComCliente } from "@/lib/queries";
import { formatCurrency, formatDate, formatPhone, isValidPhone } from "@/lib/format";
import { linkWhatsApp, preencherMensagem } from "@/lib/whatsapp";
import { baixarPdf } from "@/lib/storage";
import { mensagemDeErro } from "@/lib/errors";
import { cn } from "@/lib/utils";

export function WhatsAppDialog({
  boleto,
  onOpenChange,
}: {
  boleto: BoletoComCliente | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: config } = useQuery(configuracoesQuery());
  const [mensagem, setMensagem] = useState("");
  const [baixou, setBaixou] = useState(false);
  const [abriu, setAbriu] = useState(false);
  const [baixando, setBaixando] = useState(false);

  const cliente = boleto?.clientes;
  const telefoneOk = !!cliente && isValidPhone(cliente.telefone);

  useEffect(() => {
    if (!boleto || !config) return;
    setMensagem(
      preencherMensagem(config.mensagem_whatsapp, {
        cliente: boleto.clientes?.nome ?? "",
        competencia: boleto.competencia,
        valor: formatCurrency(boleto.valor),
        vencimento: formatDate(boleto.vencimento),
        escritorio: config.escritorio || config.nome_admin,
      }),
    );
    setBaixou(false);
    setAbriu(false);
  }, [boleto, config]);

  async function baixar() {
    if (!boleto?.arquivo_path) {
      toast.error("Este boleto não tem PDF anexado.");
      return;
    }
    setBaixando(true);
    try {
      await baixarPdf(boleto.arquivo_path, cliente?.nome ?? "cliente", boleto.competencia);
      setBaixou(true);
      toast.success("PDF baixado. Anexe-o na conversa do WhatsApp.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível baixar o PDF.");
    } finally {
      setBaixando(false);
    }
  }

  function abrirWhatsApp() {
    if (!cliente || !telefoneOk) return;
    window.open(linkWhatsApp(cliente.telefone, mensagem, config?.whatsapp_destino ?? "app"), "_blank", "noopener");
    setAbriu(true);
  }

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!boleto) return;
      const { error: errEnvio } = await supabase
        .from("envios")
        .insert({ boleto_id: boleto.id, status: "enviado", enviado_em: new Date().toISOString() });
      if (errEnvio) throw errEnvio;
      const { error } = await supabase.from("boletos").update({ status: "enviado" }).eq("id", boleto.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Envio registrado no histórico.");
      for (const key of ["boletos", "historico", "dashboard"]) queryClient.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
    },
    onError: (error: { code?: string | undefined; message?: string | undefined }) => {
      console.error(error);
      toast.error(mensagemDeErro(error, "Não foi possível registrar o envio."));
    },
  });

  return (
    <Dialog open={!!boleto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar pelo WhatsApp</DialogTitle>
          <DialogDescription>
            {cliente?.nome} · competência {boleto?.competencia}
            {cliente ? ` · ${formatPhone(cliente.telefone)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {!telefoneOk ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            O telefone deste cliente é inválido. Corrija o cadastro em Clientes antes de enviar.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mensagem">Mensagem</Label>
              <Textarea id="mensagem" rows={6} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
            </div>

            <ol className="space-y-2.5">
              <Passo n={1} feito={baixou} titulo="Baixe o PDF do boleto">
                <Button variant="outline" size="sm" onClick={baixar} disabled={baixando}>
                  {baixando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Baixar PDF
                </Button>
              </Passo>
              <Passo n={2} feito={abriu} titulo="Abra a conversa e anexe o PDF">
                <Button variant="success" size="sm" onClick={abrirWhatsApp}>
                  <MessageCircle className="size-4" />
                  Abrir WhatsApp
                </Button>
              </Passo>
              <Passo n={3} feito={false} titulo="Envie a mensagem no WhatsApp e confirme aqui" />
            </ol>
            <p className="text-xs text-muted-foreground">
              O MEI Fácil não envia mensagens sozinho. O envio só é registrado quando você confirmar.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="hero" onClick={() => confirmar.mutate()} disabled={!telefoneOk || !abriu || confirmar.isPending}>
            {confirmar.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Confirmar envio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Passo({ n, feito, titulo, children }: { n: number; feito: boolean; titulo: string; children?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
          feito ? "bg-success text-success-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        {feito ? "✓" : n}
      </span>
      <span className="flex-1 text-sm text-foreground">{titulo}</span>
      {children}
    </li>
  );
}
