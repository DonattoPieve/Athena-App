import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Account, type HomeData, type Pendencia } from "../lib/api";
import { t, tf } from "../lib/i18n";
import { IconBusca, IconComandos, IconMais, IconPublicar } from "./icons";
import "../styles/home.css";

/**
 * Contrato de `api.usage.*` — outra pessoa esta escrevendo a implementacao no
 * main ao mesmo tempo que esta tela e escrita. `AthenaBridge` (em api.ts) e
 * um `type`, nao uma `interface`: nao da para fazer declaration merging nele
 * a partir de outro arquivo sem editar api.ts, que nao e meu para mexer aqui.
 * O cast abaixo tipa a chamada contra o contrato combinado sem tocar la.
 */
type UsageBridge = {
  recentes(): Promise<{ rel: string; em: string }[]>;
  ultimaLeitura(): Promise<
    { rel: string; titulo: string; materia: string; em: string; pct: number } | null
  >;
  revisao(): Promise<{ rel: string; titulo: string; materia: string; geradaEm: string }[]>;
};
const usage = (api as unknown as { usage: UsageBridge }).usage;

type Recente = { rel: string; em: string };
type UltimaLeitura = { rel: string; titulo: string; materia: string; em: string; pct: number };
type Revisao = { rel: string; titulo: string; materia: string; geradaEm: string };

/**
 * Home — tela de abertura reconstruida a partir do mockup aprovado: busca em
 * destaque, atalhos de acao, "continue de onde parou" e dois pares de
 * colunas (recentes/revisao, vault/atividade). Nada aqui inventa numero: o
 * que a API ainda nao entrega fica de fora ou vira estado vazio curto.
 */
