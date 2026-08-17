import { useEffect, useState } from "react";
import { api, mensagemDeErro, type Cmd, type HomeData, type Target } from "../lib/api";
import { SeletorPagina, type Alvo } from "./SeletorPagina";
import { FolderIcon } from "./icons";
import { t, tf } from "../lib/i18n";
import "../styles/comandos.css";

type Props = {
  target: Target | null;
  busy: boolean;
  onStarted: () => void;
  /**
   * Link "Ver todo histórico →" no card de histórico. Opcional: quando quem
   * monta a tela ainda não tem para onde mandar esse clique, o pedido foi
   * explícito — não mostrar o link, não deixar um botão morto no lugar.
   */
  onVerHistorico?: () => void;
};

export function CommandBar({ target, busy, onStarted, onVerHistorico }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  /**
   * Regerar (e agora também "Alterar alvo") agem sobre uma página ESCOLHIDA,
   * não sobre a seleção da árvore — que é a última coisa em que você clicou,
   * quase nunca a que quer refazer ou operar agora. `seletor` guarda QUAL das
   * duas ações abriu o modal, porque o destino do "escolher" é diferente.
   */
  const [seletor, setSeletor] = useState<null | "redo" | "alvo">(null);

  /**
   * "Alterar alvo" não é dona do estado `target` — quem é dono é o App, via
   * clique na árvore, e esta tela não tem (nem deve ganhar) um setter para
   * isso. Em vez disso guardamos uma sobreposição LOCAL: escolheu uma página
   * aqui, ela manda até a próxima vez que a árvore mudar de verdade.
   */
  const [alvoOverride, setAlvoOverride] = useState<Target | null>(null);
  useEffect(() => setAlvoOverride(null), [target?.code, target?.lesson]);
  const alvo = alvoOverride ?? target;

  const [dados, setDados] = useState<HomeData | null>(null);
  useEffect(() => {
    api.fs.home().then(setDados).catch(() => setDados(null));
  }, []);

  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [duplicando, setDuplicando] = useState(false);

  const hasSource = !!alvo && (!!alvo.rawNote || alvo.official.length > 0);
  const hasPage = !!alvo?.wikiPage;
  const isSubjectScope = !!alvo && alvo.lesson === null;
  const caminho = alvo ? caminhoDeReferencia(alvo) : null;

  async function run(cmd: Cmd) {
    if (!alvo) return;
    setErro(null);
    try {
      await api.session.start(cmd, alvo.code, alvo.lesson);
      onStarted();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  async function abrirPasta() {
    if (!caminho) return;
    setErro(null);
    try {
      await api.fs.reveal(caminho);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  async function copiarCaminho() {
    if (!caminho) return;
    setErro(null);
    try {
      await api.clipboard.write(caminho);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  /**
   * Não existe comando pra isto — nem "duplicar" nem nada parecido no
   * vocabulário do athena.bat. A única cópia que dá pra fazer com segurança
   * é a da NOTA CRUA (`raw/subjects/...`): é a única área onde o app tem
   * permissão de escrever (ver vault.ts — `raw/` menos `raw/INATEL/`; `wiki/`
   * é gerada pelos comandos, nunca por uma cópia de arquivo). Por isso
   * "duplicar aula" aqui significa "duplicar a nota do aluno desta aula", e
   * o botão some quando não há nota (nada seguro para copiar).
   */
  async function duplicarAula() {
    if (!alvo?.rawNote) return;
    setErro(null);
    setDuplicando(true);
    try {
      const conteudo = await api.fs.read(alvo.rawNote);
      const barra = alvo.rawNote.lastIndexOf("/");
      const pasta = alvo.rawNote.slice(0, barra + 1);
      const base = alvo.rawNote.slice(barra + 1).replace(/\.md$/, "");
      // create() recusa sobrescrever (vault.ts) — um "Ja existe" aqui só
      // significa "tenta o próximo número", nunca troca a cópia de outra vez.
      let feito = false;
      for (let n = 1; n <= 50 && !feito; n++) {
        const novoRel = `${pasta}${base}-copia${n > 1 ? `-${n}` : ""}.md`;
        try {
          await api.fs.create(novoRel, conteudo);
          feito = true;
        } catch (e) {
          if (!mensagemDeErro(e).startsWith("Ja existe")) throw e;
        }
      }
      if (feito) onStarted();
      else setErro(t("Não achei um nome livre para a cópia."));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setDuplicando(false);
    }
  }

  /**
   * "Revisar página" abre o review já gerado. Esta tela não recebe uma prop
   * de navegação interna, então o jeito que não deixa o botão morto é abrir
   * no programa padrão — o mesmo recurso que Explorer e MaterialView já usam
   * para isto.
   */
  async function abrirReview() {
    if (!alvo?.wikiReview) return;
    setErro(null);
    try {
      await api.fs.openExternal(alvo.wikiReview);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  const modalRedo = seletor === "redo" && (
    <SeletorPagina
      titulo={t("Regerar qual página?")}
      aviso={t(
        "A página é reescrita do zero a partir do material oficial. Sua nota em raw/ não é tocada.",
      )}
      onFechar={() => setSeletor(null)}
      onEscolher={async (a) => {
        setSeletor(null);
        setErro(null);
        try {
          await api.session.start("redo", a.code, a.lesson);
          onStarted();
        } catch (e) {
          setErro(mensagemDeErro(e));
        }
      }}
    />
  );

  const modalAlvo = seletor === "alvo" && (
    <SeletorPagina
      titulo={t("Trocar o alvo dos comandos")}
      aviso={t("Escolha a aula que vai receber os próximos comandos desta tela.")}
      onFechar={() => setSeletor(null)}
      onEscolher={async (a: Alvo) => {
        setSeletor(null);
        setErro(null);
        try {
          setAlvoOverride(await api.fs.describe(a.code, a.lesson));
        } catch (e) {
          setErro(mensagemDeErro(e));
        }
      }}
    />
  );

  if (!alvo) {
    return (
      <div className="tela">
        <Cabecalho />
        {modalRedo}
        <div className="card cmd-vazio">
          <p className="cmd-vazio-texto">
            {t("Selecione uma aula ou uma matéria na árvore para habilitar os comandos.")}
          </p>
          {/* Regerar não depende da árvore: ele tem seletor próprio. */}
          <button className="btn" disabled={busy} onClick={() => setSeletor("redo")}>
            {t("Regerar do zero…")}
          </button>
        </div>
      </div>
    );
  }

  const deleteTargets = [
    alvo.wikiPage,
    alvo.mirror,
    alvo.wikiReview,
    alvo.mirrorReview,
    alvo.material,
  ].filter(Boolean) as string[];

  const paginaAlvo = dados?.paginas.find((p) => p.rel === alvo.wikiPage) ?? null;

  return (
    <div className="tela">
      <Cabecalho />
      {modalRedo}
      {modalAlvo}

      {/* ---- alvo selecionado ---- */}
      <div className="card cmd-alvo">
        <div className="cmd-alvo-topo">
          <p className="cmd-alvo-nome">
            <span className="cmd-alvo-codigo">[{alvo.code}]</span>{" "}
            {isSubjectScope ? t("— matéria inteira") : nomeDeExibicao(alvo, paginaAlvo)}
          </p>
          <button className="btn" disabled={busy} onClick={() => setSeletor("alvo")}>
            {t("Alterar alvo")}
          </button>
        </div>
        {caminho && <code className="cmd-alvo-caminho">{caminho}</code>}
        {paginaAlvo && (
          <p className="cmd-alvo-atualizado">
            {tf("Última atualização: {quando}", { quando: formatarData(paginaAlvo.updated) })}
          </p>
        )}
      </div>

      {/* ---- gerar conhecimento ---- */}
      <section>
        <p className="label cmd-secao-titulo">{t("Gerar conhecimento")}</p>
        <div className="cmd-grid">
          <CardAcao
            icone={<IconGerar />}
            variante="primary"
            titulo={t("Gerar página")}
            descricao={t(
              "Cria a página desta aula pela primeira vez, a partir da nota e do material oficial.",
            )}
            acao={t("Iniciar geração")}
            disabled={busy || !hasSource || isSubjectScope}
            title={
              isSubjectScope
                ? t("Selecione uma aula")
                : hasSource
                  ? t("Gera a página a partir do material oficial")
                  : t("Não há nota nem material oficial para esta aula")
            }
            onClick={() => run("ingest")}
          />

          <CardAcao
            icone={<IconRefazer />}
            titulo={t("Regerar do zero")}
            descricao={t(
              "Reescreve a página do zero a partir do material oficial, ignorando a versão atual.",
            )}
            acao={t("Regerar página…")}
            disabled={busy}
            title={t("Escolha qual página reescrever do zero")}
            onClick={() => setSeletor("redo")}
          />

          <CardAcao
            icone={<IconQuestoes />}
            titulo={t("Gerar questões")}
            descricao={t(
              "Cria questões de fixação a partir da página já gerada, para checar o aprendizado.",
            )}
            acao={t("Gerar questões")}
            disabled={busy || !hasPage}
            title={hasPage ? t("Questões de fixação") : t("Review precisa de uma aula existente")}
            onClick={() => run("review")}
          />

          <CardAcao
            icone={<IconOlho />}
            titulo={t("Revisar página")}
            descricao={t(
              "Abre as questões já geradas desta aula no programa padrão, para conferir ou responder.",
            )}
            acao={t("Abrir review")}
            disabled={busy || !alvo.wikiReview}
            title={
              alvo.wikiReview
                ? t("Abrir no programa padrão")
                : t("Ainda não há review gerado para esta aula")
            }
            onClick={abrirReview}
          />
        </div>
      </section>

      {/* ---- outras ações ---- */}
      <section>
        <p className="label cmd-secao-titulo">{t("Outras ações")}</p>
        <div className="cmd-outras">
          <button className="btn" disabled={!caminho} onClick={abrirPasta}>
            <IconPasta />
            {t("Abrir pasta da aula")}
          </button>
          <button className="btn" disabled={!caminho} onClick={copiarCaminho}>
            <IconCopiar />
            {copiado ? t("Copiado!") : t("Copiar caminho")}
          </button>
          <button
            className="btn btn-danger cmd-perigo"
            disabled={busy || (!hasPage && !isSubjectScope)}
            onClick={() => {
              setTyped("");
              setConfirmDelete(true);
            }}
          >
            <IconLixeira />
            {isSubjectScope ? t("Remover matéria") : t("Remover aula")}
          </button>
          {/* Sem nota crua não há o que duplicar com segurança (ver
              duplicarAula) — melhor faltar o botão do que ele nunca funcionar. */}
          {!isSubjectScope && alvo.rawNote && (
            <button className="btn" disabled={busy || duplicando} onClick={duplicarAula}>
              <IconDuplicar />
              {duplicando ? t("Duplicando…") : t("Duplicar aula")}
            </button>
          )}
        </div>
        {erro && <p className="cmd-erro">{erro}</p>}
      </section>

      {confirmDelete && (
        <div className="card cmd-confirmar">
          <p className="cmd-confirmar-titulo">
            {isSubjectScope
              ? tf("Remover a matéria {code} inteira", { code: alvo.code })
              : tf("Remover a aula {lesson}", { lesson: alvo.lesson ?? "" })}
          </p>
          <p className="cmd-confirmar-aviso">
            {t("Suas notas em raw/ e os PDFs originais ficam intactos. Some o que foi gerado:")}
          </p>
          <pre className="term">
            {isSubjectScope
              ? `wiki/subjects/${alvo.code}-*/\nathena-web/wiki/subjects/${alvo.code}-*/\nathena-web/public/materials/${alvo.code}-*/\n` +
                tf("linha da matéria em {file}", { file: "index.md" })
              : deleteTargets.join("\n") +
                (alvo.moc
                  ? `\n` + tf("linha [[{lesson}]] em {moc}", { lesson: alvo.lesson ?? "", moc: alvo.moc })
                  : "")}
          </pre>

          {isSubjectScope && (
            <input
              className="field"
              placeholder={tf("Digite {code} para confirmar", { code: alvo.code })}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}

          <div className="cmd-confirmar-acoes">
            <button
              className="btn btn-danger"
              disabled={isSubjectScope && typed.trim().toUpperCase() !== alvo.code.toUpperCase()}
              onClick={() => {
                setConfirmDelete(false);
                run("delete");
              }}
            >
              {t("Remover")}
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              {t("Cancelar")}
            </button>
          </div>
        </div>
      )}

      {/* ---- histórico de comandos ---- */}
      <div className="card cmd-historico">
        <p className="label cmd-secao-titulo">{t("Histórico de comandos")}</p>
        {!dados || dados.eventos.length === 0 ? (
          <p className="cmd-historico-vazio">{t("Nenhum comando executado ainda.")}</p>
        ) : (
          <div className="cmd-historico-lista">
            {dados.eventos.slice(0, 6).map((e, i) => (
              <div className="cmd-historico-item" data-removido={e.removido} key={i}>
                <span className="cmd-historico-icone">
                  {e.removido ? <IconLixeira /> : <IconGerar />}
                </span>
                <div className="cmd-historico-corpo">
                  <p className="cmd-historico-acao">{e.removido ? t("Remover") : t("Gerar página")}</p>
                  <p className="cmd-historico-arquivo truncar" title={e.texto}>
                    {e.slug ?? e.texto}
                  </p>
                </div>
                <span className="cmd-historico-quando">{formatarData(e.data)}</span>
                <span className="cmd-historico-estado">
                  <span className="cmd-historico-ponto" />
                  {e.removido ? t("Removido") : t("Concluído")}
                </span>
              </div>
            ))}
          </div>
        )}
        {onVerHistorico && (
          <button className="btn cmd-vermais" onClick={onVerHistorico}>
            {t("Ver todo histórico →")}
          </button>
        )}
      </div>
    </div>
  );
}

function Cabecalho() {
  return (
    <header className="tela-cabecalho">
      <h1>{t("Comandos")}</h1>
      <p>{t("Ações avançadas para transformar seu conhecimento.")}</p>
    </header>
  );
}

function CardAcao({
  icone,
  titulo,
  descricao,
  acao,
  disabled,
  title,
  onClick,
  variante,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  acao: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  variante?: "primary";
}) {
  return (
    <div className="card cmd-card">
      <span className="cmd-card-icone">{icone}</span>
      <p className="cmd-card-titulo">{titulo}</p>
      <p className="cmd-card-desc">{descricao}</p>
      <button
        className={`btn ${variante === "primary" ? "btn-primary" : ""} cmd-card-btn`}
        disabled={disabled}
        title={title}
        onClick={onClick}
      >
        {acao}
      </button>
    </div>
  );
}

/** Caminho mostrado no card do alvo e usado por "Abrir pasta"/"Copiar caminho". */
function caminhoDeReferencia(alvo: Target): string | null {
  return alvo.rawNote ?? alvo.wikiPage ?? alvo.material ?? alvo.moc ?? alvo.official[0] ?? null;
}

/**
 * Nome legível do alvo. Preferência total ao título de verdade (o `# Título`
 * da página, já extraído em `HomeData.paginas`) — só cai no slug da aula
 * (sem acento, com hífen) quando a página ainda não existe para ler o título.
 */
function nomeDeExibicao(alvo: Target, pagina: HomeData["paginas"][number] | null): string {
  if (pagina) return pagina.titulo;
  if (!alvo.lesson) return alvo.code;
  return alvo.lesson
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

/**
 * `HomeData.eventos[].data` é só a data (AAAA-MM-DD, do cabeçalho `## ` do
 * log.md) — não tem hora. Formata como "hoje" ou dd/mm/aaaa; nunca inventa
 * um horário que o log não guarda.
 */
function formatarData(iso: string): string {
  const hoje = new Date().toISOString().slice(0, 10);
  if (iso === hoje) return t("hoje");
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

/* ------------------------------------------------------------------
 * Ícones locais deste arquivo.
 *
 * `src/components/icons.tsx` não está na minha lista de arquivos — de lá
 * reaproveito só o que já existe com o mesmo sentido (FolderIcon) e desenho
 * aqui, no mesmo estilo (traço 24×24, `currentColor`), o que falta.
 * ------------------------------------------------------------------ */
function Traco({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function IconGerar() {
  return (
    <Traco>
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
    </Traco>
  );
}

function IconRefazer() {
  return (
    <Traco>
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </Traco>
  );
}

function IconQuestoes() {
  return (
    <Traco>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.3a2.8 2.8 0 1 1 3.9 2.7c-.9.5-1.3 1-1.3 1.9" />
      <path d="M12 17h.01" />
    </Traco>
  );
}

function IconOlho() {
  return (
    <Traco>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Traco>
  );
}

function IconPasta() {
  return <FolderIcon open={false} />;
}

function IconCopiar() {
  return (
    <Traco>
      <rect x="8.5" y="8.5" width="12" height="12" rx="1.6" />
      <path d="M15.5 8.5V5.6a1.6 1.6 0 0 0-1.6-1.6H5.6A1.6 1.6 0 0 0 4 5.6v8.3a1.6 1.6 0 0 0 1.6 1.6h2.9" />
    </Traco>
  );
}

function IconLixeira() {
  return (
    <Traco>
      <path d="M4 7h16" />
      <path d="M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7" />
      <path d="M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7" />
      <path d="M10 11v6M14 11v6" />
    </Traco>
  );
}

function IconDuplicar() {
  return (
    <Traco>
      <rect x="3.5" y="3.5" width="12" height="12" rx="1.6" />
      <path d="M9.5 15.5v3.2A1.8 1.8 0 0 0 11.3 20.5h7.2a1.8 1.8 0 0 0 1.8-1.8v-7.2a1.8 1.8 0 0 0-1.8-1.8h-3.2" />
    </Traco>
  );
}
