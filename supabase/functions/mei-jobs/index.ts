import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ${name} não configurado na Edge Function.`);
  return value;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validCompetencia(value: unknown): value is string {
  return typeof value === "string" && /^(0[1-9]|1[0-2])\/\d{4}$/.test(value);
}

async function workerRequest(path: string, method: "GET" | "POST", body?: unknown) {
  const baseUrl = requiredEnv("MEI_WORKER_URL").replace(/\/$/, "");
  const token = requiredEnv("MEI_WORKER_API_TOKEN");
  let response: Response;
  try {
    response = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new Error("Não foi possível alcançar o worker MEI. Verifique se o serviço está disponível.");
  }

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Sessão não informada." }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!publishableKey) throw new Error("Secret SUPABASE_ANON_KEY ou SUPABASE_PUBLISHABLE_KEY não configurado.");

    // This client carries the caller's JWT; ownership checks therefore run under existing RLS.
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const user = authData.user;
    if (authError || !user) return json({ error: "Sessão inválida ou expirada." }, 401);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || typeof body.action !== "string") {
      return json({ error: "Informe uma ação válida." }, 400);
    }

    if (body.action === "create") {
      if (!validUuid(body.clienteId) || !validCompetencia(body.competencia)) {
        return json({ error: "Cliente ou competência inválidos." }, 400);
      }

      const { data: cliente, error: clienteError } = await userClient
        .from("clientes")
        .select("id")
        .eq("id", body.clienteId)
        .maybeSingle();
      if (clienteError) return json({ error: "Não foi possível validar o cliente." }, 400);
      if (!cliente) return json({ error: "Cliente não encontrado ou sem acesso." }, 404);

      const result = await workerRequest("/api/jobs", "POST", {
        userId: user.id,
        clienteId: body.clienteId,
        competencia: body.competencia,
      });
      return json(result.payload, result.status);
    }

    if (!validUuid(body.jobId)) return json({ error: "Identificador de solicitação inválido." }, 400);

    // Do not trust the job ID supplied by the browser; prove ownership with the caller's JWT.
    const { data: job, error: jobError } = await userClient
      .from("mei_jobs")
      .select("id")
      .eq("id", body.jobId)
      .maybeSingle();
    if (jobError) return json({ error: "Não foi possível validar a solicitação. Confira se o schema mei_jobs já foi criado." }, 503);
    if (!job) return json({ error: "Solicitação não encontrada." }, 404);

    const encodedId = encodeURIComponent(body.jobId);
    if (body.action === "status") {
      const result = await workerRequest(`/api/jobs/${encodedId}`, "GET");
      return json(result.payload, result.status);
    }
    if (body.action === "continue") {
      const result = await workerRequest(`/api/jobs/${encodedId}/continue`, "POST", {});
      return json(result.payload, result.status);
    }
    if (body.action === "file") {
      const result = await workerRequest(`/api/jobs/${encodedId}/file`, "GET");
      return json(result.payload, result.status);
    }
    if (body.action === "close") {
      const result = await workerRequest(`/api/jobs/${encodedId}/close`, "POST", {});
      return json(result.payload, result.status);
    }

    return json({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    console.error("[mei-jobs]", error);
    return json({ error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});
