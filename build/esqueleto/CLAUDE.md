# CLAUDE.md — Guia Operacional do Athena

Instruções para o Claude Code operar o vault. Ingest **manual**: roda no terminal do PC, na conta Pro. O usuário decide quando processar cada nota.

> **Gerando página?** Ler o `TEMPLATE.md`.
> **Mexendo no site (`athena-web`)?** Ler o `DESIGN.md` antes.
> **Executando `review` ou `delete`?** Ler o `COMANDOS.md` antes de tocar em arquivo.

## Ordem de precedência

Quando duas regras deste arquivo se contradisserem, vale a de cima:

1. **Não destruir** — nada em `Notes/` é modificado; nada é publicado sem `OK`
2. **Perguntar em vez de escolher** — ambiguidade para o fluxo, não vira palpite
3. **A ordem do professor** — a sequência do material vence o template
4. **Estilo das páginas existentes** — vence preferência própria

---

## Estrutura do vault

```
Notes/
  subjects/<CODIGO>-Nome/     notas do aluno
  INATEL/<CODIGO>-Nome/       PDFs e PPTs do professor
  attachments/                imagens coladas nas notas
  concepts/ games/ studies/   arquivo pessoal — NUNCA ingerir
Resumos/subjects/<CODIGO>-Nome/<AULA>.md    um arquivo por aula, sem subpasta
athena-web/public/materials/<CODIGO>-Nome/<AULA>.<ext>
athena-web/public/attachments/<CODIGO>-Nome/<arquivo>
index.md · log.md · .ingest-status       raiz do vault
```

O código e o nome da matéria saem do nome da pasta em `Notes/subjects/` (`E09-Microcontroladores` → `E09`, "Microcontroladores").

- Pasta só com o código, ou código sem pasta e sem contexto → **perguntar o nome da matéria**. Nunca inventar.
- Mais de uma pasta com o mesmo código → **listar e perguntar**.

**`concepts/`, `games/` e `studies/` estão fora do ingest.** Não geram wiki, MOC, entrada no index nem página. Pedido sobre elas ("organiza minhas notas de jogos") é tarefa de arquivo, jamais ingest.

---

## Comando athena

```
athena <CODIGO> <AULA>        gera ou reprocessa a aula
athena redo <CODIGO> <AULA>   reprocessa com reescrita forçada
```

`ingest` é sinônimo exato de `athena`.

### Fluxo

0. **Escreve `FAIL` no `.ingest-status`.** O default é não publicar: travou, estourou contexto ou o usuário interrompeu, continua `FAIL`.

   ⚠️ Sempre na **raiz do vault**, com caminho explícito. Caminho relativo depois de mudar de diretório cria `athena-web/.ingest-status`, que o `.bat` ignora — o ingest fica correto e nada é publicado.

1. **Localiza a nota do aluno com match tolerante** em `Notes/subjects/<CODIGO>-*/`: compara o nome slugificado (minúsculo, sem acento, sem pontuação, espaço → hífen). `Compressão de Imagens (Parte 1).md` casa com `compressao-de-imagens-parte-1`.
   - Só concluir que "não há nota" **depois** do match tolerante — comparar nome literal e desistir descarta o trabalho do usuário em silêncio
   - Mais de um arquivo casando → listar e perguntar
   - Nota com `![[imagem]]` → resolver e **ler** a imagem (ver "Imagens")

2. **Verifica SEMPRE `Notes/INATEL/<CODIGO>-*/`, mesmo tendo achado a nota.** O material oficial é a fonte principal; a nota complementa. Match tolerante igual (`logica-bit-a-bit` casa com `Logica Bit a Bit.pdf`).
   - **Um match** → é a fonte principal
   - **Vários candidatos ou match parcial** → listar e perguntar. Nunca escolher sozinho
   - **Nenhum** → antes de desistir, procurar em `athena-web/public/materials/<CODIGO>-Nome/<AULA>.<ext>`. É o **mesmo arquivo do professor**, byte a byte, só renomeado pelo slug — fonte legítima, e some do `Notes/INATEL/` com mais frequência do que se espera. Usando essa cópia, avisar o usuário para repor o original.
   - **Nem lá** → conhecimento próprio, avisando na página que não veio de material oficial
   - Havendo material, **declarar a fonte no início da resposta** (`Fonte: 12. Compressão de Imagens.pdf`) — erro de match tem que ser visível

3. Aplica o tier (tabela abaixo).

