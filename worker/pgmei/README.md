# MEI Fácil — sessão PGMEI

Este worker inicia um Chromium em uma sessão visual remota, preenche o CNPJ e pausa para que o operador conclua manualmente eventual CAPTCHA/validação apresentada pelo PGMEI. Depois da confirmação manual, o worker tenta navegar até a competência solicitada, identificar DAS já pago ou baixar o PDF.

**Não há tentativa de contornar CAPTCHA, simular identidade do navegador ou driblar mecanismos anti-automação.** A etapa de validação é realizada pelo operador na sessão visual.

## Subir o worker

Na pasta `worker/pgmei`:

1. Copie `.env.example` para `.env` e defina um `API_TOKEN` aleatório com pelo menos 32 caracteres.
2. Execute `docker compose up -d --build`.
3. O worker fica disponível apenas no loopback do host:
   - API: `http://127.0.0.1:3000`
   - Sessão visual: `http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale`

Em um VPS, use um túnel SSH para não expor a sessão visual nem a API diretamente à internet:

```bash
ssh -L 3000:127.0.0.1:3000 -L 6080:127.0.0.1:6080 usuario@SEU_SERVIDOR
```

Abra o endereço noVNC no navegador local. Não publique as portas 3000/6080 sem TLS, autenticação e controle de acesso. O VNC é limitado ao loopback dentro do container e os mapeamentos do Compose também ficam no loopback do host.

## Fluxo HTTP

Todas as rotas `/api` exigem `Authorization: Bearer SEU_API_TOKEN`.

### 1. Iniciar uma sessão

```bash
curl -X POST http://127.0.0.1:3000/api/jobs \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cnpj":"40439707000113","competencia":"12/2021"}'
```

A resposta contém um `id` e o estado `awaiting_user`. Abra o noVNC, confira a tela do PGMEI e conclua manualmente qualquer CAPTCHA/validação que aparecer.

### 2. Continuar após a validação manual

```bash
curl -X POST http://127.0.0.1:3000/api/jobs/ID_DA_SESSAO/continue \
  -H "Authorization: Bearer $API_TOKEN"
```

Se a página ainda estiver na identificação, o worker mantém a sessão aberta e pede que o operador termine a etapa manual.

### 3. Consultar o resultado e baixar o PDF

```bash
curl http://127.0.0.1:3000/api/jobs/ID_DA_SESSAO \
  -H "Authorization: Bearer $API_TOKEN"

curl -L http://127.0.0.1:3000/api/jobs/ID_DA_SESSAO/file \
  -H "Authorization: Bearer $API_TOKEN" -o DAS.pdf
```

Finalize a sessão com `POST /api/jobs/ID_DA_SESSAO/close`.

## Estados

- `starting`: inicializando Chromium.
- `awaiting_user`: aguardando conclusão manual da validação.
- `checking_session`: verificando se a página saiu da identificação.
- `processing`: selecionando ano/competência e gerando DAS.
- `paid`: o PGMEI informou que já existe pagamento.
- `completed`: PDF baixado.
- `failed`: erro de navegação, seletor ou download.
- `cancelled`: sessão encerrada.

## Limitações atuais

- Este é um worker experimental e não está conectado ao Supabase nem à interface do MEI Fácil.
- A navegação usa seletores observados no projeto de referência `MLAN1O/pgmei-solver`; mudanças no PGMEI podem exigir atualização.
- O fluxo de download e os seletores ainda precisam ser testados em uma sessão real.
- O estado dos jobs fica em memória; reiniciar o container encerra sessões em andamento.
- Uma sessão por vez; não executar múltiplos CNPJs simultaneamente.
- Não executar sem autorização do titular/cliente para consultar o CNPJ.
