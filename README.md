# Athena App

Cliente desktop do vault Athena. Substitui o Obsidian e o `athena.bat` por uma
janela: explorer de `Notes/` e `Resumos/`, editor de nota crua, e botões para ingest,
regeração, questões, remoção e publicação.

O app **não guarda conteúdo**. Ele aponta para a pasta do vault Athena que já
existe no disco. O `athena-web` continua publicando no Vercel a partir do mesmo
repositório.

## Rodar

```cmd
npm install
npm run dev
```

Na primeira execução, escolha a pasta do vault (a que tem `CLAUDE.md` e `Notes/`).
O caminho fica salvo em `%APPDATA%/athena-app/athena-app.json`.

Pré-requisito: Claude Code instalado e logado na conta Pro
(`npm install -g @anthropic-ai/claude-code`).

## Primeiro run (o app ainda não rodou nesta máquina)

No PowerShell, **fora da pasta do vault**:

```powershell
cd $HOME\Desktop\athena-app
npm install                 # cria node_modules/ — ~220 pacotes
git init                    # a pasta ainda não é repositório
git add .
git commit -m "athena-app: cliente desktop do vault"
npm run dev                 # Vite em :5173 + janela do Electron
```

`npm run dev` sobe duas coisas ao mesmo tempo (Vite e Electron) — a janela só
aparece depois que o Vite responde na porta. Para encerrar, `Ctrl+C` no terminal.

### Checklist do primeiro ingest de verdade

Faça com uma aula **que já existe**: reprocessar sobrescreve e o git desfaz.
Aula nova no primeiro teste mistura dois riscos.

1. **Vault reconhecido** — a árvore mostra `Notes/` com `INATEL/` e `subjects/`.
   Se der "não parece o vault", a pasta escolhida foi a errada.
2. **Alvo correto** — clicar na aula preenche o painel Alvo com `CODIGO / slug`
   e lista a nota do aluno e o material oficial encontrados.
3. **Spawn do Claude** — a primeira linha do log é `> athena <CODIGO> <AULA>`,
   seguida de `sessao iniciada (...)`. Se aparecer *"Não consegui executar
   claude"*, rode `where.exe claude` no PowerShell e grave o caminho do
   `claude.cmd` em `claudeBin` no `%APPDATA%/athena-app/athena-app.json`.
4. **Pergunta no meio** — se o fluxo parar em `AGUARDANDO RESPOSTA`, o painel
   abre o campo de resposta. Responda ali: é a mesma sessão, o contexto está
   vivo. Trocar de aba não perde mais o log nem a pergunta.
5. **Status vira OK sozinho** — no fim, o painel Publicar sai de "não concluiu"
   para "último comando terminou bem" **sem você clicar em nada**. Se não virar,
   o ingest não chegou ao fim: não publique.
6. **Antes de publicar, leia a lista** — precisa ter `Resumos/...` **e**
   `athena-web/wiki/...`. Só `Resumos/` significa espelho não feito: não publique,
   reprocesse.
7. **Vercel** — o push dispara o redeploy sozinho; confira a página no site.

Se travar no meio, **Interromper** derruba a árvore de processos (inclusive o
`claude` por baixo do `cmd.exe`) e o `.ingest-status` fica em `FAIL` — que é
exatamente o que bloqueia publicar conteúdo pela metade.

## Arquitetura

```
src/          renderer — React 19 + Vite + Tailwind v4
electron/
  main.ts     janela, config, handlers de IPC, watcher
  preload.ts  contextBridge — única superfície visível ao renderer
  vault.ts    acesso ao disco + guardas de escrita
  claude.ts   sessão do Claude Code com fila de um por vez
  git.ts      status, diff e push (substitui o athena.bat)
```

`contextIsolation: true`, `nodeIntegration: false`. O renderer não tem `fs` nem
`child_process` — tudo passa pelo main.

### Guardas de escrita

As invariantes do `CLAUDE.md` são código, não promessa:

