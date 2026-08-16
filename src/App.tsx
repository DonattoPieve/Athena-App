import { useCallback, useEffect, useState } from "react";
import { api, parseSelection, type SubjectRef, type Target, type TreeNode } from "./lib/api";
import { Explorer } from "./components/Explorer";
import { Home } from "./components/Home";
import { CommandBar } from "./components/CommandBar";
import { SessionPanel } from "./components/SessionPanel";
import { PublishPanel } from "./components/PublishPanel";
import { NoteEditor } from "./components/NoteEditor";
import { FileEditor } from "./components/FileEditor";
import { MarkdownView } from "./components/MarkdownView";
import { Leitura } from "./components/Leitura";
import { MaterialView } from "./components/MaterialView";
import { ImageView } from "./components/ImageView";
import { Login } from "./components/Login";
import { Settings } from "./components/Settings";
import { Profile } from "./components/Profile";
import { Avatar } from "./components/Avatar";
import { Glossario } from "./components/Biblioteca";
import { TitleBar } from "./components/TitleBar";
import { useConfirm } from "./components/Confirm";
import { SeletorPagina } from "./components/SeletorPagina";
import { t, tf } from "./lib/i18n";
import {
  IconArquivos,
  IconBusca,
  IconComandos,
  IconConfig,
  IconLado,
  IconLivro,
  IconMais,
  IconPerfil,
} from "./components/icons";
import type { Account } from "./lib/api";

type Scope = "raw" | "wiki";

const MATERIAL = /\.(pdf|pptx?|docx?)$/i;
const TEXTO = /\.(md|txt)$/i;
/** O Chromium do Electron desenha todos estes — nao precisa de programa de fora. */
const IMAGEM = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
/** Editavel = raw/ inteiro menos raw/INATEL — espelha o vault.ts. */
const EDITAVEL = (rel: string) => rel.startsWith("raw/") && !rel.startsWith("raw/INATEL/");

/**
 * ABAS
 * ----
 * Tudo que se abre e uma aba, como num editor de codigo. "Comandos" e fixa
 * (nao fecha) porque e de onde os comandos saem; as outras nascem do clique
 * na arvore e morrem no X.
 *
 * Antes existia um item "Arquivo" na navegacao mostrando o selecionado: so
 * cabia um por vez, e clicar na arvore trocava o que voce estava lendo.
 */
type Aba =
  | { id: "home"; tipo: "home" }
  | { id: "comandos"; tipo: "comandos" }
  | { id: "config"; tipo: "config" }
  | { id: "perfil"; tipo: "perfil" }
  | { id: "nova-nota"; tipo: "nova-nota" }
  | { id: "glossario"; tipo: "glossario" }
  | { id: string; tipo: "arquivo"; rel: string };

const ABA_HOME: Aba = { id: "home", tipo: "home" };
const ABA_COMANDOS: Aba = { id: "comandos", tipo: "comandos" };
const ABA_CONFIG: Aba = { id: "config", tipo: "config" };
const ABA_PERFIL: Aba = { id: "perfil", tipo: "perfil" };
const ABA_GLOSSARIO: Aba = { id: "glossario", tipo: "glossario" };

const ROTULO: Record<string, string> = {
  home: t("Home"),
  comandos: t("Comandos"),
  config: t("Configurações"),
  perfil: t("Perfil"),
  "nova-nota": t("Nova nota"),
  glossario: t("Glossário"),
};

/** Painel que o rail de icones mostra na lateral. */
type Painel = "arquivos" | "busca";

/** Ordem de fabrica do rail. A escolhida pelo usuario mora no localStorage. */
const RAIL_PADRAO = [
  "arquivos",
  "busca",
  "glossario",
  "comandos",
  "nova",
  "config",
  "perfil",
];

/**
 * Ordem salva reconciliada com a de fabrica: some o que nao existe mais e
 * entram no fim os icones criados depois de a ordem ter sido salva. Sem isto,
 * quem arrastou uma vez deixaria de ver qualquer botao novo do app.
 */
