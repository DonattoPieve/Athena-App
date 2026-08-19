import * as path from "node:path";
import type { Vault } from "./vault";

/**
 * Glossário, portado do `athena-web` para o app.
 *
 * A diferença que importa: o site lê do banco, e o banco só tem o que já foi
 * publicado. Aqui a fonte é o disco — o que acabou de sair do ingest aparece
 * antes de ir para o ar.
 */

export type TermoGlossario = {
  termo: string;
  contexto: string;
  refs: { titulo: string; rel: string }[];
  /** Materia da pagina onde o termo foi visto primeiro — ver nomeMateria(). */
  categoria: string;
};

/**
 * Nome de exibicao da materia a partir da pasta `CODIGO-Nome-Da-Materia`
 * (ex.: "C09-Computacao-Grafica" -> "Computacao Grafica"). So troca `-` por
 * espaco e tira o codigo — nao existe classificacao semantica aqui, e o
 * mesmo criterio que `Vault.home()` usa para nomear materia na tela inicial.
 */
function nomeMateria(pastaMateria: string): string {
  return pastaMateria.split("-").slice(1).join(" ") || "Outros";
}

/** Primeira frase decente que cita o termo — o mesmo critério do site. */
function primeiraFrase(conteudo: string, termo: string): string {
  const seguro = termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${seguro}\\b`, "i");
  for (const linha of conteudo.split("\n")) {
    const limpa = linha.trim();
    if (limpa.length < 20) continue;
    if (limpa.startsWith("#") || limpa.startsWith("|") || limpa.startsWith("```")) continue;
    if (!re.test(limpa)) continue;
    const texto = limpa
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\[\[(.*?)\]\]/g, "$1")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1");
    return texto.length > 180 ? texto.slice(0, 177) + "…" : texto;
  }
  return "";
}

/**
 * Glossário: termos em negrito e constantes em `CRASE_MAIUSCULA`, com a aula
 * onde aparecem. Não é um dicionário curado — é um índice do que as páginas
 * já destacam, que é justamente o que se procura ao revisar.
 */
export async function glossario(vault: Vault): Promise<TermoGlossario[]> {
  const mapa = new Map<string, TermoGlossario>();

  for (const materia of await vault.listDir("Resumos/subjects")) {
    const dirRel = path.posix.join("Resumos/subjects", materia);
    for (const f of (await vault.listDir(dirRel)).filter((x) => x.endsWith(".md"))) {
      const slug = f.slice(0, -3);
      // MOC é índice e review é exercício: nenhum dos dois define termo.
      if (slug === materia || slug.endsWith("-review")) continue;

      const rel = path.posix.join(dirRel, f);
      let conteudo = "";
      try {
        conteudo = await vault.read(rel);
      } catch {
        continue;
      }
      const titulo = /^#\s+(.+)$/m.exec(conteudo)?.[1]?.trim() ?? slug;

      const termos = new Set<string>();
      for (const m of conteudo.matchAll(/\*\*([^*\n]{2,40})\*\*/g)) {
        const t = m[1].trim().replace(/[:.,]$/, "");
        // "3" e "1990" não são termo; sobra ruído de tabela e de data.
        if (t && !/^\d+$/.test(t) && t.length >= 2) termos.add(t);
      }
      for (const m of conteudo.matchAll(/`([A-Z][A-Z0-9_]{1,20})`/g)) termos.add(m[1]);

      for (const termo of termos) {
        const chave = termo.toLowerCase();
        if (!mapa.has(chave)) {
          // Categoria fica presa na primeira pagina onde o termo aparece:
          // o mesmo termo pode voltar em outra materia depois, mas ele so
          // define a categoria da entrada uma vez, na criacao.
          mapa.set(chave, {
            termo,
            contexto: primeiraFrase(conteudo, termo),
            refs: [],
            categoria: nomeMateria(materia),
          });
        }
        const entrada = mapa.get(chave)!;
        if (!entrada.refs.some((r) => r.rel === rel)) entrada.refs.push({ titulo, rel });
      }
    }
  }

  return [...mapa.values()].sort((a, b) =>
    a.termo.localeCompare(b.termo, "pt", { sensitivity: "base" }),
  );
}
