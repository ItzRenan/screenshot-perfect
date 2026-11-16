# Worker do MEI Fácil

Serviço separado do frontend para processar PDFs em fila e enviar documentos aprovados pela WhatsApp Cloud API.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha Supabase URL + service role key (somente no servidor) e credenciais Meta.
3. Execute `docker compose up -d --build`.
4. Configure o webhook HTTPS `/webhooks/whatsapp` na Meta.
5. Aprove um template Utility com cabeçalho de documento e quatro variáveis no corpo.

## Requisitos

A migração `supabase/migrations/20261116090000_mei_facil_importacao_automacao.sql` deve ser revisada e aplicada no Supabase antes de ligar o worker. O worker usa RPCs com `FOR UPDATE SKIP LOCKED` para reservar itens/envios e reduzir processamento duplicado.

O template configurado precisa corresponder exatamente ao formato de documento + quatro variáveis. Não há envio antes da aprovação explícita na tela de Importações.

## Limites

A leitura automática só extrai texto incorporado no PDF. PDF escaneado, campos ausentes, CNPJ não cadastrado e duplicidades precisam de conferência humana. Não há coletor PGMEI automático neste worker. O serviço não contorna CAPTCHA nem mecanismos anti-bot; qualquer etapa de autenticação deve ocorrer por meios autorizados.

## Segurança

- Nunca coloque `SUPABASE_SERVICE_ROLE_KEY`, token Meta ou app secret no frontend.
- Mantenha o bucket `boletos-mei` privado.
- Configure `WHATSAPP_APP_SECRET` para validar assinatura dos webhooks POST.
- Use HTTPS e limite acesso administrativo à infraestrutura.