| Caminho | App |
|---|---|
| `Notes/subjects`, `Notes/concepts`, `Notes/games`, `Notes/studies` | leitura e escrita |
| `Notes/INATEL/` | somente leitura |
| `Resumos/`, `athena-web/wiki/` | somente leitura |
| fora da raiz do vault | bloqueado |

Editar uma página gerada é impossível pelo app. Correção de conteúdo é
reprocessar a aula.

### Sessão de ingest

`claude -p --output-format stream-json --input-format stream-json --verbose
--permission-mode acceptEdits`, com `cwd` na raiz do vault — é assim que o
Claude Code encontra o `CLAUDE.md`.

Quando o fluxo para para perguntar (`AGUARDANDO RESPOSTA`), o processo fica
vivo e o painel abre um campo de resposta, que escreve uma linha JSONL no stdin
da mesma sessão. Sem relançar o binário, sem perder contexto.

**Uma sessão por vez.** O `.ingest-status` é um arquivo único na raiz: dois
comandos simultâneos sobrescreveriam o veredito um do outro. A fila é visível
no painel.

**O transcript mora no main, não no componente.** `ClaudeRunner` guarda as
últimas 800 linhas, o estado e a fila, e serve tudo por `session:snapshot`. O
`SessionPanel` se reconstitui ao montar — trocar de aba ou recarregar o Vite no
meio de um ingest não apaga o log nem a pergunta pendente.

**Interromper mata a árvore.** No Windows o spawn usa `shell: true`, então
existe um `cmd.exe` entre o app e o `claude`; matar só o pai deixaria o ingest
vivo escrevendo arquivos. O cancelamento usa `taskkill /T /F`.

### Publicação — Supabase e R2, não git

Desde 2026-08-02 `Notes/` e `Resumos/` estão no `.gitignore` do vault: o repositório
guarda o **código** do athena-web, e o **conteúdo** viaja pelo Supabase (texto) e
pelo Cloudflare R2 (PDF, PPT, imagem). Quem faz isso é
`athena-web/scripts/athena-publish.mjs`, o mesmo script do passo [2/2] do `.bat`.

O app **roda o script do vault** em vez de reimplementar o espelho: a guarda
contra máquina desatualizada, a remoção de órfãos e o upload incremental
continuam num lugar só, valendo pelo terminal e por aqui.

- **Publicar** — `athena publish`. Bloqueado sem `OK` no `.ingest-status` e sem
  conta.
- **Puxar do banco** — `athena pull`, para a segunda máquina.
- **`--force`** só aparece quando o próprio script pede, na saída: o publish
  quando para por desproporção, o pull quando encontra arquivo que só existe no
  disco. O botão é do comando que pediu — forçar publish e forçar pull apagam
  lados opostos.
- **publicar ao terminar** (ligado por padrão) reproduz o `.bat`: terminou com
  `OK`, vai pro ar. `delete` publica com `--force`, porque remover páginas é
  exatamente a desproporção que a guarda barra — e nesse caso foi pedida.

> Antes, este painel fazia `git add . && git commit && git push`. Com o conteúdo
> fora do git, isso dizia "publicado" e não mudava nada no site. `electron/git.ts`
> foi removido.

O `.ingest-status` tem **watcher próprio**: ele fica na raiz e começa com ponto,
e o watcher da árvore ignora dotfiles e só olha `Notes/` e `Resumos/`. Além disso, o
fim de cada comando força uma releitura — no OneDrive o evento de arquivo pode
chegar tarde ou não chegar.

### Duas contas diferentes

| | O que é | Onde entra |
|---|---|---|
| **Claude Code** | sua conta Pro, que roda o ingest | terminal, `claude` → `/login` |
| **Athena (Supabase)** | dono do conteúdo publicado | painel Publicar, ou `athena login` |

Confundir as duas custa tempo: `OAuth session expired` é sempre a **primeira**.
O app reconhece essa mensagem no meio do stream e abre um terminal já no
comando certo, em vez de mostrar "falhou".

