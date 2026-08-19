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
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span className="label">{t("Editando")}</span>
        <code style={{ color: "var(--c-accent)", fontSize: 12 }}>{nome}</code>
        <span
          style={{ marginLeft: "auto", fontSize: 11, color: sujo ? "#ba7517" : "var(--c-muted)" }}
        >
          {carregando ? t("abrindo…") : sujo ? t("não salvo") : salvo ? t("salvo") : t("sem alterações")}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>{rel}</p>

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

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn" disabled={!sujo} onClick={salvar}>
          {t("Salvar")}
        </button>
        <button
          className="btn"
          disabled={!sujo}
          onClick={() => {
            setBody(original);
            setSalvo(false);
          }}
        >
          {t("Descartar")}
        </button>
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
      </div>
    </div>
  );
}
