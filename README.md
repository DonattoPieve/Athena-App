# Athena App

Cliente desktop do vault Athena. Substitui o Obsidian e o `athena.bat` por uma
janela: explorer de `raw/` e `wiki/`, editor de nota crua, e botões para ingest,
regeração, questões, remoção e publicação.

O app **não guarda conteúdo**. Ele aponta para a pasta do vault Athena que já
existe no disco. O `athena-web` continua publicando no Vercel a partir do mesmo
repositório.

## Rodar

```cmd
npm install
npm run dev
```

Na primeira execução, escolha a pasta do vault (a que tem `CLAUDE.md` e `raw/`).
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

1. **Vault reconhecido** — a árvore mostra `raw/` com `INATEL/` e `subjects/`.
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
6. **Antes de publicar, leia a lista** — precisa ter `wiki/...` **e**
   `athena-web/wiki/...`. Só `wiki/` significa espelho não feito: não publique,
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
| `raw/subjects`, `raw/concepts`, `raw/games`, `raw/studies` | leitura e escrita |
| `raw/INATEL/` | somente leitura |
| `wiki/`, `athena-web/wiki/` | somente leitura |
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

### Publicação

O botão Publicar não chama o Claude — é só git. Ele mostra o `git status` antes
e só habilita quando `.ingest-status` está `OK`. Mesma guarda do `.bat`, agora
visível.

O `.ingest-status` tem **watcher próprio**: ele fica na raiz e começa com ponto,
e o watcher da árvore ignora dotfiles e só olha `raw/` e `wiki/`. Além disso, o
fim de cada comando força uma releitura — no OneDrive o evento de arquivo pode
chegar tarde ou não chegar.

## Decisões em aberto

1. **Editor.** Hoje é um `<textarea>` de markdown. `src/components/NoteEditor.tsx`
   tem o seam marcado para Tiptap ou CodeMirror 6. A nota crua **precisa** sair
   como `.md`, senão o passo 1 do `CLAUDE.md` não a encontra. Escreva uma nota
   real de E09 (com tabela de registradores e código AVR-C) antes de decidir.
2. **Componentes de assinatura.** `Graph.tsx` e `BrainHologram.tsx` do
   `athena-web` ainda não foram portados. O CSS já expõe `--sv-accent`,
   `--sv-bright`, `--sv-mid`, `--sv-deep` e `--sv-glow` nas 7 paletas, então
   eles funcionam ao serem copiados — só precisam ler o tema em runtime para
   trocar o blending (aditivo no escuro, normal no claro).
3. **Publicação por execução vs em lote.** Hoje o `.ingest-status` reflete só o
   último comando. Rodar três ingests e publicar uma vez significa que um
   `FAIL` no terceiro bloqueia os dois que deram certo.
4. **`--permission-mode acceptEdits`** dá ao Claude Code liberdade para escrever
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
