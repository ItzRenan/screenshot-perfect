import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/app/Logo";
import { mensagemDeErro } from "@/lib/errors";

type AuthSearch = { redirect?: string };

function destinoSeguro(path: string | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/auth")) return "/painel";
  return path;
}

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — MEI Fácil" },
      { name: "description", content: "Acesse o painel do MEI Fácil com seu e-mail e senha." },
      { property: "og:title", content: "Entrar — MEI Fácil" },
      { property: "og:description", content: "Acesse o painel do MEI Fácil com seu e-mail e senha." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: destinoSeguro(redirect), replace: true });
    });
  }, [navigate, redirect]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!email.trim() || !senha) {
      setErro("Informe seu e-mail e sua senha.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setLoading(false);
    if (error) {
      setErro(mensagemDeErro(error, "Não foi possível entrar. Tente novamente."));
      return;
    }
    toast.success("Bem-vindo de volta!");
    navigate({ to: destinoSeguro(redirect), replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md animate-rise">
        <Logo className="mb-8 justify-center" />
        <div className="surface p-7 md:p-9">
          <h1 className="text-2xl font-semibold text-foreground">Entrar no painel</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Gerencie seus clientes MEI e os boletos DAS de cada competência.
          </p>

          <form onSubmit={entrar} className="mt-7 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="senha"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="h-11 pl-9"
                />
              </div>
            </div>

            {erro && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {erro}
              </p>
            )}

            <Button type="submit" variant="hero" size="lg" className="h-11 w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Acesso restrito a usuários autorizados.
        </p>
      </div>
    </div>
  );
}