export function Home({
  onAbrir,
  onNovaNota,
  onComandos,
  onIngest,
  onProcessar,
  onBuscar,
  dados: dadosProp,
}: {
  onAbrir: (rel: string) => void;
  onNovaNota: () => void;
  onComandos: () => void;
  /** Ingest ainda nao tem tela propria — sem handler dedicado, cai em Comandos. */
  onIngest?: () => void;
  /** Enfileira o ingest de UMA aula que ainda nao tem pagina. */
  onProcessar?: (code: string, lesson: string) => void;
  /** Sem handler dedicado, o atalho "Buscar" usa o campo desta propria tela. */
  onBuscar?: () => void;
  /** Injetavel por quem monta a tela; sem isto, busca sozinha em api.fs.home(). */
  dados?: HomeData;
}) {
  const [dados, setDados] = useState<HomeData | null>(dadosProp ?? null);
  const [conta, setConta] = useState<Account | null>(null);
  const [recentes, setRecentes] = useState<Recente[] | null>(null);
  /** Aulas do professor ainda sem pagina — ver `vault.pendencias()`. */
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [ultimaLeitura, setUltimaLeitura] = useState<UltimaLeitura | null>(null);
  const [revisao, setRevisao] = useState<Revisao[] | null>(null);
  const [busca, setBusca] = useState("");
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dadosProp) return;
    api.fs.home().then(setDados).catch(() => setDados(null));
  }, [dadosProp]);

  // A lista do que falta processar custa uma ida ao espelho; sai do caminho da
  // primeira pintura de proposito, e falhar aqui so esconde o bloco.
  useEffect(() => {
    api.fs.pendencias?.().then(setPendencias).catch(() => setPendencias([]));
  }, [dadosProp]);

  useEffect(() => {
    api.account.status().then(setConta).catch(() => setConta(null));
    usage.recentes().then(setRecentes).catch(() => setRecentes([]));
    usage.ultimaLeitura().then(setUltimaLeitura).catch(() => setUltimaLeitura(null));
    usage.revisao().then(setRevisao).catch(() => setRevisao([]));
  }, []);

  // Ctrl+K foca a busca — o mesmo atalho que o campo anuncia.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        buscaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saudacao = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? t("Bom dia") : h < 18 ? t("Boa tarde") : t("Boa noite");
  }, []);

  // Sem conta (vault sem login) nao ha nome real para mostrar — a saudacao
  // fica sem destinatario em vez de inventar um.
  const linhaSaudacao = conta?.name
    ? tf("{saudacao}, {nome}. 👋", { saudacao, nome: conta.name })
    : tf("{saudacao}. 👋", { saudacao });

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q || !dados) return [];
    return dados.paginas
      .filter((p) => (p.titulo + p.slug + p.subject).toLowerCase().includes(q))
      .slice(0, 8);
  }, [busca, dados]);

  // rel -> pagina da wiki: api.usage.recentes() so devolve caminho e data, o
  // titulo/materia legivel vem de fs.home(), que ja temos na tela.
  const mapaPaginas = useMemo(() => {
    const m = new Map<string, HomeData["paginas"][number]>();
    dados?.paginas.forEach((p) => m.set(p.rel, p));
    return m;
  }, [dados]);

  if (!dados) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p style={{ margin: 0, color: "var(--c-muted)" }}>{t("Lendo seus arquivos…")}</p>
      </div>
    );
  }

  const semana = dados.paginas.filter((p) => diasAte(p.updated) <= 7).length;
  const ingestsOk = dados.eventos.filter((e) => !e.removido);
  // "Ultimo ingest" pro card do vault: prefere o ultimo que nao foi removido;
  // sem nenhum, cai no evento mais recente mesmo (ainda e real, so nao conta
  // pro total de ingests validos).
  const ultimoIngest = ingestsOk[0] ?? dados.eventos[0] ?? null;

  return (
    <div className="home">
      {dados.logConflitado && (
        <div className="card" style={{ padding: 14, borderColor: "#ba7517" }}>
          <strong style={{ color: "#ba7517", fontSize: 13 }}>
            {t("log.md tem marcadores de conflito de merge")}
          </strong>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-muted)" }}>
            {t("O publish manda o log inteiro para a tabela ")}
            <code>ingests</code>
            {t(". Com ")}
            <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code>
            {t(" no meio, o histórico vai torto. Resolva o arquivo antes de publicar.")}
          </p>
        </div>
      )}

      {/* ---- saudacao ---- */}
      <div className="home-topo">
        <p className="home-saudacao">{linhaSaudacao}</p>
        <h1 className="home-titulo">
          {t("Seu ")}
          <span style={{ color: "var(--c-accent)" }}>{t("Segundo")}</span>
          {t(" Cérebro")}
        </h1>
        <p className="home-resumo">
          {tf(
            "{paginas} página(s) · {notas} nota(s) crua(s) · {materias} matéria(s) · {ingests} ingest(s)",
            {
              paginas: dados.paginas.length,
              notas: dados.notas,
              materias: dados.subjects.length,
              ingests: ingestsOk.length,
            }
          )}
        </p>
      </div>

      {/* ---- busca ---- */}
      <div className="home-search-wrap">
        <span className="home-search-icone">
          <IconBusca />
        </span>
        <input
          ref={buscaRef}
          className="home-search"
          placeholder={t("O que você quer lembrar?")}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setBusca("");
            if (e.key === "Enter" && resultados[0]) {
              onAbrir(resultados[0].rel);
              setBusca("");
            }
          }}
        />
        <kbd className="home-search-atalho">Ctrl K</kbd>
        {resultados.length > 0 && (
          <div className="card busca-lista">
            {resultados.map((p) => (
              <button
                key={p.rel}
                className="nav-item"
                onClick={() => {
                  onAbrir(p.rel);
                  setBusca("");
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.titulo}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-muted)" }}>
                  {p.subject}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- atalhos de acao ---- */}
      <div className="home-acoes">
        <button className="home-acao" onClick={onNovaNota}>
          <span className="home-acao-titulo">
            <IconMais />
            {t("Nova nota")}
          </span>
          <span className="home-acao-sub">{t("Criar do zero")}</span>
        </button>
        <button className="home-acao" onClick={onIngest ?? onComandos}>
          <span className="home-acao-titulo">
            <IconPublicar />
            {t("Ingest")}
          </span>
          <span className="home-acao-sub">{t("Transformar material")}</span>
        </button>
        <button className="home-acao" onClick={onComandos}>
          <span className="home-acao-titulo">
            <IconComandos />
            {t("Comandos")}
          </span>
          <span className="home-acao-sub">{t("Ações avançadas")}</span>
        </button>
        <button
          className="home-acao"
          onClick={() => (onBuscar ? onBuscar() : buscaRef.current?.focus())}
        >
          <span className="home-acao-titulo">
            <IconBusca />
            {t("Buscar")}
          </span>
          <span className="home-acao-sub">{t("Buscar em tudo")}</span>
        </button>
      </div>

      {/* ---- continue de onde parou ---- */}
      {ultimaLeitura && (
        <div className="card home-continuar">
          <p className="label" style={{ margin: 0 }}>
            {t("Continue de onde parou")}
          </p>
          <p className="home-continuar-materia">{ultimaLeitura.materia}</p>
          <p className="home-continuar-titulo">{ultimaLeitura.titulo}</p>
          <p className="home-continuar-data">
            {tf("Última leitura: {dia}, {hora}", {
              dia: diaPalavra(ultimaLeitura.em),
              hora: horaCurta(ultimaLeitura.em),
            })}
          </p>
          <div className="home-continuar-progresso">
            <div className="barra">
              <div
                className="barra-cheio"
                style={{ width: `${Math.max(0, Math.min(100, ultimaLeitura.pct))}%` }}
              />
            </div>
            <span className="home-continuar-pct">{Math.round(ultimaLeitura.pct)}%</span>
            <button className="btn btn-primary" onClick={() => onAbrir(ultimaLeitura.rel)}>
              {t("Continuar lendo →")}
            </button>
          </div>
        </div>
      )}

      {/* ---- recentes + revisao ---- */}
      <div className="duas-colunas">
        <div className="card" style={{ padding: 16 }}>
          <p className="label" style={{ margin: "0 0 10px" }}>
            {t("Recentes")}
          </p>
          {recentes === null ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>{t("Carregando…")}</p>
          ) : recentes.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>
              {t("Nada atualizado ainda.")}
            </p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {recentes.slice(0, 6).map((r) => {
                  const p = mapaPaginas.get(r.rel);
                  return (
                    <button key={r.rel} className="nav-item" onClick={() => onAbrir(r.rel)}>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p?.titulo ?? r.rel}
                        {p?.subject ? ` · ${p.subject}` : ""}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-muted)" }}>
                        {tf("atualizado {q}", { q: quando(r.em) })}
                      </span>
                    </button>
                  );
                })}
              </div>
              {onBuscar ? (
                <button className="home-vermais" onClick={onBuscar}>
                  {t("Ver todas as notas →")}
                </button>
              ) : (
                <span className="home-vermais home-vermais-inerte">
                  {t("Ver todas as notas →")}
                </span>
              )}
            </>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <p className="label" style={{ margin: 0 }}>
              {t("Revisão")}
            </p>
            {revisao !== null && revisao.length > 0 && (
              <span className="home-badge">
                {tf("{n} aguardando revisão", { n: revisao.length })}
              </span>
            )}
          </div>
          {revisao === null ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>{t("Carregando…")}</p>
          ) : revisao.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>
              {t("Nada para revisar por agora.")}
            </p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {revisao.slice(0, 6).map((r) => (
                  <button key={r.rel} className="nav-item" onClick={() => onAbrir(r.rel)}>
                    <span
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {r.titulo}
                      {r.materia ? ` · ${r.materia}` : ""}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-muted)" }}>
                      {tf("gerada {q}", { q: quando(r.geradaEm) })}
                    </span>
                  </button>
                ))}
              </div>
              {/* Sem tela dedicada de revisao: comeca abrindo a primeira da fila. */}
              <button className="home-vermais" onClick={() => onAbrir(revisao[0].rel)}>
                {t("Começar revisão →")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ---- o que falta processar ----
           Some quando nao ha nada: um card dizendo "tudo em dia" toda vez que
           voce abre o app e ruido, e ruido faz o card ser ignorado justo no dia
           em que ele tem algo a dizer. */}
      {pendencias.length > 0 && (
        <div className="card home-pendencias">
          <p className="label" style={{ margin: "0 0 4px" }}>
            {t("Falta processar")}
          </p>
          <p className="home-pend-sub">
            {tf("{n} aula(s) do professor ainda sem página.", {
              n: pendencias.reduce((a, p) => a + p.materiais.length, 0),
            })}
          </p>
          {pendencias.map((p) => (
            <div key={p.code} className="home-pend-materia">
              <p className="home-pend-titulo">{p.pasta}</p>
              <ul>
                {/* Quatro por materia: uma materia recem-arrastada tem vinte, e
                    uma parede de vinte linhas nao e uma lista, e um susto. */}
                {p.materiais.slice(0, 4).map((m) => (
                  <li key={m.rel}>
                    <span className="truncar" title={m.nome}>
                      {m.nome}
                    </span>
                    <button
                      className="btn"
                      disabled={!onProcessar}
                      title={tf("Roda: athena {code} {slug}", { code: p.code, slug: m.slug })}
                      onClick={() => onProcessar?.(p.code, m.slug)}
                    >
                      {t("Gerar página")}
                    </button>
                  </li>
                ))}
              </ul>
              {p.materiais.length > 4 && (
                <p className="home-pend-mais">
                  {tf("e mais {n} nesta matéria", { n: p.materiais.length - 4 })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---- vault + atividade ---- */}
      <div className="duas-colunas">
        <div className="card" style={{ padding: 16 }}>
          <p className="label" style={{ margin: "0 0 10px" }}>
            {t("Seu conteúdo")}
          </p>
          <div className="home-vault-linha">
            <p className="home-vault-titulo">
              <strong>{dados.paginas.length}</strong> {t("Páginas")}
            </p>
            {semana > 0 && (
              <p className="home-vault-sub">{tf("(+{n} nesta semana)", { n: semana })}</p>
            )}
          </div>
          <div className="home-vault-linha">
            <p className="home-vault-titulo">
              <strong>{dados.subjects.length}</strong> {t("Matérias")}
            </p>
            <p className="home-vault-sub">
              {tf("({n} nota(s) não revisada(s))", { n: dados.notas })}
            </p>
          </div>
          <div className="home-vault-linha">
            <p className="home-vault-titulo">
              <strong>{ingestsOk.length}</strong> {t("Ingests")}
            </p>
            {ultimoIngest && (
              <p className="home-vault-sub">{tf("(último {data})", { data: ultimoIngest.data })}</p>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <p className="label" style={{ margin: "0 0 10px" }}>
            {t("Atividade recente")}
          </p>
          {dados.eventos.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>{t("Sem eventos ainda.")}</p>
          ) : (
            <>
              <div className="home-atividade">
                {dados.eventos.slice(0, 6).map((e, i) => (
                  <div key={i} className="home-atividade-linha">
                    <span className="home-atividade-hora">{e.data}</span>
                    <span
                      className="home-atividade-texto"
                      data-removido={e.removido || undefined}
                      title={e.texto}
                    >
                      {e.slug ?? e.texto}
                    </span>
                  </div>
                ))}
              </div>
              {/* log.md e um arquivo real do vault: abre pelo mesmo onAbrir de
                  sempre, sem precisar de um handler novo so pra isto. */}
              <button className="home-vermais" onClick={() => onAbrir("log.md")}>
                {t("Ver histórico completo →")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function diasAte(iso: string): number {
  if (!iso) return Infinity;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return Infinity;
  return (Date.now() - d) / 86400000;
}

function quando(iso: string): string {
  const dias = diasAte(iso);
  if (!isFinite(dias)) return "";
  if (dias < 1) return t("hoje");
  if (dias < 2) return t("ontem");
  if (dias < 30) return tf("há {n} dias", { n: Math.floor(dias) });
  const meses = Math.floor(dias / 30);
  return meses === 1 ? t("há 1 mês") : tf("há {n} meses", { n: meses });
}

function diaPalavra(iso: string): string {
  const dias = diasAte(iso);
  if (!isFinite(dias)) return "";
  if (dias < 1) return t("hoje");
  if (dias < 2) return t("ontem");
  return new Date(iso).toLocaleDateString("pt-BR");
}

function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