O login do app é a **mesma sessão** do CLI: `electron/account.ts` lê e escreve o
`<vault>/.athena/session.json` no formato de `scripts/lib/session.mjs`, com as
credenciais do `athena-web/.env.local`. Entrar aqui é entrar lá. Em disco fica só
o refresh token; a `SERVICE_ROLE` continua sem existir no projeto, então o app
escreve como usuário normal e apanha do RLS igual a todo mundo.

### Navegação

Três lugares: **Comandos**, **Nova nota** e **Arquivo**. A árvore é quem manda —
clicar num arquivo abre ele em *Arquivo*, e a própria tela decide o modo: nota
em `Notes/` abre **editável** (salva no mesmo arquivo), página da wiki abre em
leitura, PDF e PPT abrem no visualizador.

> Antes existiam abas "Leitura" e "Material" separadas e a árvore trocava de aba
> sozinha: escolher "Leitura" com um PDF selecionado dava uma tela pedindo um
> `.md` que você não conseguia escolher sem sair dali.

### Explorer (botão direito)

Ícones de pasta e arquivo em SVG inline (herdam `currentColor`, então seguem
tema e paleta). Menu de contexto desenhado pelo app — como VS Code e Obsidian fazem — porque os
itens dependem do estado do vault e do tema: nova nota, nova pasta, renomear
(`F2`, com o nome pré-selecionado sem a extensão), copiar caminho, revelar no
Explorer do Windows, abrir material no programa padrão e apagar.

**Apagar vai para a lixeira do Windows**, não `unlink`: com o conteúdo fora do
git, `Notes/` é a única cópia local do seu texto. A confirmação é o modal do app
(`Confirm.tsx`), não o `confirm()` do navegador — a janela nativa vinha com o
título "athena-app", fonte do sistema e nenhum espaço para dizer o que
acontece. Aqui cabe o caminho completo e a nota de que dá para restaurar. O foco
nasce em **Cancelar** e `Esc` fecha: ação destrutiva não pode depender de
`Enter` por reflexo. E o menu espelha as guardas do
`vault.ts` — sobre `Notes/INATEL/` ou `Resumos/`, criar/renomear/apagar aparecem
desabilitados em vez de falharem depois.

### Visualizador de material

PDF abre embutido (o Chromium do Electron já tem leitor). PPT abre no programa
padrão do Windows: converter seria frágil e o PowerPoint mostra animação, fonte e
layout como o professor montou.

Os dois usam o esquema **`athena://file/<caminho>`**, registrado no main. Existe
porque a janela roda em `http://localhost:5173` no dev, e o Chromium bloqueia
`file://` vindo dessa origem. É o mesmo caminho que serve as imagens da nota.

### Editor de nota (Tiptap)

WYSIWYG por cima de markdown: `src/lib/markdown.ts` monta as extensões e
serializa, `NoteEditor.tsx` é a tela, `Toolbar.tsx` são os comandos.

**O arquivo no disco continua sendo `.md`** — o estado `body` é markdown
serializado a cada tecla, nunca HTML. O botão `markdown` mostra exatamente o
texto que será gravado (e aceita colar nota pronta de fora).

Duas armadilhas resolvidas, ambas silenciosas se voltarem:

- **A lista de extensões é um contrato de fidelidade.** O que não estiver nela é
  achatado no salvamento, sem erro. Sem `TableKit`, a tabela de registradores
  vira `BitNomeFuncao0INT0habilita...` numa linha só.
- **O serializador escapa colchetes**, e `\[\[aula\]\]` não é wikilink para o
  Obsidian nem para o site — o nó some do grafo. `unescapeWikilinks()` desfaz
  esse escape específico.

```cmd
npm run test:md
```

Roda o ida-e-volta (markdown → editor → markdown) e falha se algo se perder:
tabela, wikilink, tarefas, bloco de código com linguagem, e a estabilidade do
formato no segundo ciclo (abrir e salvar sem editar não pode mexer no arquivo).
Rode depois de mexer em qualquer extensão.

