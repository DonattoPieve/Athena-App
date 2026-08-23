import type { TreeNode } from "./vault";

/**
 * O espelho do bucket dentro da árvore — a parte que é só cálculo.
 *
 * Está separada de `materiais.ts` de propósito: lá dentro tudo depende do
 * `electron` e da sessão do Supabase, e nada disso pode ser exercitado num
 * teste. Aqui não há rede, disco nem app — só a regra de como um arquivo que
 * está na conta, mas ainda não nesta máquina, aparece na lateral. É a regra que
 * quebra em silêncio (nó duplicado, pasta fantasma, ordem trocada), então é
 * justamente a que precisa de teste. Ver `scripts/espelho.test.mjs`.
 */

export type Grupo = "inatel" | "raw-attachments";

/**
 * Onde cada grupo do bucket mora dentro do vault.
 *
 * Os nomes de grupo (`inatel`, `raw-attachments`) são PREFIXO DE CHAVE no R2,
 * não pasta: os objetos já estão gravados assim e renomeá-los custaria
 * recopiar centenas de MB sem mudar nada para quem usa. Por isso só o lado
 * local virou `Notes/`. Esta tabela é a tradução entre os dois — e é a única,
 * tanto o caminho de leitura quanto o espelho saem daqui.
 */
export const DENTRO_DO_VAULT: Record<Grupo, string> = {
  inatel: "Notes/INATEL",
  "raw-attachments": "Notes/attachments",
};

export type ItemEspelho = {
  /** Caminho como o vault o veria: `Notes/INATEL/C09-x/aula.pdf`. */
  rel: string;
  size: number;
  /** Já foi aberto uma vez nesta máquina — abre de novo sem internet. */
  emCache: boolean;
};

/** O escopo pedido pela árvore chega a tocar material do bucket? */
export function tocaOBucket(base: string): boolean {
  return Object.values(DENTRO_DO_VAULT).some(
    (p) => p === base || p.startsWith(base + "/") || base.startsWith(p + "/"),
  );
}

/**
 * Junta o espelho do bucket na árvore lida do disco.
 *
 * É a peça que faltava para um PC novo: o pull traz o texto, mas os 340 MB de
 * material do professor ficam no R2 até alguém abrir. Sem isto a pessoa entra
 * numa conta que TEM material e vê pasta vazia — e não há gesto possível que
 * traga o arquivo, porque o download nasce do clique.
 *
 * O QUE ESTÁ NO DISCO GANHA SEMPRE: quem já baixou tudo continua vendo a
 * própria árvore, sem nó duplicado e sem nó fantasma. A árvore recebida é
 * modificada no lugar e devolvida.
 */
export function mesclarArvore(
  base: string,
  itens: ItemEspelho[],
  arvore: TreeNode[],
): TreeNode[] {
  if (itens.length === 0) return arvore;

  const jaExiste = new Set<string>();
  const andar = (ns: TreeNode[]) => {
    for (const n of ns) {
      jaExiste.add(n.rel);
      if (n.children) andar(n.children);
    }
  };
  andar(arvore);

  let mudou = false;
  for (const item of itens) {
    if (!item.rel.startsWith(base + "/")) continue;
    if (jaExiste.has(item.rel)) continue;
    inserir(arvore, base, item, jaExiste);
    mudou = true;
  }
  return mudou ? ordenar(arvore) : arvore;
}

/** Abre o caminho do arquivo na árvore, criando as pastas que faltarem. */
function inserir(raiz: TreeNode[], base: string, item: ItemEspelho, jaExiste: Set<string>) {
  const partes = item.rel.slice(base.length + 1).split("/");
  let nivel = raiz;
  let rel = base;

  for (let i = 0; i < partes.length - 1; i++) {
    rel = `${rel}/${partes[i]}`;
    let pasta = nivel.find((n) => n.dir && n.rel === rel);
    if (!pasta) {
      pasta = { name: partes[i], rel, dir: true, children: [], remoto: true };
      nivel.push(pasta);
      jaExiste.add(rel);
    }
    // A pasta pode ter vindo do disco sem `children` (não acontece hoje, mas
    // depender disso deixaria o bug mudo se a leitura mudar).
    pasta.children ??= [];
    nivel = pasta.children;
  }

  nivel.push({
    name: partes[partes.length - 1],
    rel: item.rel,
    dir: false,
    remoto: true,
    emCache: item.emCache,
  });
  jaExiste.add(item.rel);
}

/** Mesma ordem do disco: pasta antes de arquivo, resto alfabético. */
function ordenar(nos: TreeNode[]): TreeNode[] {
  nos.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  for (const n of nos) if (n.children) ordenar(n.children);
  return nos;
}