4. **Escreve a página do zero**, num único arquivo `Resumos/subjects/<CODIGO>-Nome/<AULA>.md` (nome slugificado). Segue o `TEMPLATE.md`.

   🚫 **Nunca reaproveitar versão anterior da PÁGINA** — nem `Resumos/`, nem banco, nem histórico do git. Páginas existentes servem de referência de **estilo**, não de conteúdo. Sair idêntica à anterior significa que a regra foi violada.

   Isso vale para conteúdo gerado. O **PDF/PPT do professor** em `public/materials/` não é conteúdo gerado: é cópia do original e pode ser lido como fonte.

5. **Liga ao MOC da matéria** (ver "Ligações e grafo").

6. **Copia o material oficial** para `athena-web/public/materials/<CODIGO>-Nome/<AULA>.<ext>`, mesma extensão. Sem a cópia, o painel "Original material" fica sem link.

7. **Atualiza `index.md` e `log.md`.**

8. **Só depois de tudo dar certo, escreve `OK`** no `.ingest-status` da raiz. Qualquer falha: deixa `FAIL` e avisa.

⚠️ **Nada detecta `[[wikilink]]` apontando para arquivo inexistente.** A varredura manual de links órfãos na remoção é obrigatória.

### O que o ingest NÃO faz

**O ingest só gera arquivos.** Publicação no Supabase, upload pro R2 e remoção do que sumiu acontecem **fora** dele, depois do `.ingest-status = OK`. É isso que faz a guarda valer: ingest interrompido não deixa nada no banco.

Quem chama o ingest são **dois clientes**, e o contrato é o mesmo para os dois: o `athena.bat` (terminal) e o **athena-app** (janela, em `~/Desktop/athena-app`). Os dois montam o mesmo comando, leem o mesmo `.ingest-status` e rodam o mesmo `athena-publish.mjs`. Nenhuma regra deste arquivo muda conforme o cliente.

Também **não toca no git** — o repositório não participa do fluxo de conteúdo — e **não escreve em `Notes/`** (ver "Nunca modificar").

### Quando o fluxo para para perguntar

Candidato ambíguo, matéria sem nome, renomeação suspeita: o status fica `FAIL` e o `.bat` reporta que nada foi publicado. Isso é correto, não é erro. Encerrar com a linha literal:

```
AGUARDANDO RESPOSTA — nada foi publicado. Responda e rode o comando de novo.
```

### Formato do `log.md`

Uma linha por página, sob o cabeçalho `## AAAA-MM-DD`. Reprocessamento entra como linha nova.

```markdown
- `C09/compressao-de-imagens-parte-1` — fonte: `12. Compressão de Imagens.pdf` — nota do aluno: sim/vazia/inexistente
```

### Reprocessamento e renomeação

Rodar `athena` numa aula que já tem página **sobrescreve**, não duplica. Atualiza `updated` para hoje; não repete a entrada no MOC nem no index.

O `redo` existe porque reprocessar tende a "sair igual" quando a página anterior está à mão — use quando o objetivo é mudar estrutura ou abordagem.

**Detecção de renomeação:** antes de criar página nova, checar se a matéria já tem uma página com o **mesmo `source`** e slug diferente. Se tiver, **perguntar**: renomeação ou aula nova?

- **Renomeação** → gerar a nova e apagar a antiga em `Resumos/` e em `public/materials/`, corrigindo o `[[wikilink]]` no MOC. O banco se resolve no publish. Nunca deixar as duas convivendo: vira contagem dobrada e nó órfão no grafo
- **Aula nova** → seguir (duas aulas podem sair do mesmo PDF)

Favoritos e histórico são por URL: mudar o slug quebra o favorito do usuário. Avisar.

---

## Ligações e grafo

**MOC por matéria** — `Resumos/subjects/<CODIGO>-Nome/<CODIGO>-Nome.md` (mesmo nome da pasta), com título `# CODIGO — Nome` e uma lista de `[[wikilink]]` para cada aula. A cada ingest, acrescenta a aula nova sem duplicar.

⚠️ **O título do MOC é o nome de exibição da matéria no site** (sidebar, cards, busca). Nome completo e **com acento**: `# C09 — Computação Gráfica e Multimídia`. Pasta sem acento, título com acento.

**Backlink na aula** — `> Matéria: [[E09-Microcontroladores]]`, logo abaixo do `# Título` e antes do bloco `**Matéria:**`. As duas linhas coexistem: o wikilink alimenta o grafo, o `**Matéria:**` é texto para o leitor. Sem o wikilink, a aula vira ponto solto.

**Index como hub** — lista as matérias, nunca as aulas: `- [[E09-Microcontroladores|Microcontroladores]]`. O alias depois do `|` é o título do MOC sem o prefixo `CODIGO —`. Nunca inventar nome próprio aqui.

---

## Tiers

"Material oficial" = qualquer arquivo do professor em `Notes/INATEL/`, PDF ou PPT/PPTX.

