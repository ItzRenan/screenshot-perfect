# MEI Fácil — Cloudflare Browser Run proof of concept

Esta pasta contém um teste isolado. Não substitui o worker atual e não altera o fluxo de emissão existente.

## O que este teste faz

- Abre uma sessão Chromium remota pelo binding Browser Run.
- Acessa somente a página pública de identificação do PGMEI.
- Verifica se a página carregou e se o seletor `#cnpj` existe.
- Gera um link Live View temporário para inspeção humana.
- Não preenche CNPJ, não tenta resolver CAPTCHA/anti-bot e não emite DAS.

## Configuração no Cloudflare

1. Crie um Worker conectado ao GitHub, selecionando este repositório e a branch `feat/mei-facil-cloudflare-browser-run-poc`.
2. Defina o diretório raiz como `cloudflare-worker`.
3. Use `npm install` como comando de instalação e `npx wrangler deploy` como comando de deploy, se o fluxo de Builds solicitar esses campos.
4. O binding `BROWSER` é declarado em `wrangler.jsonc`.
5. Cadastre o secret `API_TOKEN), com pelo menos 32 caracteres aleatórios. Não coloque o token no GitHub nem no frontend.
6. Mantenha o plano Workers Free; não habilite cobrança ou upgrade para este teste.

## Teste

Faça uma requisição POST para `/probe/pgmei` com o cabeçalho `Authorization: Bearer <API_TOKEN>`. A resposta contém o resultado da inspeção e um `liveViewUrl` temporário.

O endpoint `/health` é público e serve apenas para verificar se o Worker foi publicado.

## Limites conhecidos

- Browser Run no plano gratuito tem 10 minutos de navegador por dia, até 3 sessões simultâneas e limite de 60 segundos de inatividade por padrão; o código solicita 2 minutos de keep-alive. Não deixe sessões abertas.
- O Browser Run identifica seu tráfego como automação/bot. O User-Agent não remove essa identificação. O teste pode ser bloqueado pelo próprio PGMEI.
- Live View URLs são credenciais temporárias: não publique nem compartilhe o link.
- Este POC ainda não implementa fila, persistência de sessão, integração Supabase, download de PDF nem o fluxo completo de emissão.
- A compatibilidade real com o PGMEI precisa ser comprovada antes de qualquer adaptação do worker de produção.

Documentação oficial:
- https://developers.cloudflare.com/browser-run/get-started/
- https://developers.cloudflare.com/browser-run/puppeteer/
- https://developers.cloudflare.com/browser-run/features/live-view/
- https://developers.cloudflare.com/browser-run/pricing/
