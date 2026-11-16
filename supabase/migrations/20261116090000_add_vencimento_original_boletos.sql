ALTER TABLE public.boletos
ADD COLUMN IF NOT EXISTS vencimento_original date;

COMMENT ON COLUMN public.boletos.vencimento_original IS
'Data de vencimento original indicada no DAS; vencimento mantém a data limite operacional para pagamento.';