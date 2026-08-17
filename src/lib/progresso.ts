import type { Line } from "./api";
// Extensao explicita: `scripts/progresso.test.mjs` roda este arquivo no Node
// puro, e o resolvedor de ESM do Node nao completa extensao sozinho.
import { t } from "./i18n.ts";

/**
 * Progresso do ingest — deduzido, nao inventado.
 *
 * O Claude Code nao informa progresso: nao existe fracao para ler. O que
 * existe e o transcript, e o fluxo do `CLAUDE.md` e uma sequencia fixa de
 * passos que TOCAM ARQUIVOS conhecidos. Entao a barra mede evidencia: cada
 * marco so acende quando uma linha de ferramenta prova que aquele passo
 * aconteceu (leu o material oficial, escreveu a pagina, copiou o PDF...).
 *
 * Por isso a porcentagem anda em degraus e nao em fatias iguais — os passos
 * nao levam o mesmo tempo. Escrever a pagina e a maior parte do trabalho.
 *
 * A regra que nao pode ser quebrada: NUNCA voltar. O Claude relê arquivo no
 * meio do caminho, e uma barra que retrocede parece defeito.
 */
export type Marco = { pct: number; nome: string };

/** Ordem importa: o teste roda de baixo para cima, do mais adiantado. */
const MARCOS: { pct: number; nome: string; casa: RegExp }[] = [
  { pct: 12, nome: t("procurando a nota"), casa: /raw[/\\]subjects/i },
  { pct: 28, nome: t("lendo o material oficial"), casa: /raw[/\\]INATEL/i },
  { pct: 55, nome: t("escrevendo a página"), casa: /wiki[/\\]subjects/i },
  { pct: 68, nome: t("ligando ao MOC"), casa: /MOC/ },
  { pct: 80, nome: t("copiando o material"), casa: /public[/\\](materials|attachments)/i },
  { pct: 90, nome: t("atualizando index e log"), casa: /\b(index|log)\.md\b/i },
  { pct: 97, nome: t("gravando o veredito"), casa: /\.ingest-status/i },
];

/**
 * Comandos com fluxo previsivel. `review` e `delete` fazem outra coisa e nao
 * passam por estes marcos — para eles a barra e indeterminada, que e mais
 * honesto do que uma porcentagem que nao mede nada.
 */
export function temMarcos(rotulo: string | null): boolean {
  if (!rotulo) return false;
  return /^athena\s/i.test(rotulo) && !/^athena\s+delete\b/i.test(rotulo);
}

/** Ultima linha "> comando" — e o que diz qual job esta rodando agora. */
export function rotuloAtual(lines: Line[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const linha = lines[i].text.trim();
    if (linha.startsWith("> ")) return linha.slice(2).trim();
  }
  return null;
}

/**
 * Maior marco com evidencia no transcript. Varre apenas o trecho posterior ao
 * ultimo "> comando": senao um ingest anterior deixaria a barra do proximo
 * comecar cheia.
 */
export function progresso(lines: Line[]): Marco {
  let inicio = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].text.trim().startsWith("> ")) {
      inicio = i;
      break;
    }
  }

  let melhor: Marco = { pct: 4, nome: t("iniciando") };
  for (let i = inicio; i < lines.length; i++) {
    const texto = lines[i].text;
    for (const m of MARCOS) {
      if (m.pct > melhor.pct && m.casa.test(texto)) {
        melhor = { pct: m.pct, nome: m.nome };
      }
    }
  }
  return melhor;
}

/**
 * Todos os marcos com evidencia, em ordem — a lista de etapas do painel.
 *
 * Mesma varredura de `progresso`, so que guardando todos em vez do maior.
 * Nao inventa etapa futura: o painel mostra o que ja aconteceu, e o que falta
 * aparece quando acontecer.
 */
export function etapas(lines: Line[]): string[] {
  let inicio = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].text.trim().startsWith("> ")) {
      inicio = i;
      break;
    }
  }
  const vistos: string[] = [];
  for (const m of MARCOS) {
    for (let i = inicio; i < lines.length; i++) {
      if (m.casa.test(lines[i].text)) {
        vistos.push(m.nome);
        break;
      }
    }
  }
  return vistos;
}
