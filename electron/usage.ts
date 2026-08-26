import * as fs from "node:fs";
import * as path from "node:path";
import type { Vault } from "./vault";

/**
 * Uso do app NESTE APARELHO: ultima pagina lida, quanto rolou, termos
 * marcados. Grava em `<vault>/.athena/app-uso.json`, separado de
 * `.athena/session.json` de proposito — aquele e o formato da CLI
 * (athena-web/scripts/lib/session.mjs) e mexer nele derruba o login
 * compartilhado. Posicao de leitura e bookmark nao tem nada a ver com a
 * sessao do Supabase, entao ganham arquivo proprio.
 *
 * Local, nao do conteudo: se a pessoa ler a mesma aula em duas maquinas,
 * cada uma guarda seu proprio "onde parei" — nao ha sincronismo aqui.
 */

const ARQUIVO_REL = path.join(".athena", "app-uso.json");

/** Uma visita a uma pagina: quando foi e quanto da pagina foi rolado. */
type Visita = { rel: string; em: string; pct: number };

type Estado = {
  visitas: Visita[];
  /** Termos do glossario marcados (bookmark), pelo texto exato do termo. */
  termos: string[];
};

function estadoVazio(): Estado {
  return { visitas: [], termos: [] };
}

function arquivoDe(vault: Vault): string {
  return path.join(vault.root, ARQUIVO_REL);
}

/**
 * Leitura defensiva: JSON corrompido, arquivo ausente ou com formato velho
 * viram estado vazio, nunca excecao. Isto e cache de UX — travar o app por
 * causa de um `app-uso.json` truncado (a maquina desligou no meio da escrita)
 * seria trocar uma conveniencia por um bug.
 */
function ler(vault: Vault): Estado {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivoDe(vault), "utf8"));
    const visitas = Array.isArray(bruto?.visitas)
      ? bruto.visitas.filter(
          (v: unknown): v is Visita =>
            !!v &&
            typeof v === "object" &&
            typeof (v as Visita).rel === "string" &&
            typeof (v as Visita).em === "string",
        )
      : [];
    // pct pode faltar em registros antigos ou vir fora de faixa — normaliza aqui
    // em vez de espalhar a checagem em cada funcao que le o estado.
    for (const v of visitas) {
      v.pct = typeof v.pct === "number" && isFinite(v.pct) ? Math.max(0, Math.min(100, v.pct)) : 0;
    }
    const termos = Array.isArray(bruto?.termos)
      ? bruto.termos.filter((t: unknown): t is string => typeof t === "string")
      : [];
    return { visitas, termos };
  } catch {
    return estadoVazio();
  }
}

function salvar(vault: Vault, estado: Estado) {
  const p = arquivoDe(vault);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(estado, null, 2), "utf8");
}

function porRecencia(a: Visita, b: Visita): number {
  return b.em.localeCompare(a.em);
}

/** Mais recente primeiro, no maximo 20 — cada `rel` aparece uma vez so. */
export async function recentes(vault: Vault): Promise<{ rel: string; em: string }[]> {
  return ler(vault)
    .visitas.slice()
    .sort(porRecencia)
    .slice(0, 20)
    .map((v) => ({ rel: v.rel, em: v.em }));
}

/**
 * Registra a visita. Se ja existia registro para a pagina, atualiza a data
 * (e o pct, quando informado) em vez de duplicar — "recentes" e uma lista de
 * paginas, nao de eventos.
 */
export async function visitar(vault: Vault, rel: string, pct?: number): Promise<boolean> {
  const estado = ler(vault);
  const agora = new Date().toISOString();
  const pctNovo = typeof pct === "number" && isFinite(pct) ? Math.max(0, Math.min(100, pct)) : undefined;

  const existente = estado.visitas.find((v) => v.rel === rel);
  if (existente) {
    existente.em = agora;
    if (pctNovo !== undefined) existente.pct = pctNovo;
  } else {
    estado.visitas.push({ rel, em: agora, pct: pctNovo ?? 0 });
  }

  // Sem teto o arquivo so cresce; 200 paginas ja cobre anos de uso e nao
  // pesa na leitura toda vez que a pessoa vira uma pagina.
  if (estado.visitas.length > 200) {
    estado.visitas.sort(porRecencia);
    estado.visitas.length = 200;
  }

  salvar(vault, estado);
  return true;
}

/** Nome de exibicao da materia a partir da pasta `CODIGO-Nome-Da-Materia`. */
function nomeMateria(pastaMateria: string): string {
  return pastaMateria.split("-").slice(1).join(" ") || pastaMateria;
}

