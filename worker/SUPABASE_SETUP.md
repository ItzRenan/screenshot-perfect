# Supabase schema setup — MEI Fácil worker

**Important:** this project is connected to Lovable. Database schema changes must be made through Lovable, not by applying a hand-written migration from this worker branch.

Ask Lovable to implement the following additions in the existing Supabase project, preserving the current `clientes` and `boletos` tables:

1. A persistent `public.mei_jobs` table with UUID primary key, `user_id` linked to `auth.users`, `cliente_id` linked to `public.clientes`, competence in `MM/AAAA`, statuses `pending / processing / completed / paid / failed`, retry counters, lease timestamps, error message, storage path, boleto reference, JSON result, and timestamps.
2. Row Level Security enabled. Authenticated users may only create/read jobs where `user_id = auth.uid()`; inserts must verify the selected client belongs to the same user. The service role may manage jobs.
3. An atomic `claim_mei_job()` database function using row locking with `SKIP LOCKED`, reclaiming abandoned processing leases after 15 minutes and respecting the attempt limit. Execute permission must be restricted to the service role.
4. A `complete_mei_job(...)` function that locks the job, verifies it is processing, verifies the PDF CNPJ and competence match the job and client, creates the matching row in the existing `public.boletos` table, and marks the job completed in the same transaction. Restrict execution to service role.
5. A `fail_mei_job(...)` function that records a bounded error message and either requeues or marks failed according to the retry limit. Restrict execution to service role.
6. A partial unique constraint preventing duplicate active/completed/paid jobs for the same user, client, and competence, while allowing a new request after a failed job.
7. A private Storage bucket named `boletos-mei`, PDF-only, max 10 MB. Authenticated read policy must restrict object paths to the current user's UUID folder. Worker uploads use service role.
8. Preserve the existing boleto storage path convention and existing RLS rules. Do not make the bucket public and do not expose service-role credentials to browser code.

After Lovable implements this, review the actual generated schema against the worker's expected columns and function parameter names before applying it to the connected project.
