# Supabase schema setup — MEI Fácil worker

**Important:** this project is connected to Lovable. Database schema changes must be made through Lovable, not by applying a hand-written migration from this worker branch.

A migration reviewed for this worker is available at `supabase/migrations/20261116120000_mei_jobs_queue.sql`. Apply it to the connected Supabase project through the Lovable-managed database workflow after reviewing the current schema. Do not run it against production until the existing `clientes` composite ownership columns and private Storage bucket have been verified. It preserves the existing `clientes`, `boletos`, and `boletos-mei` resources and adds the queue/functions below:

1. A persistent `public.mei_jobs` table with UUID primary key, `user_id` linked to `auth.users`, `cliente_id` linked to `public.clientes`, competence in `MM/AAAA`, statuses `pending / processing / completed / paid / failed`, retry counters, lease timestamps, error message, storage path, boleto reference, JSON result, and timestamps.
2. Row Level Security enabled. Authenticated users may only create/read jobs where `user_id = auth.uid()`; inserts must verify the selected client belongs to the same user. The service role may manage jobs.
3. An atomic `claim_mei_job()` database function using row locking with `SKIP LOCKED`, reclaiming abandoned processing leases after 15 minutes and respecting the attempt limit. Execute permission must be restricted to the service role.
4. A `complete_mei_job(...)` function that locks the job, verifies it is processing, verifies the PDF CNPJ and competence match the job and client, creates the matching row in the existing `public.boletos` table, and marks the job completed in the same transaction. Restrict execution to service role.
5. A `fail_mei_job(...)` function that records a bounded error message and either requeues or marks failed according to the retry limit. Restrict execution to service role.
6. A partial unique constraint preventing duplicate active/completed/paid jobs for the same user, client, and competence, while allowing a new request after a failed job.
7. Reuse the existing private Storage bucket `boletos-mei` and its established policies. Verify that authenticated reads are restricted to `<auth.uid()>/...`; do not recreate the bucket or weaken/replace its current policies. Worker uploads use service role. Apply a PDF-only size limit only if it is compatible with the existing bucket configuration.
8. Preserve the existing boleto storage path convention and existing RLS rules. Do not make the bucket public and do not expose service-role credentials to browser code.

After the migration is applied, regenerate `src/integrations/supabase/types.ts` from the connected project and verify the actual generated schema, RLS, RPC signatures and bucket policies against `worker/src/supabase-queue.js`. The migration creates a composite ownership foreign key to `clientes(id,user_id)`; it first creates the required unique index. If the existing table differs from the checked-in type definition, stop and adapt the migration rather than forcing it.
