# MEI Fácil — worker em nuvem

Worker experimental que consome jobs persistidos no Supabase, abre uma sessão visual Chromium para o PGMEI, aguarda a validação humana, extrai o PDF DAS e registra o boleto no Supabase.

## Configuração local/VPS

Crie um arquivo `.env` local (não versionar) com:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `API_TOKEN` (segredo aleatório com pelo menos 32 caracteres)

Antes, peça ao Lovable para implementar o schema descrito em `worker/SUPABASE_SETUP.md`. Este projeto é conectado ao Lovable; não aplique migrations manuais desta branch.

Na pasta `worker`, execute:

```bash
docker compose up -d --build
```

Portas ficam limitadas ao loopback do host:
- API: `http://127.0.0.1:3000`
- Sessão PGMEI: `http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale`

Em VPS, acesse por túnel SSH. Não exponha API/VNC diretamente à internet. O token é segredo de servidor e nunca deve ser colocado no frontend/browser.

## Fluxo

1. Um backend confiável chama `POST /api/jobs` com `userId`, `clienteId` e `competencia` (MM/AAAA).
2. O consumidor reivindica atomicamente o job via `claim_mei_job()`.
3. O Chromium abre o PGMEI e preenche o CNPJ do cadastro pertencente ao usuário.
4. O operador acessa a sessão visual, conclui manualmente qualquer validação e chama `POST /api/jobs/:id/continue`.
5. O worker navega até a competência, identifica DAS já pago ou baixa o PDF, extrai os dados, confere CNPJ/competência, armazena no bucket privado e cria o registro em `boletos`.
6. `GET /api/jobs/:id` informa status/etapa; `GET /api/jobs/:id/file` devolve URL assinada com validade de 60 segundos.

Todas as rotas `/api` exigem `Authorization: Bearer API_TOKEN`. A autenticação atual é adequada apenas para chamadas servidor-a-servidor. A interface do MEI Fácil deve chamar uma Edge Function/backend autenticado, nunca receber a service-role key ou API_TOKEN.

## Endpoints

- `GET /health`
- `POST /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs/:id/continue`
- `GET /api/jobs/:id/file`
- `POST /api/jobs/:id/close`

## Limitações e segurança

- O worker processa uma sessão de navegador por instância.
- A sessão visual é efêmera; reinício do container interrompe o browser. A fila reencaminha leases abandonados após 15 minutos.
- Não há bypass de CAPTCHA ou mecanismo anti-automação; intervenção humana é necessária quando exigida pelo PGMEI.
- Seletores e emissão precisam de teste real controlado no PGMEI.
- Ainda não está integrado à interface do MEI Fácil, nem deployado. Não aplique a migration nem configure secrets de produção sem revisão e autorização.
- Não há envio por WhatsApp.
