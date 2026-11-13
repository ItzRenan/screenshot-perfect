CREATE TABLE public.configuracoes (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  nome_admin text,
  escritorio text,
  mensagem_whatsapp text,
  whatsapp_destino text NOT NULL DEFAULT 'app',
  dia_vencimento_padrao integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.configuracoes TO authenticated;
GRANT ALL ON public.configuracoes TO service_role;

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario le suas configuracoes" ON public.configuracoes
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Usuario cria suas configuracoes" ON public.configuracoes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Usuario altera suas configuracoes" ON public.configuracoes
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.validar_configuracoes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.whatsapp_destino NOT IN ('app', 'web') THEN
    RAISE EXCEPTION 'whatsapp_destino inválido';
  END IF;
  IF NEW.dia_vencimento_padrao < 1 OR NEW.dia_vencimento_padrao > 28 THEN
    RAISE EXCEPTION 'dia_vencimento_padrao deve estar entre 1 e 28';
  END IF;
  IF NEW.mensagem_whatsapp IS NOT NULL AND length(NEW.mensagem_whatsapp) > 1000 THEN
    RAISE EXCEPTION 'mensagem_whatsapp muito longa';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER validar_configuracoes_trg
  BEFORE INSERT OR UPDATE ON public.configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_configuracoes();