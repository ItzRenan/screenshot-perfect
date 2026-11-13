type MaybeError = { code?: string | undefined; message?: string | undefined } | null | undefined;

/** Converte erros do banco/autenticação em mensagens claras em português. */
export function mensagemDeErro(error: MaybeError, fallback = "Algo deu errado. Tente novamente."): string {
  if (!error) return fallback;
  switch (error.code) {
    case "23505":
      return "Já existe um registro com estes dados.";
    case "23503":
      return "Este registro está vinculado a outros dados e não pode ser alterado ou excluído.";
    case "42501":
      return "Você não tem permissão para acessar estes dados.";
    case "PGRST301":
      return "Sua sessão expirou. Entre novamente.";
  }
  const msg = error.message ?? "";
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar.";
  if (/failed to fetch|network/i.test(msg)) return "Sem conexão com o servidor. Verifique sua internet.";
  if (/rate limit/i.test(msg)) return "Muitas tentativas. Aguarde um instante e tente novamente.";
  return fallback;
}
