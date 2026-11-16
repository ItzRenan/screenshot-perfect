# MEI Fácil — worker em nuvem

Este diretório inicia a camada de processamento de DAS, separada do frontend Lovable.

## Etapa entregue

- Leitura de texto de PDFs DAS com PDF.js.
- Extração de CNPJ, período de apuração, vencimento e valor.
- Validação obrigatória de que o CNPJ do documento corresponde ao cliente.
- Valor monetário armazenado em centavos, evitando arredondamentos.
- Testes automatizados com os dois formatos de DAS identificados nos documentos de exemplo.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run parse:das -- caminho/do/arquivo.pdf
```

## Próxima integração

O coletor PGMEI será adaptado para receber CNPJ e competência como parâmetros (em vez de usar um CNPJ fixo e apenas o mês anterior). O processo de backend deverá consultar os clientes autorizados, executar a consulta, validar o PDF com este parser, armazená-lo no bucket privado `boletos-mei` em `<user_id>/<cliente_id>/...` e registrar o boleto no Supabase. Credenciais do Supabase e dados de sessão devem existir somente como variáveis secretas do serviço, nunca neste repositório.

**Importante:** o parser não consulta o PGMEI nem envia mensagens. Ele é uma etapa isolada de validação e ainda não está publicado como serviço ativo.
