# MEI Fácil — worker em nuvem

Camada isolada para consultar o PGMEI, validar PDFs DAS e persistir solicitações no Supabase.

## Implementado nesta branch

- Parser de PDF DAS com extração de CNPJ, competência, vencimento e valor em centavos.
- Validação estrita do CNPJ e da competência esperada.
- Fluxo PGMEI parametrizado: recebe CNPJ e competência `MM/AAAA`.
- Identificação do retorno de DAS já paga.
- Download da resposta PDF e validação da assinatura `%PDF-`.
- Ponto de parada explícito para validação humana quando o PGMEI mantiver o usuário na tela de identificação.
- Testes automatizados de parser e validação dos parâmetros.
- Migração para fila persistente `mei_jobs`, com reivindicação atômica (`SKIP LOCKED`), recuperação de jobs abandonados após 15 minutos e limite de tentativas.
- Restrição para impedir jobs duplicados para o mesmo cliente e competência (exceto quando o job anterior falhou).
- Verificação de titularidade do cliente antes de criar/consultar jobs.
- Bucket privado `boletos-mei`, com leitura limitada à pasta do próprio usuário.
- Finalização transacional: o banco revalida CNPJ/competência e cria o registro em `boletos` ao concluir o job.
- Testes de proteção para ausência de credenciais, competência inválida, titularidade do cliente e rejeição de arquivo que não seja PDF.
- URLs de download assinadas e temporárias; não tornar o bucket público.

## Executar testes

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run parse:das -- caminho/do/arquivo.pdf
```

## Configuração do Supabase

Defina no ambiente do worker, como secrets (nunca no repositório):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Aplique a migration `supabase/migrations/20261116130000_mei_jobs_private_storage.sql` no projeto Supabase antes de iniciar o worker com persistência.

O módulo `src/supabase-queue.js` fornece operações para criar jobs, reivindicar uma tarefa pendente, validar o cliente vinculado, registrar DAS no bucket privado, finalizar o job, marcar competência paga e registrar falhas com retry limitado.

**A integração ainda não está conectada à interface do MEI Fácil nem executando em produção.** A migration foi adicionada ao repositório, mas não foi aplicada ao projeto remoto. Nenhuma credencial é necessária para rodar os testes unitários.

## Integração do navegador

`src/pgmei-flow.js` exporta `consultarPgmei({ page, cnpj, competencia })`. O chamador deve fornecer uma página Puppeteer autorizada e uma sessão de navegador que possa ser operada. A função não tenta resolver CAPTCHA nem contornar desafios: se a Receita exigir validação, a execução informa `MANUAL_VERIFICATION_REQUIRED` para que uma pessoa conclua a etapa na sessão.

Os seletores e o fluxo de download ainda precisam ser validados em uma sessão real do PGMEI.

## Limitações atuais

- Não existe endpoint público nem serviço em nuvem ativo nesta branch.
- O worker ainda precisa de um processo consumidor que conecte a fila persistente à sessão PGMEI e ao parser de PDFs.
- O estado persistente dos jobs ficará no Supabase; sessões de navegador continuam sendo recursos efêmeros.
- Não há integração de WhatsApp.
- Não executar sem autorização do titular/cliente para consultar o CNPJ.