function lerOrdemRail(): string[] {
  let salva: string[] = [];
  try {
    const bruto = JSON.parse(localStorage.getItem("athena-rail") ?? "[]");
    if (Array.isArray(bruto)) salva = bruto.filter((x) => typeof x === "string");
  } catch {
    salva = [];
  }
  const validos = salva.filter((id) => RAIL_PADRAO.includes(id));
  return [...validos, ...RAIL_PADRAO.filter((id) => !validos.includes(id))];
}

const MENU_MIN = 190;
const MENU_MAX = 520;
const MENU_PADRAO = 260;

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  /** null = ainda verificando; false = precisa entrar. */
  const [conta, setConta] = useState<Account | null | false>(null);
  const [scope, setScope] = useState<Scope>("raw");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileText, setFileText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [abas, setAbas] = useState<Aba[]>([ABA_HOME]);
  const [ativa, setAtiva] = useState<string>("home");

  /** Aba sendo arrastada na barra — indice, nao id, porque a ordem e o dado. */
  const [arrastando, setArrastando] = useState<number | null>(null);

  const [painel, setPainel] = useState<Painel>("arquivos");
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState<{ nome: string; rel: string }[]>([]);
  /** Resultados de dentro dos arquivos — o nome nem sempre lembra o assunto. */
  const [noConteudo, setNoConteudo] = useState<
    { rel: string; linha: number; trecho: string }[]
  >([]);

  const [ordemRail, setOrdemRail] = useState<string[]>(lerOrdemRail);
  const [railArrasto, setRailArrasto] = useState<number | null>(null);

  /** Lado da lateral: quem usa em monitor grande costuma querer do outro. */
  const [lado, setLado] = useState<"esq" | "dir">(
    () => (localStorage.getItem("athena-lado") === "dir" ? "dir" : "esq"),
  );

  const [larguraMenu, setLarguraMenu] = useState(() => {
    const salvo = Number(localStorage.getItem("athena-menu-w"));
    return salvo >= MENU_MIN && salvo <= MENU_MAX ? salvo : MENU_PADRAO;
  });

  const { confirmar, dialogo } = useConfirm();
  /** Ctrl+P: abrir arquivo sem tirar a mao do teclado. */
  const [abrindoRapido, setAbrindoRapido] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  /**
   * Atalhos.
   *
   * O app tem cara de IDE; quem usa IDE tem o reflexo no dedo. Ctrl+P abre
   * pagina, Ctrl+W fecha a aba, Ctrl+Shift+P vai para os comandos.
   *
   * O Ctrl+W NAO dispara com o cursor dentro do editor. Fechar a aba com a
   * mao no texto e o caminho curto para perder o que estava sendo escrito, e
   * o dedo erra `w` mirando em outra tecla o tempo todo. Ctrl+P continua
   * valendo la: abrir outra pagina no meio da escrita e pedido legitimo.
   *
   * A lista destes atalhos vive em Configuracoes — atalho que so existe no
   * codigo e atalho que ninguem usa.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const alvo = e.target as HTMLElement | null;
      const escrevendo =
        !!alvo &&
        (alvo.isContentEditable ||
          alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA");

      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        if (e.shiftKey) abrirFixa(ABA_COMANDOS);
        else setAbrindoRapido(true);
      } else if (k === "w" && !escrevendo) {
        e.preventDefault();
        fechar(ativa);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    localStorage.setItem("athena-menu-w", String(larguraMenu));
  }, [larguraMenu]);

  useEffect(() => {
    localStorage.setItem("athena-lado", lado);
  }, [lado]);

  // Lista achatada dos dois escopos — e o que a busca varre.
  useEffect(() => {
    if (!vaultPath) return;
    Promise.all([api.fs.tree("raw"), api.fs.tree("wiki")])
      .then(([r, w]) => setTodos([...achatar(r), ...achatar(w)]))
      .catch(() => setTodos([]));
  }, [vaultPath, refreshKey]);

  useEffect(() => {
    api.vault.get().then((v) => setVaultPath(v.path));
    return api.vault.onChange(refresh);
  }, [refresh]);

  // Busca no conteudo com espera: cada tecla varreria o vault inteiro.
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) {
      setNoConteudo([]);
      return;
    }
    const timer = setTimeout(() => {
      api.fs.buscar(q).then(setNoConteudo).catch(() => setNoConteudo([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [busca]);

  // A sessao do Supabase e a porta: sem ela, o app nem monta.
  useEffect(() => {
    if (!vaultPath) return;
    let vivo = true;
    api.account
      .status()
      .then((c) => vivo && setConta(c ?? false))
      .catch(() => vivo && setConta(false));
    return () => {
      vivo = false;
    };
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath) return;
    api.fs.tree(scope).then(setTree).catch(() => setTree([]));
    api.fs.subjects().then(setSubjects).catch(() => setSubjects([]));
  }, [vaultPath, scope, refreshKey]);

  useEffect(() => {
    if (!selected) return setTarget(null);
    const sel = parseSelection(selected);
    if (!sel) return setTarget(null);
    api.fs.describe(sel.code, sel.lesson).then(setTarget).catch(() => setTarget(null));
  }, [selected, refreshKey]);

  const aba = abas.find((a) => a.id === ativa);
  const relAtiva = aba?.tipo === "arquivo" ? aba.rel : null;

  // Texto da aba ativa quando ela e leitura (wiki). A edicao le por conta.
  useEffect(() => {
    if (!relAtiva || !TEXTO.test(relAtiva)) return;
    api.fs.read(relAtiva).then(setFileText).catch(() => setFileText(""));
  }, [relAtiva, refreshKey]);

  function abrir(rel: string) {
    setAbas((atuais) =>
      atuais.some((a) => a.id === rel) ? atuais : [...atuais, { id: rel, tipo: "arquivo", rel }],
    );
    setAtiva(rel);
  }

  function abrirFixa(nova: Aba) {
    setAbas((atuais) => (atuais.some((a) => a.id === nova.id) ? atuais : [...atuais, nova]));
    setAtiva(nova.id);
  }

  function fechar(id: string) {
    if (id === "home") return; // a home e o chao da casa
    setAbas((atuais) => {
      const i = atuais.findIndex((a) => a.id === id);
      if (i === -1) return atuais;
      const restantes = atuais.filter((a) => a.id !== id);
      // Fechou a que estava aberta: vai para a vizinha da direita, senao a da
      // esquerda — o mesmo que qualquer editor faz.
      if (ativa === id) setAtiva((restantes[i] ?? restantes[i - 1] ?? ABA_HOME).id);
      return restantes.length ? restantes : [ABA_HOME];
    });
  }

  /**
   * Regera a pagina de um caminho. Confirma antes: `redo` reescreve o arquivo
   * inteiro, e um clique sem aviso num botao ao lado da estrela seria caro.
   */
  async function regerar(rel: string) {
    const alvo = parseSelection(rel);
    if (!alvo?.lesson) return;
    const ok = await confirmar({
      titulo: tf("Regerar {lesson}?", { lesson: alvo.lesson }),
      mensagem: tf(
        "Roda {cmd}: a página é reescrita do ZERO a partir do material oficial, sem reaproveitar a versão atual.",
        { cmd: `athena redo ${alvo.code} ${alvo.lesson}` },
      ),
      detalhe: rel,
      nota: t(
        "Sua nota em raw/ e o material oficial não são tocados. A versão atual da página se perde — se ela tem edição sua à mão, copie antes.",
      ),
      confirmar: t("Regerar"),
    });
    if (!ok) return;
    await api.session.start("redo", alvo.code, alvo.lesson);
  }

  /** Mesma mecanica das abas, aplicada aos icones do rail. */
  function moverRail(de: number, para: number) {
    if (de === para) return;
    setOrdemRail((atual) => {
      const copia = [...atual];
      const [movido] = copia.splice(de, 1);
      copia.splice(para, 0, movido);
      localStorage.setItem("athena-rail", JSON.stringify(copia));
      return copia;
    });
  }

  /** Solta a aba arrastada na posicao de destino. */
  function reordenar(de: number, para: number) {
    if (de === para) return;
    setAbas((atuais) => {
      const copia = [...atuais];
      const [movida] = copia.splice(de, 1);
      copia.splice(para, 0, movida);
      return copia;
    });
  }

  async function pick() {
    setError(null);
    try {
      const r = await api.vault.pick();
      setVaultPath(r.path);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Arrasta a divisoria; duplo clique volta ao padrao. */
  function arrastarMenu(e: React.MouseEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = larguraMenu;
    // Na direita o eixo inverte: puxar para a esquerda alarga o painel.
    const sinal = lado === "esq" ? 1 : -1;
    const mover = (ev: MouseEvent) =>
      setLarguraMenu(Math.min(MENU_MAX, Math.max(MENU_MIN, w0 + sinal * (ev.clientX - x0))));
    const soltar = () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    // Sem isto, arrastar seleciona o texto da arvore inteira.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
  }

  if (vaultPath && conta === null) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--c-muted)" }}>{t("verificando a conta…")}</p>
      </div>
    );
  }

  if (vaultPath && conta === false) {
    return (
      <Login
        vaultPath={vaultPath}
        onEntrou={setConta}
        onTrocarVault={async () => {
          await api.vault.pick().catch(() => {});
          window.location.reload();
        }}
      />
    );
  }

  if (!vaultPath) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ padding: 28, maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 600, margin: "0 0 8px" }}>Athena</h1>
          <p style={{ color: "var(--c-muted)", margin: "0 0 20px" }}>
            {t("Aponte para a pasta do vault — a mesma que tem")} <code>CLAUDE.md</code>{" "}
            {t("e")} <code>raw/</code>.
          </p>
          <button className="btn btn-primary" onClick={pick}>
            {t("Escolher pasta")}
          </button>
          {error && <p style={{ color: "#e24b4a", marginTop: 14, fontSize: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  // Passou pelos tres portoes acima (vault escolhido, conta verificada, conta
  // presente): daqui pra baixo a conta existe.
  const contaAtual = conta as Account;

  /** Conteudo de uma aba de arquivo: edita, le ou visualiza. */
  function Arquivo({ rel }: { rel: string }) {
    if (MATERIAL.test(rel)) return <MaterialView rel={rel} />;
    if (IMAGEM.test(rel)) return <ImageView rel={rel} />;

    if (TEXTO.test(rel) && EDITAVEL(rel)) {
      return (
        <FileEditor
          rel={rel}
          onSaved={refresh}
          onIngest={async (code, lesson) => {
            await api.session.start("ingest", code, lesson);
            setAtiva("comandos");
          }}
        />
      );
    }

    if (TEXTO.test(rel)) {
      return <Leitura rel={rel} texto={fileText} onAbrir={abrir} onRegerar={regerar} />;
    }

    return (
      <div className="card" style={{ padding: 24 }}>
        <p style={{ color: "var(--c-muted)", margin: 0 }}>
          {t("Não sei abrir")} <code>{rel}</code>{" "}
          {t("aqui. Use o botão direito na árvore para abrir no programa padrão.")}
        </p>
      </div>
    );
  }

  /**
   * Os botoes do rail viram DADO para poderem ser reordenados: a ordem e uma
   * lista de ids no localStorage, e o arrasto so mexe nessa lista. Ids que
   * sumirem de uma versao para outra sao ignorados, e ids novos entram no fim —
   * assim uma ordem antiga salva nunca esconde um icone recem-criado.
   */
  const RAIL: Record<string, { icone: React.ReactNode; titulo: string; ativo: boolean; ir: () => void }> = {
    arquivos: {
      icone: <IconArquivos />,
      titulo: t("Arquivos"),
      ativo: painel === "arquivos",
      ir: () => setPainel("arquivos"),
    },
    busca: {
      icone: <IconBusca />,
      titulo: t("Buscar arquivo"),
      ativo: painel === "busca",
      ir: () => setPainel("busca"),
    },
    comandos: {
      icone: <IconComandos />,
      titulo: t("Comandos do Athena (gerar, regerar, questões, remover)"),
      ativo: ativa === "comandos",
      ir: () => abrirFixa(ABA_COMANDOS),
    },
    glossario: {
      icone: <IconLivro />,
      titulo: t("Glossário"),
      ativo: ativa === "glossario",
      ir: () => abrirFixa(ABA_GLOSSARIO),
    },
    nova: {
      icone: <IconMais />,
      titulo: t("Nova nota"),
      ativo: ativa === "nova-nota",
      ir: () => abrirFixa({ id: "nova-nota", tipo: "nova-nota" }),
    },
    config: {
      icone: <IconConfig />,
      titulo: t("Configurações"),
      ativo: ativa === "config",
      ir: () => abrirFixa(ABA_CONFIG),
    },
    perfil: {
      icone: <IconPerfil />,
      titulo: tf("Perfil — {nome}", { nome: contaAtual.name || contaAtual.email }),
      ativo: ativa === "perfil",
      ir: () => abrirFixa(ABA_PERFIL),
    },
  };

  const railBotoes = (
    <div className="rail">
      {ordemRail.map((id, i) => {
        const b = RAIL[id];
        if (!b) return null;
        return (
          <button
            key={id}
            className="rail-btn"
            data-active={b.ativo}
            data-arrastando={railArrasto === i}
            title={tf("{titulo}\n(arraste para mudar de lugar)", { titulo: b.titulo })}
            draggable
            onClick={b.ir}
            onDragStart={(e) => {
              setRailArrasto(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (railArrasto !== null) moverRail(railArrasto, i);
              setRailArrasto(null);
            }}
            onDragEnd={() => setRailArrasto(null)}
          >
            {b.icone}
          </button>
        );
      })}

      {/* Fora da lista de proposito: nao abre painel nenhum, so vira o layout. */}
      <button
        className="rail-btn rail-fim"
        title={lado === "esq" ? t("Mover a lateral para a direita") : t("Mover a lateral para a esquerda")}
        onClick={() => setLado((l) => (l === "esq" ? "dir" : "esq"))}
      >
        <IconLado direita={lado === "esq"} />
      </button>
    </div>
  );

  const lateral = (
    <aside
      style={{
        background: "var(--c-bg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div style={{ padding: "14px 12px 8px" }}>
        <strong style={{ fontWeight: 600 }}>Athena</strong>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 11,
            color: "var(--c-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={vaultPath}
        >
          {vaultPath}
        </p>
        {/* Quem esta logado fica a vista: a conta decide para ONDE o publish
            manda, e ate agora so dava para descobrir abrindo o Perfil. */}
        <button
          className="quem-sou"
          title={tf("{nome} · {email} — abrir o perfil", {
            nome: contaAtual.name,
            email: contaAtual.email,
          })}
          onClick={() => abrirFixa(ABA_PERFIL)}
        >
          <Avatar conta={contaAtual} />
          {/* Nome, nao e-mail: e o que a pessoa reconhece de relance. O e-mail
              continua no title, que e onde se confere quando a duvida aparece. */}
          <span className="quem-sou-nome">{contaAtual.name || contaAtual.email}</span>
        </button>
      </div>

      {painel === "arquivos" ? (
        <>
          <div style={{ padding: "6px 12px 4px", display: "flex", gap: 6 }}>
            <button
              className="btn"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              data-active={scope === "raw"}
              onClick={() => setScope("raw")}
            >
              raw
            </button>
            <button
              className="btn"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              data-active={scope === "wiki"}
              onClick={() => setScope("wiki")}
            >
              wiki
            </button>
          </div>

          <p className="label" style={{ padding: "6px 12px 2px" }}>
            {t("Explorer")} {scope === "wiki" && t("· somente leitura")}
          </p>
          <div className="scroll" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
            <Explorer
              nodes={tree}
              selected={selected}
              onSelect={setSelected}
              onChanged={refresh}
              scope={scope}
              readOnly={scope === "wiki"}
              onOpen={abrir}
              onExcluir={async (code, lesson) => {
                await api.session.start("delete", code, lesson);
                setAtiva("comandos");
              }}
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: "6px 12px" }}>
            <input
              className="field"
              autoFocus
              placeholder={t("Nome do arquivo…")}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            />
          </div>
          <div className="scroll" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
            {(() => {
              const q = busca.trim().toLowerCase();
              const achados = q
                ? todos.filter((f) => (f.nome + f.rel).toLowerCase().includes(q)).slice(0, 60)
                : [];
              if (!q)
                return (
                  <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
                    {t("Digite para procurar em raw/ e wiki/.")}
                  </p>
                );
              if (achados.length === 0 && noConteudo.length === 0)
                return (
                  <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
                    {tf("Nada com “{q}”.", { q: busca })}
                  </p>
                );
              return achados.map((f) => (
                <button
                  key={f.rel}
                  className="nav-item"
                  data-active={selected === f.rel}
                  onClick={() => {
                    setSelected(f.rel);
                    abrir(f.rel);
                  }}
                  title={f.rel}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.nome}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "var(--c-muted)",
                      flex: "0 0 auto",
                    }}
                  >
                    {f.rel.split("/")[0]}
                  </span>
                </button>
              ));
            })()}

            {/* Dentro dos arquivos. Separado do nome de proposito: sao duas
                perguntas diferentes — "como se chamava?" e "onde eu falei
                disso?" — e misturar as duas listas esconde a segunda. */}
            {noConteudo.length > 0 && (
              <>
                <p className="label" style={{ padding: "12px 10px 4px" }}>
                  {tf("No conteúdo · {n}", { n: noConteudo.length })}
                </p>
                {noConteudo.map((r) => (
                  <button
                    key={`${r.rel}:${r.linha}`}
                    className="nav-item busca-conteudo"
                    onClick={() => {
                      setSelected(r.rel);
                      abrir(r.rel);
                    }}
                    title={`${r.rel}:${r.linha}`}
                  >
                    <span className="truncar" style={{ fontSize: 12 }}>
                      {(r.rel.split("/").pop() ?? r.rel).replace(/\.md$/, "")}
                    </span>
                    <span className="busca-trecho">{r.trecho}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );

  const divisoria = (
    <div
      className="splitter"
      onMouseDown={arrastarMenu}
      onDoubleClick={() => setLarguraMenu(MENU_PADRAO)}
      title={t("Arraste para redimensionar · duplo clique volta ao padrão")}
      role="separator"
      aria-orientation="vertical"
    />
  );

  const principal = (
    <main style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      <div className="tabs">
        {abas.map((a, i) => (
          <div
            key={a.id}
            className="tab"
            data-active={a.id === ativa}
            data-arrastando={arrastando === i}
            draggable
            onClick={() => setAtiva(a.id)}
            onAuxClick={(e) => e.button === 1 && fechar(a.id)}
            onDragStart={(e) => {
              setArrastando(i);
              e.dataTransfer.effectAllowed = "move";
              // Firefox/Chromium so iniciam o arrasto com algum dado setado.
              e.dataTransfer.setData("text/plain", a.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (arrastando !== null) reordenar(arrastando, i);
              setArrastando(null);
            }}
            onDragEnd={() => setArrastando(null)}
            title={a.tipo === "arquivo" ? a.rel : undefined}
          >
            <span className="tab-nome">
              {a.tipo === "arquivo" ? (a.rel.split("/").pop() ?? a.rel) : ROTULO[a.tipo]}
            </span>
            {a.id !== "home" && (
              <button
                className="tab-x"
                title={t("Fechar")}
                onClick={(e) => {
                  e.stopPropagation();
                  fechar(a.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="tab-add"
          title={t("Nova nota")}
          onClick={() => abrirFixa({ id: "nova-nota", tipo: "nova-nota" })}
        >
          +
        </button>

        {/* Sempre montado e sempre visível, na ponta direita da barra: o
            transcript vive aqui, e é o único aviso de que o Claude parou para
            perguntar. Some da barra em nenhuma tela — nem na leitura. */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 6 }}>
          <SessionPanel onStateChange={setBusy} />
        </div>
      </div>

      <div
        className="scroll"
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 0,
        }}
      >
        {contaAtual.offline && (
          <div className="card alerta-conta" style={{ boxShadow: "inset 3px 0 0 var(--c-muted)" }}>
            <strong>{t("Sem conexão — publicar e puxar estão bloqueados.")}</strong>
            <p style={{ marginBottom: 0 }}>{t("O resto funciona: o vault é este disco.")}</p>
          </div>
        )}

        {contaAtual.contaAnterior && (
          <div className="card alerta-conta">
            <strong>{tf("Este vault era da conta {conta}.", { conta: contaAtual.contaAnterior })}</strong>
            <p>
              {t("Publicar agora manda o conteúdo desta pasta para")} <code>{contaAtual.email}</code>.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={async () => {
                  await api.account.assumirVault(contaAtual.email);
                  setConta({ ...contaAtual, contaAnterior: undefined });
                }}
              >
                {t("Entendi, este vault é desta conta")}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await api.account.logout();
                  setConta(false);
                }}
              >
                {tf("Sair e entrar com {conta}", { conta: contaAtual.contaAnterior })}
              </button>
            </div>
          </div>
        )}

        {aba?.tipo === "home" && (
          <Home
            key={refreshKey}
            onAbrir={abrir}
            onNovaNota={() => abrirFixa({ id: "nova-nota", tipo: "nova-nota" })}
            onComandos={() => abrirFixa(ABA_COMANDOS)}
          />
        )}

        {aba?.tipo === "comandos" && (
          <CommandBar target={target} busy={busy} onStarted={refresh} />
        )}

        {aba?.tipo === "nova-nota" && (
          <NoteEditor
            subjects={subjects}
            onSaved={refresh}
            onIngest={async (code, lesson) => {
              await api.session.start("ingest", code, lesson);
              setAtiva("comandos");
            }}
          />
        )}

        {aba?.tipo === "config" && (
          <Settings vaultPath={vaultPath} onTrocouVault={() => window.location.reload()} />
        )}

        {aba?.tipo === "perfil" && (
          <Profile conta={contaAtual} onSaiu={() => setConta(false)} onConta={setConta} />
        )}

        {aba?.tipo === "glossario" && <Glossario onAbrir={abrir} />}

        {aba?.tipo === "arquivo" && <Arquivo rel={aba.rel} />}

        {/* Painel unico e sempre montado: trocar de aba nao pode desmontar a
            sessao — era assim que o log e o campo do AGUARDANDO RESPOSTA
            sumiam justo depois de "Gerar pagina".

            Na leitura ele fica ESCONDIDO, nao desmontado: a aba de leitura
            existe para dar a tela ao texto, e uma faixa "sessao ociosa" embaixo
            de uma aula e ruido. Escondido por CSS, o transcript continua vivo e
            o "aguardando voce" nao se perde enquanto voce le. */}
        {aba?.tipo === "comandos" && <PublishPanel refreshKey={refreshKey} />}
      </div>
    </main>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <TitleBar />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns:
            lado === "esq"
              ? `44px ${larguraMenu}px 5px 1fr`
              : `1fr 5px ${larguraMenu}px 44px`,
        }}
      >
        {dialogo}
        {abrindoRapido && (
          <SeletorPagina
            titulo={t("Abrir página")}
            aviso=""
            onFechar={() => setAbrindoRapido(false)}
            onEscolher={(a) => {
              setAbrindoRapido(false);
              abrir(a.rel);
            }}
          />
        )}
        {lado === "esq" ? (
          <>
            {railBotoes}
            {lateral}
            {divisoria}
            {principal}
          </>
        ) : (
          <>
            {principal}
            {divisoria}
            {lateral}
            {railBotoes}
          </>
        )}
      </div>
    </div>
  );
}

/** Achata a arvore em lista de arquivos — a busca nao navega, ela filtra. */
function achatar(nodes: TreeNode[]): { nome: string; rel: string }[] {
  const saida: { nome: string; rel: string }[] = [];
  const andar = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.dir) andar(n.children ?? []);
      else saida.push({ nome: n.name, rel: n.rel });
    }
  };
  andar(nodes);
  return saida;
}