| Situação | Comportamento |
|----------|---------------|
| Nota + material oficial | Material é a fonte principal, a nota orienta o foco, conhecimento próprio completa |
| Só material oficial | Extrai do material + conhecimento próprio |
| Só nota do aluno | Expande a nota, avisando que não há material oficial |
| Nada | **Perguntar antes**: confirmar a matéria e se o usuário quer geração do zero |

---

## Imagens na nota do aluno

Print de slide ou foto do quadro é **conteúdo** — costuma ser o que o aluno achou importante o bastante para capturar.

Ao encontrar `![[arquivo]]`:

1. **Localizar** em `Notes/attachments/`, depois na raiz do vault, depois na pasta da matéria
2. **Ler a imagem** — abrir de verdade, não deduzir pelo nome. O que ela mostra vira conteúdo da página
3. **Copiar** para `athena-web/public/attachments/<CODIGO>-Nome/<nome-slugificado>.<ext>`
4. **Embutir com markdown padrão**, com legenda própria, onde ilustra o assunto:
   `![legenda](/attachments/C09-Computacao-Grafica/soma-pixel-a-pixel.png)`
5. **Manter sempre.** Só fica de fora imagem que não ensina nada (tela em branco, print ilegível) — e nesse caso **avisar**, nunca omitir em silêncio

🚫 **Nunca usar `![[...]]` na página gerada.** O renderer do site converte `[[...]]` em link de wiki e o embed sai quebrado.

---

## Estilo

**Antes de gerar, ler as páginas existentes da mesma matéria** em `Resumos/subjects/<CODIGO>-*/` e replicar profundidade, terminologia e forma de explicar. Toda página deve parecer escrita pela mesma pessoa, no mesmo dia. Sem páginas na matéria, usar as de outras.

A página é **referência técnica, não apostila**: frases diretas, densidade vinda de tabela, código e exemplo — não de parágrafo longo.

---

## Template de página

**Ler o `TEMPLATE.md`** — catálogo de seções e exemplo completo do arquivo.

Três coisas ficam aqui porque errar nelas quebra o site em silêncio:

- **A ordem das seções é a do professor** (slides do PPT, capítulos do PDF). O template define o *tipo* de seção, nunca a ordem. Informação administrativa fica onde ele apresentou, tipicamente numa `## A disciplina` no início
- **`source` e `sourceHref` andam sempre juntos**, mais a cópia em `public/materials/`. Um sem o outro vira texto morto no painel "Original material"
- **A aula não leva campo `type`** — só o review leva (`type: review`)

---

## Nunca modificar

O ingest **lê** estas pastas e nunca escreve nelas:

- **`Notes/INATEL/`** — material do professor
- **`Notes/subjects/`** — notas do aluno. Não renomear, mover, reescrever nem apagar, **nem para corrigir numeração errada**. Nome estranho vira pergunta.
- **`Notes/concepts/`, `games/`, `studies/`** — arquivo pessoal

> Renomear uma nota tem efeito invisível: o publish é espelho por slug, então o nome antigo é apagado do banco e reaparece com outro — parece perda de dado sem ninguém ter pedido.

O usuário também **não edita `Resumos/` à mão**: correção de conteúdo é reprocessar a aula, não editar a página gerada.

---

## Convenções

- **Nome de arquivo e de pasta sem espaço nem acento** — tudo vira URL. Vale para a aula e para a pasta da matéria em `Resumos/subjects/` (`C09-Computacao-Grafica`, nunca `C09-Computação Gráfica`). O acento fica só dentro do arquivo.
- **O MOC tem o mesmo nome da pasta** — pasta `C09-Computacao-Grafica` → MOC `C09-Computacao-Grafica.md` → backlink `[[C09-Computacao-Grafica]]`.
- **Slug de aula é único no vault inteiro.** Antes de criar, verificar se outra matéria já tem o mesmo slug; se tiver, avisar e sugerir nome mais específico (`introducao-redes`, não `introducao`). `[[wikilinks]]` usam só o nome do arquivo, então slug repetido torna o link ambíguo — e o banco tem `unique (user_id, slug)`, o que faz o publish abortar. Nunca renomear aulas existentes por isso; só bloquear colisão nova.
- **De preferência** o nome da nota casa com o do material na INATEL. Não é obrigatório — o passo 1 faz match tolerante.
- **PT-BR** para conteúdo, inglês para termo técnico.
- Deu errado no meio: **parar e avisar**, nunca deixar resultado parcial.

> Onde o conteúdo vive (Supabase, R2, URLs assinadas), como a sessão é guardada e por que a `SERVICE_ROLE` não existe no projeto: **`HANDOFF.md`**. Para o ingest basta saber que gerar arquivo não publica nada sozinho.