Estilo: `.prose` em `src/index.css` é porte direto do
`athena-web/src/app/globals.css` — mesmas medidas (Arial 1.188rem/1.8, h2 com
régua, tabela com cabeçalho em surface), traduzidas dos triplets
`rgb(var(--c-*))` do site para os tokens em hex daqui. A aba **Leitura** usa o
mesmo pipeline com `editable: false`, então nota escrita e nota publicada têm a
mesma cara. Mexeu num, mexa no outro.

**Imagem colada** (Ctrl+V ou arrastar) vai para `Notes/attachments/` com o nome da
aula (`interrupcoes-externas-2.png`) e entra na nota como `![[arquivo.png]]` —
o formato do CLAUDE.md §150 e o primeiro lugar onde o ingest procura. Base64
dentro do `.md` seria mais fácil e quebraria o fluxo: o ingest precisa **abrir**
a imagem para descrever o que ela ensina.

Na tela essa imagem vira `athena://file/Notes/attachments/...`; no disco volta a
ser `![[...]]`. As duas conversões são inversas (`embedsParaSrc` /
`srcParaEmbeds`) — mexeu numa, mexa na outra, e o `test:md` cobre o ciclo.

**`[[link]]`** abre a lista de aulas que existem de verdade em `Resumos/subjects/`.
Digitar o slug de cabeça é como nasce link órfão: `[[interrupcoes]]` quando a
página é `interrupcoes-externas` não aponta para lugar nenhum.

**Botão direito no texto**: recortar/copiar/colar, negrito, itálico, código,
link para aula e tabela.

**Bloco de código** mostra a linguagem no canto (`data-lang`) e é colorido pelo
lowlight com a paleta VS Code Dark+ — as mesmas regras `.hljs-*` do
`athena-web/src/app/globals.css`, copiadas para o app não depender do build do
site. Mexeu num, mexa no outro.

O mesmo `MarkdownEditor` serve nota nova e nota existente: o que muda é onde o
markdown é gravado, não como é escrito.

Ainda fora: nota de rodapé e HTML embutido. Para esses, use o modo `markdown` —
o texto passa intacto.

## Decisões em aberto

1. **Componentes de assinatura.** `Graph.tsx` e `BrainHologram.tsx` do
   `athena-web` ainda não foram portados. O CSS já expõe `--sv-accent`,
   `--sv-bright`, `--sv-mid`, `--sv-deep` e `--sv-glow` nas 7 paletas, então
   eles funcionam ao serem copiados — só precisam ler o tema em runtime para
   trocar o blending (aditivo no escuro, normal no claro).
2. **Publicação por execução vs em lote.** Hoje o `.ingest-status` reflete só o
   último comando. Rodar três ingests e publicar uma vez significa que um
   `FAIL` no terceiro bloqueia os dois que deram certo.
3. **`--permission-mode acceptEdits`** dá ao Claude Code liberdade para escrever
   arquivos e rodar `npm run build` sem pedir aprovação a cada passo. É uma
   decisão de confiança, apropriada num vault local seu — revise se o app um dia
   apontar para um vault de terceiros.

## Armadilhas conhecidas

- **`claude` no Windows** é `claude.cmd`, e o PATH de um app empacotado não é o
  do CMD. Se o spawn falhar, grave o caminho absoluto em `claudeBin` no arquivo
  de config.
- **Brace expansion não existe no CMD/PowerShell**: `mkdir {electron,src}` cria
  uma pasta chamada `{electron,src` em vez de duas. Foi o que deixou o lixo que
  hoje está em `_to_delete/` (pode apagar).
- **OneDrive**: o watcher usa `awaitWriteFinish` porque a pasta sincronizada
  dispara eventos fantasma, e a leitura remove null bytes. Considere mover o
  vault para fora do OneDrive — o GitHub já é o backup.
- **Clone este repo fora da pasta do vault**, senão `node_modules/` e `dist/`
  entram no radar do git do Athena.
