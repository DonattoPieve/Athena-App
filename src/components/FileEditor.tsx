import { useEffect, useState } from "react";
import { api, mensagemDeErro, parseSelection } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";
import { t } from "../lib/i18n";

/**
 * Edição de nota que já existe em `Notes/`.
 *
 * Clicar numa nota na árvore abre ela aqui, editável, e Salvar grava no mesmo
 * arquivo. As guardas do vault continuam valendo: se o caminho não for
 * gravável (Notes/INATEL, Resumos/), o main recusa e a mensagem aparece.
 */
export function FileEditor({
  rel,
  onSaved,
  onIngest,
}: {
  rel: string;
  onSaved: () => void;
  onIngest: (code: string, lesson: string) => void;
}) {
  const [body, setBody] = useState("");
  const [original, setOriginal] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    api.fs
      .read(rel)
      .then((texto) => {
        if (!vivo) return;
        setBody(texto);
        setOriginal(texto);
        setSalvo(false);
      })
      .catch((e) => vivo && setErro(mensagemDeErro(e)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [rel]);

  const nome = rel.split("/").pop() ?? rel;
  const sujo = body !== original;
  const sel = parseSelection(rel);
  /**
   * Titulo legivel a partir do nome do arquivo: sem `.md` e com a primeira
   * letra maiuscula. Nao mexe no resto — `introdução ao endereçamento de
   * rede.md` vira `Introdução ao endereçamento de rede`, e um nome que ja
   * veio com maiusculas continua como o dono escreveu.
   */
  const titulo = nome.replace(/\.md$/i, "").replace(/^./, (c) => c.toUpperCase());
  const pasta = rel.slice(0, rel.length - nome.length);

  async function salvar() {
    setErro(null);
    try {
      await api.fs.write(rel, body);
      setOriginal(body);
      setSalvo(true);
      onSaved();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Sem o rotulo "EDITANDO": voce sabe que esta editando porque tem um
          campo de texto na sua frente. O que a tela precisa dizer e QUAL aula. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <h2 className="editor-titulo">{titulo}</h2>
        <span
          style={{
            marginLeft: "auto",
            paddingTop: 3,
            fontSize: 12,
            whiteSpace: "nowrap",
            color: sujo ? "#ba7517" : "var(--c-muted)",
          }}
        >
          {carregando ? t("abrindo…") : sujo ? t("não salvo") : salvo ? t("salvo") : t("sem alterações")}
        </span>
      </div>

      {/* Materia na frente do caminho: e a resposta a "de que aula e isto",
          que o nome do arquivo sozinho nao da. */}
      <p className="editor-caminho">{sel ? `${sel.code} · ${pasta}` : rel}</p>

      {!carregando && (
        <MarkdownEditor
          value={body}
          onChange={(md) => {
            setBody(md);
            setSalvo(false);
          }}
          placeholder={t("Nota vazia. Escreva o que orienta o foco desta aula.")}
          imageBase={nome.replace(/\.[a-z0-9]+$/i, "")}
        />
      )}

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}

      {/*
        A ordem diz o que a tela e para: "Gerar pagina" e a acao, Salvar e
        manutencao, e Descartar apaga o que voce acabou de escrever — por isso
        foi para o canto oposto, longe do dedo.
      */}
      <div className="editor-acoes">
        {sel?.lesson && (
          <button
            className="btn btn-primary"
            disabled={sujo}
            onClick={() => onIngest(sel.code, sel.lesson!)}
            title={sujo ? t("Salve antes — o ingest lê o arquivo do disco") : t("Gera a página desta aula")}
          >
            {t("Gerar página")}
          </button>
        )}
        <button className="btn" disabled={!sujo} onClick={salvar}>
          {t("Salvar")}
        </button>
        <button
          className="btn btn-fim"
          disabled={!sujo}
          onClick={() => {
            setBody(original);
            setSalvo(false);
          }}
        >
          {t("Descartar")}
        </button>
      </div>
    </div>
  );
}
