# Operação segura do worker MEI Fácil

## Acesso à sessão visual PGMEI

A sessão noVNC é privada. O Docker Compose publica a porta 6080 somente em `127.0.0.1`, e o x11vnc também escuta apenas em loopback. Não altere essas configurações para `0.0.0.0` e não exponha a porta 6080 diretamente à internet.

Para um operador autorizado acessar a sessão em uma VPS:

1. Confirme que o worker está em execução e que existe um job no estado `processing` com etapa `awaiting_user`.
2. No computador do operador, abra um túnel SSH:

   ```bash
   ssh -N -L 6080:127.0.0.1:6080 USUARIO_SSH@HOST_DA_VPS
   ```

3. Enquanto o túnel estiver ativo, abra `http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale`.
4. Conclua manualmente a validação apresentada pelo PGMEI. Não use serviço de resolução automática de CAPTCHA.
5. Mantenha o túnel aberto até o worker concluir a navegação. Acompanhe o job pela API autenticada.
6. Encerre o túnel SSH ao terminar.

Use chave SSH individual, autenticação forte e permissões mínimas. Não compartilhe credenciais SSH nem deixe a sessão VNC aberta em computadores públicos.

## Restrições operacionais

- A API do worker deve ficar atrás de HTTPS/rede privada e nunca ser exposta sem proteção.
- A porta 3000 também fica vinculada ao loopback do host no Compose. A Edge Function hospedada no Supabase não alcançará diretamente esse endereço: será necessário configurar conectividade privada ou um gateway HTTPS autenticado, sem expor o VNC.
- `API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` e secrets do Supabase ficam exclusivamente no servidor/gerenciador de secrets.
- Não coloque tokens em parâmetros de URL, frontend, logs ou screenshots.
- A sessão do Chromium é temporária. Se o container reiniciar, a sessão visual é encerrada; a fila deve recuperar o job conforme a política de lease.
- Um operador humano deve conferir CNPJ e competência na tela antes de continuar. O parser valida novamente os dados do PDF antes de registrar o boleto.

## Estado atual

Este procedimento é uma operação administrativa via SSH. Ele não representa uma visualização de sessão já integrada à interface do cliente. Para acesso direto no aplicativo será necessário implementar um gateway/proxy autenticado com tickets temporários, expiração curta e controle de uso único, sem expor VNC ou a API do worker.
