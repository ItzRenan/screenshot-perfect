import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkerSupabaseClient,
  enfileirarJob,
  concluirJobComDas,
} from "../src/supabase-queue.js";

test("não inicializa cliente Supabase sem credenciais do worker", () => {
  assert.throws(
    () => createWorkerSupabaseClient({}),
    /SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test("não enfileira job sem usuário ou cliente", async () => {
  await assert.rejects(
    () => enfileirarJob({ supabase: {}, userId: "", clienteId: "cliente", competencia: "10/2026" }),
    /Usuário e cliente são obrigatórios/,
  );
});

test("rejeita competência inválida antes de consultar o banco", async () => {
  await assert.rejects(
    () => enfileirarJob({ supabase: {}, userId: "user", clienteId: "cliente", competencia: "2026-10" }),
    /Competência inválida/,
  );
});

test("não envia arquivo que não tenha assinatura PDF ao armazenamento", async () => {
  const supabase = {
    storage: {
      from() {
        return {
          upload() {
            throw new Error("O upload não deveria ser chamado.");
          },
        };
      },
    },
  };

  await assert.rejects(
    () => concluirJobComDas({
      supabase,
      job: { id: "job", user_id: "user", competencia: "10/2026" },
      cliente: { cnpj: "65939082000180" },
      pdfBuffer: Buffer.from("not a pdf"),
      dadosDas: {},
    }),
    /não é um PDF válido/,
  );
});
