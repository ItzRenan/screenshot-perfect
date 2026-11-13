import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { competenciaDe, onlyDigits } from "./format";
import { mensagemDeErro } from "./errors";

export type Cliente = Tables<"clientes">;

function fail(error: { code?: string | undefined; message?: string | undefined }): never {
  console.error(error);
  throw new Error(mensagemDeErro(error, "Não foi possível carregar os dados."));
}

/** Remove caracteres que quebrariam o filtro de busca. */
function sanitize(term: string): string {
  return term.replace(/[,()%*\\]/g, " ").trim();
}

export const clientesQuery = (busca: string) =>
  queryOptions({
    queryKey: ["clientes", busca],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("clientes").select("*").order("nome", { ascending: true });
      const term = sanitize(busca);
      if (term) {
        const digits = onlyDigits(term);
        q = digits.length >= 2
          ? q.or(`nome.ilike.%${term}%,cnpj.ilike.%${digits}%`)
          : q.ilike("nome", `%${term}%`);
      }
      const { data, error } = await q;
      if (error) fail(error);
      return data;
    },
  });

export type Atividade = {
  id: string;
  tipo: "cliente" | "boleto" | "envio";
  titulo: string;
  detalhe: string;
  data: string;
};

export const dashboardQuery = () =>
  queryOptions({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const competencia = competenciaDe(new Date());
      const count = { count: "exact" as const, head: true };
      const [clientes, atual, pendentes, enviados, ultClientes, ultBoletos, ultEnvios] = await Promise.all([
        supabase.from("clientes").select("id", count),
        supabase.from("boletos").select("id", count).eq("competencia", competencia),
        supabase.from("boletos").select("id", count).eq("status", "pendente"),
        supabase.from("boletos").select("id", count).eq("status", "enviado"),
        supabase.from("clientes").select("id, nome, created_at").order("created_at", { ascending: false }).limit(6),
        supabase
          .from("boletos")
          .select("id, competencia, created_at, clientes(nome)")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("envios")
          .select("id, status, enviado_em, created_at, boletos(competencia, clientes(nome))")
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      for (const r of [clientes, atual, pendentes, enviados, ultClientes, ultBoletos, ultEnvios]) {
        if (r.error) fail(r.error);
      }

      const atividades: Atividade[] = [
        ...(ultClientes.data ?? []).map((c) => ({
          id: `c-${c.id}`,
          tipo: "cliente" as const,
          titulo: "Cliente cadastrado",
          detalhe: c.nome,
          data: c.created_at ?? "",
        })),
        ...(ultBoletos.data ?? []).map((b) => ({
          id: `b-${b.id}`,
          tipo: "boleto" as const,
          titulo: `Boleto importado · ${b.competencia}`,
          detalhe: b.clientes?.nome ?? "Cliente não informado",
          data: b.created_at ?? "",
        })),
        ...(ultEnvios.data ?? []).map((e) => ({
          id: `e-${e.id}`,
          tipo: "envio" as const,
          titulo: `Envio pelo WhatsApp${e.boletos?.competencia ? ` · ${e.boletos.competencia}` : ""}`,
          detalhe: e.boletos?.clientes?.nome ?? "Cliente não informado",
          data: e.enviado_em ?? e.created_at ?? "",
        })),
      ]
        .filter((a) => a.data)
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 10);

      return {
        competencia,
        totalClientes: clientes.count ?? 0,
        boletosCompetencia: atual.count ?? 0,
        pendentes: pendentes.count ?? 0,
        enviados: enviados.count ?? 0,
        atividades,
      };
    },
  });
