import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Preferencias de exibicao do app (formato de data/hora, densidade, fonte...).
 * Nao confundir com `Config` do main.ts — aquele e "onde esta o vault, qual
 * claude.exe usar"; isto e "como a interface se comporta".
 */
export type Prefs = {
  formatoData: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
  formatoHora: "24h" | "12h";
  iniciarComSistema: boolean;
  densidade: "compacta" | "padrao" | "confortavel";
  tamanhoFonte: 12 | 14 | 16 | 18 | 20;
  quebraLinha: boolean;
  confirmarExcluir: boolean;
};

/**
 * O que de fato vai para o `athena-app.json`. `iniciarComSistema` fica fora
 * de proposito: gravar um booleano nosso e o SO ter outro seria uma mentira
 * que so aparece quando os dois divergem (a pessoa desligou pelo Gerenciador
 * de Tarefas do Windows, por exemplo). A fonte de verdade e sempre o SO.
 */
export type PrefsSalvas = Omit<Prefs, "iniciarComSistema">;

export const PREFS_PADRAO: PrefsSalvas = {
  formatoData: "DD/MM/YYYY",
  formatoHora: "24h",
  densidade: "padrao",
  tamanhoFonte: 14,
  quebraLinha: true,
  confirmarExcluir: true,
};

/** Le as prefs salvas + o estado real de login-item, e devolve o objeto completo. */
export function getPrefs(salvas: Partial<PrefsSalvas> | undefined): Prefs {
  return {
    ...PREFS_PADRAO,
    ...salvas,
    iniciarComSistema: app.getLoginItemSettings().openAtLogin,
  };
}

/**
 * Aplica um patch de Prefs. `iniciarComSistema`, quando vem no patch, e
 * escrito direto no SO (`setLoginItemSettings`) — nao existe estado
 * intermediario "vou salvar depois", ou o item de login esta la ou nao esta.
 * Devolve so a parte que precisa ir para o `athena-app.json`.
 */
export function setPrefs(
  salvasAtuais: Partial<PrefsSalvas> | undefined,
  patch: Partial<Prefs>,
): PrefsSalvas {
  const { iniciarComSistema, ...resto } = patch;
  if (typeof iniciarComSistema === "boolean") {
    app.setLoginItemSettings({ openAtLogin: iniciarComSistema });
  }
  return { ...PREFS_PADRAO, ...salvasAtuais, ...resto };
}

// =====================================================================
// ZIP STORE — sem compressao, sem dependencia nova.
//
// package.json nao tem nenhuma lib de zip, e o enunciado pede pra nao
// instalar (sem rede aqui). O formato ZIP com metodo STORE (0) e simples o
// bastante pra escrever a mao: cada entrada e o arquivo cru, com um indice
// (central directory) no fim listando nome/offset/crc de cada uma. Todo
// descompactador (Explorer, 7-Zip, `unzip`) le STORE sem exigir nada alem
// da assinatura do formato.
// =====================================================================

