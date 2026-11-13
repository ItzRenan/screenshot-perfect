GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boletos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.envios TO authenticated;
GRANT ALL ON public.clientes TO service_role;
GRANT ALL ON public.boletos TO service_role;
GRANT ALL ON public.envios TO service_role;