/**
 * Quem vence quando o disco e o banco discordam.
 *
 * A regra de ouro do `bootstrap.ts` era simples: **nunca sobrescrever**. Isso
 * protegia contra o pior (perder o que só existe neste PC) e criava um buraco
 * silencioso: página regerada no notebook, publicada, e o outro computador
 * ficando com a versão velha para sempre — o pull dizia "conflito" e seguia.
 * Pior: publicar a partir do PC atrasado mandava a versão velha de volta para
 * o banco, e aí a nova sumia de verdade.
 *
 * O desempate é a data que a própria página carrega (`updated:` no
 * frontmatter, escrito pelo ingest). Não é o mtime do arquivo — mtime é
 * "quando este disco escreveu", e o pull reescreve tudo ao recriar o vault.
 *
 * Quatro respostas possíveis, e o que cada uma protege:
 *
 *   - `criar`            não existe aqui: escreve, sem drama
 *   - `igual`            mesmo conteúdo: não faz nada
 *   - `atualizar`        a da conta é mais nova → sobrescreve, com cópia
 *                        guardada antes (quem chama faz a cópia)
 *   - `local-mais-novo`  a SUA é mais nova → mantém, e avisa para publicar
 *   - `conflito`         sem data dos dois lados, ou datas iguais com conteúdo
 *                        diferente: ninguém sabe quem é o mais novo, então
 *                        mantém o disco. É o comportamento antigo, agora
 *                        restrito ao caso em que ele é a única resposta honesta
 *
 * Sem data em UM dos lados também cai em `conflito`: comparar uma data com o
 * nada daria sempre o mesmo vencedor, o que é palpite, não desempate.
 */

export type Decisao =
  | { acao: "criar" }
  | { acao: "igual" }
  | { acao: "atualizar"; local: string; banco: string }
  | { acao: "local-mais-novo"; local: string; banco: string }
  | { acao: "conflito" };

/** `YYYY-MM-DD` — o formato que o `paraTexto` do bootstrap normaliza. */
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return DATA.test(s) ? s : null;
}

export function decidir(entrada: {
  existe: boolean;
  igual: boolean;
  updatedLocal?: string | null;
  updatedBanco?: string | null;
}): Decisao {
  if (!entrada.existe) return { acao: "criar" };
  if (entrada.igual) return { acao: "igual" };

  const local = dataValida(entrada.updatedLocal);
  const banco = dataValida(entrada.updatedBanco);
  if (!local || !banco) return { acao: "conflito" };

  // Comparação de texto basta: `YYYY-MM-DD` ordena igual à data.
  if (banco > local) return { acao: "atualizar", local, banco };
  if (local > banco) return { acao: "local-mais-novo", local, banco };
  return { acao: "conflito" };
}
