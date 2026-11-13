import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { configuracoesQuery } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { MENSAGEM_PADRAO, VARIAVEIS_MENSAGEM, preencherMensagem } from "@/lib/whatsapp";
import { mensagemDeErro } from "@/lib/errors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — MEI Fácil" },
      { name: "description", content: "Dados do administrador, mensagem padrão do WhatsApp e preferências do sistema." },
      { property: "og:title", content: "Configurações — MEI Fácil" },
      { property: "og:description", content: "Dados do administrador, mensagem padrão do WhatsApp e preferências do sistema." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(configuracoesQuery()),
  pendingComponent: () => <p className="text-sm text-muted-foreground">Carregando configurações...</p>,
  errorComponent: ({ error }) => (
    <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error instanceof Error ? error.message : "Não foi possível carregar as configurações."}
    </p>
  ),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: config } = useSuspenseQuery(configuracoesQuery());
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const [nome, setNome] = useState(config.nome_admin);
  const [escritorio, setEscritorio] = useState(config.escritorio);
  const [mensagem, setMensagem] = useState(config.mensagem_whatsapp);
  const [destino, setDestino] = useState<"app" | "web">(config.whatsapp_destino);
  const [dia, setDia] = useState(String(config.dia_vencimento_padrao));

  useEffect(() => {
    setNome(config.nome_admin);
    setEscritorio(config.escritorio);
    setMensagem(config.mensagem_whatsapp);
    setDestino(config.whatsapp_destino);
    setDia(String(config.dia_vencimento_padrao));
  }, [config]);

  const salvar = useMutation({
    mutationFn: async () => {
      const diaNum = Number(dia);
      if (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 28) throw { code: "dia" };
      if (!mensagem.trim()) throw { code: "mensagem" };
      if (mensagem.length > 1000) throw { code: "mensagem-longa" };
      const { error } = await supabase.from("configuracoes").upsert(
        {
          user_id: user.id,
          nome_admin: nome.trim() || null,
          escritorio: escritorio.trim() || null,
          mensagem_whatsapp: mensagem.trim(),
          whatsapp_destino: destino,
          dia_vencimento_padrao: diaNum,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas.");
      queryClient.invalidateQueries({ queryKey: ["configuracoes"] });
    },
    onError: (e: { code?: string | undefined; message?: string | undefined }) => {
      console.error(e);
      if (e.code === "dia") toast.error("O dia de vencimento deve estar entre 1 e 28.");
      else if (e.code === "mensagem") toast.error("A mensagem padrão não pode ficar vazia.");
      else if (e.code === "mensagem-longa") toast.error("A mensagem deve ter no máximo 1000 caracteres.");
      else toast.error(mensagemDeErro(e, "Não foi possível salvar as configurações."));
    },
  });

  function inserirVariavel(v: string) {
    const el = msgRef.current;
    if (!el) return setMensagem((m) => m + v);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const novo = mensagem.slice(0, start) + v + mensagem.slice(end);
    setMensagem(novo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + v.length, start + v.length);
    });
  }

  const exemplo = preencherMensagem(mensagem, {
    cliente: "Nome do cliente",
    competencia: "11/2026",
    valor: "R$ 75,90",
    vencimento: "20/12/2026",
    escritorio: escritorio || nome,
  });

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Personalize o MEI Fácil para o seu dia a dia."
        action={
          <Button variant="hero" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar alterações
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Secao titulo="Dados do administrador">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome">Seu nome</Label>
              <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Como você quer ser chamado" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="escritorio">Escritório / assinatura</Label>
              <Input
                id="escritorio"
                value={escritorio}
                onChange={(e) => setEscritorio(e.target.value)}
                maxLength={120}
                placeholder="Ex.: Contabilidade Silva"
              />
              <p className="text-xs text-muted-foreground">Usado na variável {"{escritorio}"} da mensagem.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail de acesso</Label>
              <Input id="email" value={user.email ?? ""} disabled />
            </div>
          </div>
        </Secao>

        <Secao titulo="Preferências do sistema">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Abrir o WhatsApp em</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: "app", t: "Aplicativo", d: "WhatsApp ou WhatsApp Business" },
                    { v: "web", t: "WhatsApp Web", d: "No navegador do computador" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setDestino(o.v)}
                    className={cn(
                      "rounded-lg border border-border bg-muted/30 p-3 text-left transition-colors hover:border-primary/50",
                      destino === o.v && "border-primary bg-primary/10 ring-1 ring-primary/40",
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">{o.t}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{o.d}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dia">Dia de vencimento padrão do DAS</Label>
              <Input
                id="dia"
                type="number"
                min={1}
                max={28}
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                className="w-28"
              />
              <p className="text-xs text-muted-foreground">
                Ao importar um boleto, o vencimento é sugerido neste dia do mês seguinte à competência.
              </p>
            </div>
          </div>
        </Secao>

        <Secao titulo="Mensagem padrão do WhatsApp" className="lg:col-span-2">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {VARIAVEIS_MENSAGEM.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => inserirVariavel(v)}
                    className="rounded-md bg-accent px-2 py-1 font-mono text-xs text-accent-foreground hover:bg-primary/20"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <Textarea
                ref={msgRef}
                rows={7}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                maxLength={1000}
                aria-label="Mensagem padrão"
              />
              <Button variant="ghost" size="sm" onClick={() => setMensagem(MENSAGEM_PADRAO)}>
                <RotateCcw className="size-4" />
                Restaurar mensagem padrão
              </Button>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Prévia</p>
              <div className="whitespace-pre-wrap rounded-xl rounded-tl-sm border border-success/30 bg-success/10 p-4 text-sm text-foreground">
                {exemplo}
              </div>
            </div>
          </div>
        </Secao>

        <Secao titulo="Informações da conta" className="lg:col-span-2">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Info label="E-mail" value={user.email ?? "—"} />
            <Info label="Conta criada em" value={formatDateTime(user.created_at)} />
            <Info label="Último acesso" value={formatDateTime(user.last_sign_in_at)} />
            <Info label="Identificador" value={user.id} mono />
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Seus dados e PDFs ficam protegidos: só o seu usuário consegue vê-los.
          </p>
        </Secao>
      </div>
    </>
  );
}

function Secao({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface p-5 md:p-6", className)}>
      <h2 className="mb-5 text-base font-semibold text-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 truncate text-foreground", mono && "font-mono text-xs")} title={value}>
        {value}
      </dd>
    </div>
  );
}
