# MEI Fácil — worker em nuvem

Camada isolada para consultar o PGMEI, validar PDFs DAS e preparar o armazenamento no Supabase.

## Implementado nesta branch

- Parser de PDF DAS com extração de CNPJ, competência, vencimento e valor em centavos.
- Validação estrita do CNPJ e da competência esperada.
- Fluxo PGMEI parametrizado: recebe CNPJ e competência `MM/AAAA`; não usa CNPJ fixo nem assume sempre o mês anterior.
- Identificação do retorno de DAS já paga.
- Download da resposta PDF e validação da assinatura `%PDF-`.
- Ponto de parada explícito para validação humana quando o PGMEI mantiver o usuário na tela de identificação.
- Testes automatizados de parser e validação dos parâmetros.

## Executar testes

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run parse:das -- caminho/do/arquivo.pdf
```

## Integração do navegador

`src/pgmei-flow.js` exporta `consultarPgmei({ page, cnpj, competencia })`. O chamador deve fornecer uma página Puppeteer autorizada e uma sessão de navegador que possa ser operada. A função não tenta resolver CAPTCHA, não simula identidade nem contorna desafios: se a Receita exigir validação, a execução informa `MANUAL_VERIFICATION_REQUIRED` para que uma pessoa conclua a etapa na sessão.

O repositório original `pgmei-solver` foi útil como referência de seletores e sequência de navegação, mas o script original tinha CNPJ fixo por variável de ambiente, competência automática do mês anterior e fluxo de navegador acoplado a um único processo. A nova camada separa os parâmetros e a navegação para permitir integração multi-cliente com controle de acesso.

## Ainda não publicado / não conectado

- Não existe endpoint público nem serviço em nuvem ativo nesta branch.
- Não há conexão com Supabase, fila persistente ou gravação automática no bucket `boletos-mei`.
- Não há interface remota para uma pessoa concluir o desafio do PGMEI na sessão em nuvem.
- O envio pelo WhatsApp continua dependendo da confirmação no painel MEI Fácil.

Credenciais devem ser configuradas como secrets no ambiente de execução; nunca devem ser commitadas no GitHub. Não use um CNPJ de fallback. Antes de gravar um boleto, valide sempre CNPJ e competência contra o cliente e o job que originou a consulta.
