import { useEffect, useState } from "react";
import { api, mensagemDeErro, type SubjectRef } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { t, tf } from "../lib/i18n";
import "../styles/biblioteca.css";

const PLACEHOLDER = t(
  "Escreva a nota da aula. O material oficial continua sendo a fonte principal — isto orienta o foco."
);

/** Tipos de nota do frontmatter — fecham as opções do select, então o disco
 *  nunca recebe um `tipo:` fora dessa lista. */
type TipoNota = "padrao" | "conceito" | "duvida" | "resumo";

/**
 * Tags e tipo não têm tabela própria — o markdown continua sendo a única
 * fonte de verdade no disco, então elas viram frontmatter YAML na frente do
 * corpo escrito no Tiptap. `corpo` nunca inclui o frontmatter: ele é somado
 * só na hora de gravar, para o editor não precisar entender YAML.
 */
function comFrontmatter(corpo: string, tags: string[], tipo: TipoNota): string {
  const linhaTags = `tags: [${tags.join(", ")}]`;
  return `---\n${linhaTags}\ntipo: ${tipo}\n---\n\n${corpo}`;
}

/** "algoritmo, redes,  teoria" -> ["algoritmo", "redes", "teoria"] */
function tagsDoTexto(texto: string): string[] {
  return texto
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Nota NOVA. Escolhe matéria e título, grava em Notes/subjects/<MATERIA>/.
 * A edição de nota que já existe é o FileEditor — aqui o assunto é criar.
 */
export function NoteEditor({
  subjects,
  onSaved,
  onIngest,
}: {
  subjects: SubjectRef[];
  onSaved: () => void;
  onIngest: (code: string, lesson: string) => void;
}) {
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsTexto, setTagsTexto] = useState("");
  const [tipo, setTipo] = useState<TipoNota>("padrao");
  const [slug, setSlug] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folder && subjects[0]) setFolder(subjects[0].folder);
  }, [subjects, folder]);

  useEffect(() => {
    if (!title) return setSlug("");
    api.fs.slug(title).then(setSlug);
  }, [title]);

  const ready = !!folder && !!title.trim();

  // Contagem simples, só para orientar o tamanho da nota — não precisa
  // entender markdown, palavra é o que fica entre espaços.
  const palavras = body.trim() ? body.trim().split(/\s+/).length : 0;
  const caracteres = body.length;

  /** Grava no disco; devolve se deu certo, para quem chamou decidir o próximo passo. */
  async function gravar(): Promise<boolean> {
    setError(null);
    try {
      const conteudo = comFrontmatter(body, tagsDoTexto(tagsTexto), tipo);
      await api.fs.write(`Notes/subjects/${folder}/${title.trim()}.md`, conteudo);
      setSaved(true);
      onSaved();
      return true;
    } catch (e) {
      setError(mensagemDeErro(e));
      return false;
    }
  }

  /** "Salvar rascunho": grava sem sair da tela nem gerar a página. */
  async function salvarRascunho() {
    await gravar();
  }

  /** "Criar nota": grava e, se deu certo, segue para o ingest — que é quem
   *  de fato "abre" a nota, transformando-a em página da wiki. Sem uma prop
   *  de navegação aqui (as props ficam como estavam), este é o único
   *  significado de "abrir" que o componente consegue cumprir sozinho. */
  async function criarNota() {
    const ok = await gravar();
    if (ok) onIngest(folder.split("-")[0], slug);
  }

  /** Sem prop para fechar a aba (mantive a lista de props como estava), o
   *  Cancelar volta o formulário ao ponto de partida em vez de sair da tela. */
  function cancelar() {
    setTitle("");
    setBody("");
    setTagsTexto("");
    setTipo("padrao");
    setSaved(false);
    setError(null);
  }

  return (
    <div className="tela">
      <header className="tela-cabecalho">
        <h1>{t("Nova nota")}</h1>
        <p>{t("Capture suas ideias, conceitos e conhecimentos.")}</p>
      </header>

      <div className="card nn-card">
        <div className="nn-grid">
          <div className="nn-campo">
            <label className="label" htmlFor="nn-titulo">
              {t("Título")}
            </label>
            <input
              id="nn-titulo"
              className="field"
              placeholder={t("Digite um título...")}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="nn-campo">
            <label className="label" htmlFor="nn-pasta">
              {t("Pasta (opcional)")}
            </label>
            <select
              id="nn-pasta"
              className="field"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              {subjects.length === 0 && (
                <option value="">{t("Nenhuma matéria em Notes/subjects")}</option>
              )}
              {subjects.map((s) => (
                <option key={s.folder} value={s.folder}>
                  {s.folder}
                </option>
              ))}
            </select>
          </div>

          <div className="nn-campo">
            <label className="label" htmlFor="nn-tags">
              {t("Tags")}
            </label>
            <input
              id="nn-tags"
              className="field"
              placeholder={t("Adicione tags separadas...")}
              value={tagsTexto}
              onChange={(e) => setTagsTexto(e.target.value)}
            />
            <p className="nn-ajuda">{t("Ex.: algoritmo, redes, teoria")}</p>
          </div>
          <div className="nn-campo">
            <label className="label" htmlFor="nn-tipo">
              {t("Tipo de nota")}
            </label>
            <select
              id="nn-tipo"
              className="field"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoNota)}
            >
              <option value="padrao">{t("Nota padrão")}</option>
              <option value="conceito">{t("Conceito")}</option>
              <option value="duvida">{t("Dúvida")}</option>
              <option value="resumo">{t("Resumo")}</option>
            </select>
            <p className="nn-ajuda">{t("Escolha o tipo que melhor descreve.")}</p>
          </div>
        </div>

        {slug && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>
            {/* Sem picotar a frase em pedaços: partir por espaço colava o
                "Vira" no nome do arquivo (`Viragerencia-....md`). */}
            {t("Vira")}: <code style={{ color: "var(--c-accent)" }}>&quot;{slug}.md&quot;</code>
          </p>
        )}

        <div className="nn-campo">
          <label className="label">{t("Conteúdo")}</label>
          <MarkdownEditor
            value={body}
            onChange={(md) => {
              setBody(md);
              setSaved(false);
            }}
            placeholder={PLACEHOLDER}
            imageBase={slug}
          />
          <p className="nn-contagem">
            {tf("Palavras: {n}", { n: palavras })} · {tf("Caracteres: {n}", { n: caracteres })}
          </p>
        </div>

        {error && <p className="nn-erro">{error}</p>}

        <div className="nn-rodape">
          <button className="btn" onClick={cancelar}>
            ✕ {t("Cancelar")}
          </button>
          <div className="nn-rodape-direita">
            {saved && <span className="nn-salvo">{tf("salva em Notes/subjects/{folder}", { folder })}</span>}
            <button className="btn" disabled={!ready} onClick={salvarRascunho}>
              {t("Salvar rascunho")}
            </button>
            <button className="btn btn-primary" disabled={!ready} onClick={criarNota}>
              {t("Criar nota")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