/** Tabela de CRC-32 (polinomio padrao do ZIP/PNG/gzip), gerada uma vez. */
const TABELA_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC32[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Converte um `Date` para os campos data/hora do formato DOS que o ZIP usa. */
function dataHoraDos(mtime: Date): { data: number; hora: number } {
  const ano = Math.max(1980, mtime.getFullYear()); // ZIP nao representa antes de 1980
  const data = (((ano - 1980) & 0x7f) << 9) | ((mtime.getMonth() + 1) << 5) | mtime.getDate();
  const hora = (mtime.getHours() << 11) | (mtime.getMinutes() << 5) | ((mtime.getSeconds() / 2) | 0);
  return { data, hora };
}

/** Varre `dir` recursivamente e devolve caminhos relativos a `raiz`, pulando `ignorar`. */
function listarArquivos(raiz: string, dir: string, ignorar: Set<string>, out: string[]) {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // pasta sumiu no meio da varredura — nao derruba o export inteiro
  }
  for (const e of entradas) {
    if (ignorar.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    // symlink: nao segue — evita ciclo e arquivo fora da arvore do vault.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) listarArquivos(raiz, abs, ignorar, out);
    else if (e.isFile()) out.push(path.relative(raiz, abs));
  }
}

/**
 * Escreve `destino` como um .zip (metodo STORE) com todo o conteudo de
 * `raiz`, exceto o que estiver em `ignorar` (comparado pelo nome do
 * arquivo/pasta, em qualquer nivel — mesmo criterio de `vault.tamanho()`).
 *
 * Sincrono de proposito: e chamado uma vez, depois do dialogo de salvar, e
 * misturar leitura de arquivo grande com IPC assincrono so complicaria sem
 * ganhar nada — quem chama ja roda isto fora da thread de UI (main process).
 */
export function zipPastaStore(raiz: string, destino: string, ignorar: Set<string>): void {
  const relativos: string[] = [];
  listarArquivos(raiz, raiz, ignorar, relativos);
  relativos.sort();

  const saida = fs.openSync(destino, "w");
  try {
    let offset = 0;
    const central: Buffer[] = [];

    for (const rel of relativos) {
      const abs = path.join(raiz, rel);
      let dados: Buffer;
      let st: fs.Stats;
      try {
        dados = fs.readFileSync(abs);
        st = fs.statSync(abs);
      } catch {
        continue; // arquivo sumiu entre a varredura e a leitura — pula, nao falha o zip
      }

      const nomeZip = rel.split(path.sep).join("/"); // ZIP sempre usa "/"
      const nomeBuf = Buffer.from(nomeZip, "utf8");
      const crc = crc32(dados);
      const { data, hora } = dataHoraDos(st.mtime);

      const cabecalhoLocal = Buffer.alloc(30);
      cabecalhoLocal.writeUInt32LE(0x04034b50, 0); // assinatura do header local
      cabecalhoLocal.writeUInt16LE(20, 4); // versao minima p/ extrair
      cabecalhoLocal.writeUInt16LE(0x0800, 6); // bit 11: nome de arquivo em UTF-8
      cabecalhoLocal.writeUInt16LE(0, 8); // metodo 0 = STORE (sem compressao)
      cabecalhoLocal.writeUInt16LE(hora, 10);
      cabecalhoLocal.writeUInt16LE(data, 12);
      cabecalhoLocal.writeUInt32LE(crc, 14);
      cabecalhoLocal.writeUInt32LE(dados.length, 18); // comprimido == original no STORE
      cabecalhoLocal.writeUInt32LE(dados.length, 22);
      cabecalhoLocal.writeUInt16LE(nomeBuf.length, 26);
      cabecalhoLocal.writeUInt16LE(0, 28); // sem extra field

      fs.writeSync(saida, cabecalhoLocal);
      fs.writeSync(saida, nomeBuf);
      fs.writeSync(saida, dados);

      const cabecalhoCentral = Buffer.alloc(46);
      cabecalhoCentral.writeUInt32LE(0x02014b50, 0); // assinatura do central directory
      cabecalhoCentral.writeUInt16LE(20, 4); // versao que gravou
      cabecalhoCentral.writeUInt16LE(20, 6); // versao minima p/ extrair
      cabecalhoCentral.writeUInt16LE(0x0800, 8);
      cabecalhoCentral.writeUInt16LE(0, 10); // metodo STORE
      cabecalhoCentral.writeUInt16LE(hora, 12);
      cabecalhoCentral.writeUInt16LE(data, 14);
      cabecalhoCentral.writeUInt32LE(crc, 16);
      cabecalhoCentral.writeUInt32LE(dados.length, 20);
      cabecalhoCentral.writeUInt32LE(dados.length, 24);
      cabecalhoCentral.writeUInt16LE(nomeBuf.length, 28);
      cabecalhoCentral.writeUInt16LE(0, 30); // extra field
      cabecalhoCentral.writeUInt16LE(0, 32); // comentario
      cabecalhoCentral.writeUInt16LE(0, 34); // disco onde comeca
      cabecalhoCentral.writeUInt16LE(0, 36); // atributos internos
      cabecalhoCentral.writeUInt32LE(0, 38); // atributos externos
      cabecalhoCentral.writeUInt32LE(offset, 42); // offset do header local
      central.push(Buffer.concat([cabecalhoCentral, nomeBuf]));

      offset += cabecalhoLocal.length + nomeBuf.length + dados.length;
    }

    const centralBuf = Buffer.concat(central);
    fs.writeSync(saida, centralBuf);

    const fimCentral = Buffer.alloc(22);
    fimCentral.writeUInt32LE(0x06054b50, 0); // assinatura do end-of-central-directory
    fimCentral.writeUInt16LE(0, 4); // numero deste disco
    fimCentral.writeUInt16LE(0, 6); // disco onde comeca o central directory
    fimCentral.writeUInt16LE(central.length, 8); // entradas neste disco
    fimCentral.writeUInt16LE(central.length, 10); // entradas no total
    fimCentral.writeUInt32LE(centralBuf.length, 12); // tamanho do central directory
    fimCentral.writeUInt32LE(offset, 16); // offset onde ele comeca
    fimCentral.writeUInt16LE(0, 20); // sem comentario
    fs.writeSync(saida, fimCentral);
  } finally {
    fs.closeSync(saida);
  }
}