/**
 * Para o card "Continue de onde parou". Resolve titulo e materia na hora
 * (nao ficam guardados no `app-uso.json`, que so teria cache velho) e some
 * silenciosamente se a pagina nao existe mais no disco — apontar o card para
 * um arquivo apagado so devolveria erro pra tela.
 */
export async function ultimaLeitura(
  vault: Vault,
): Promise<{ rel: string; titulo: string; materia: string; em: string; pct: number } | null> {
  const [maisRecente] = ler(vault).visitas.slice().sort(porRecencia);
  if (!maisRecente) return null;

  let conteudo: string;
  try {
    conteudo = await vault.read(maisRecente.rel);
  } catch {
    return null; // arquivo sumiu do disco desde a ultima visita
  }

  const slug = path.posix.basename(maisRecente.rel).replace(/\.md$/i, "");
  const titulo = /^#\s+(.+)$/m.exec(conteudo)?.[1]?.trim() || slug;

  const relPosix = maisRecente.rel.split(path.sep).join("/");
  const pastaMateria = /^Resumos\/subjects\/([^/]+)\//.exec(relPosix)?.[1];
  const materia = pastaMateria ? nomeMateria(pastaMateria) : "";

  return { rel: maisRecente.rel, titulo, materia, em: maisRecente.em, pct: maisRecente.pct };
}

/** Termos do glossario marcados (bookmark), na ordem em que foram marcados. */
export async function termos(vault: Vault): Promise<string[]> {
  return ler(vault).termos.slice();
}

/**
 * Liga/desliga o bookmark de um termo. Comparacao por texto exato do termo
 * (case-insensitive, como o resto do glossario) — nao ha id proprio para
 * termo, ele e o texto que aparece em negrito na pagina.
 */
export async function alternarTermo(vault: Vault, termo: string): Promise<boolean> {
  const estado = ler(vault);
  const alvo = termo.trim();
  const idx = estado.termos.findIndex((t) => t.localeCompare(alvo, "pt", { sensitivity: "base" }) === 0);

  const marcado = idx === -1;
  if (marcado) estado.termos.push(alvo);
  else estado.termos.splice(idx, 1);

  salvar(vault, estado);
  return marcado;
}

/**
 * Paginas da wiki que ainda nao tem `-review.md` irmao — fila do que falta
 * revisar. MOC (o arquivo com o nome da propria pasta) e review em si ficam
 * de fora: nenhum dos dois e uma "aula" que se revisa.
 */
export async function revisao(
  vault: Vault,
): Promise<{ rel: string; titulo: string; materia: string; geradaEm: string }[]> {
  const out: { rel: string; titulo: string; materia: string; geradaEm: string }[] = [];

  for (const pastaMateria of await vault.listDir("Resumos/subjects")) {
    const dirRel = path.posix.join("Resumos/subjects", pastaMateria);
    const arquivos = (await vault.listDir(dirRel)).filter((f) => f.endsWith(".md"));
    const existentes = new Set(arquivos);

    for (const f of arquivos) {
      const slug = f.slice(0, -3);
      if (slug === pastaMateria || slug.endsWith("-review")) continue;
      if (existentes.has(`${slug}-review.md`)) continue; // ja revisada

      const rel = path.posix.join(dirRel, f);

      let conteudo: string;
      try {
        conteudo = await vault.read(rel);
      } catch {
        continue; // sumiu entre o listDir e a leitura — nao entra na lista
      }
      const titulo = /^#\s+(.+)$/m.exec(conteudo)?.[1]?.trim() || slug;

      /**
       * A data vem do `updated:` da PAGINA, nao do mtime do arquivo.
       *
       * mtime e quando o arquivo foi escrito neste disco — e o `pull` reescreve
       * todas as paginas ao recriar o vault, copiar a pasta faz o mesmo, e o
       * sync de nuvem tambem. O resultado era a Home jurando que seis aulas de
       * julho tinham sido "geradas hoje", o que apaga justamente a informacao
       * que a fila de revisao existe para dar: o que esta velho.
       *
       * O `updated:` e escrito pelo ingest, viaja junto com o conteudo no
       * publish/pull e nao muda quando o arquivo e copiado. O mtime fica de
       * reserva, para pagina sem frontmatter.
       */
      const doTexto = /^updated:\s*'?"?(\d{4}-\d{2}-\d{2})/m.exec(conteudo)?.[1];
      let geradaEm: string;
      if (doTexto) {
        geradaEm = new Date(`${doTexto}T12:00:00`).toISOString();
      } else {
        try {
          geradaEm = fs.statSync(vault.resolve(rel)).mtime.toISOString();
        } catch {
          continue;
        }
      }

      out.push({ rel, titulo, materia: nomeMateria(pastaMateria), geradaEm });
    }
  }

  return out;
}
