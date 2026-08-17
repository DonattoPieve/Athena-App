# COMANDOS.md — review e delete

> Complemento do `CLAUDE.md`. **Ler este arquivo ao executar `review` ou `delete`** — ele não é carregado automaticamente.
> O fluxo de ingest (`athena`) não precisa deste arquivo.

> ⚠️ **O que publica é o `athena publish`, não os arquivos.** Desde a fase 4, o site serve do Supabase. O Claude continua só escrevendo/apagando arquivos em `wiki/`; quem leva a mudança pro banco é o passo `[2/2]` do `athena.bat`. Como o publish é **espelho**, apagar a página do disco é o que a remove do banco — não existe passo manual de "apagar do Supabase".

---

## Comando review (sob demanda)

```
claude "review <CODIGO> <AULA>"
```

Também aceito via `.bat`, com a mesma guarda de status: `athena review <CODIGO> <AULA>`.

Gera questões de fixação sobre a aula, com gabarito comentado ao final. Salva em `wiki/reviews/<CODIGO>-Nome/<AULA>-review.md` — pasta separada, para a pasta da matéria ter só aulas. Vai pro banco como qualquer página, com o mesmo slug e a mesma matéria de sempre.

Regras específicas do review:

- **Mesmo contrato do ingest**: escrever `FAIL` no `.ingest-status` ao começar, registrar no `log.md` (mesma linha canônica, marcando `review`) e só então sobrescrever com `OK`. Sem isso o `.bat` não publica e o review nunca aparece no site. Não há mais passo de espelho — o `athena publish` lê direto de `wiki/`
- **Não copia material** pra `public/materials/` — o material é o da aula, que já foi copiado no ingest
- O slug do review é sempre `<AULA>-review` (herda o slug da aula) — não inventar nome novo, e não leva `source`/`sourceHref`

- **Frontmatter obrigatório** com `updated` (data do dia) e `type: review`:
  ```yaml
  ---
  updated: 2026-07-19
  type: review
  ---
  ```
- **NÃO adicionar o review à lista de aulas do MOC** — review não é aula. Ele se liga ao grafo só pelo backlink abaixo.
- O site ignora arquivos `*-review.md` nas contagens (card Notes), no "Other lessons" e nas listas de notas — eles continuam acessíveis pela busca e pelo link dentro da página da aula.

No topo do review, adiciona um backlink pra aula não ficar solto no grafo:
```markdown
> Aula: [[<AULA>]]
```

---

## Remoção de matéria ou aula

### Comando

```
athena delete <CODIGO>            → remove a MATÉRIA inteira (ex: athena delete E09)
athena delete <CODIGO> <AULA>     → remove APENAS aquela aula (ex: athena delete E09 bit-a-bit)
```

**O escopo é definido pela quantidade de argumentos**: dois argumentos = matéria, três = aula. O `.bat` pede confirmação (`S`) antes de executar e segue o mesmo contrato do ingest — `FAIL` no `.ingest-status` ao começar, `OK` só no fim, publicação apenas com `OK`.

O `<AULA>` usa match tolerante (mesmo critério do ingest): `bit-a-bit` casa com `logica-bit-a-bit.md`. Se casar com mais de uma aula, **listar e perguntar** — nunca adivinhar em operação destrutiva. Também aceito em linguagem natural ("remove a aula X da C09").

⚠️ **Primeiro identificar o escopo**: o pedido é pra remover UMA AULA ou a MATÉRIA INTEIRA? São procedimentos diferentes. Na dúvida, **perguntar** — nunca apagar pasta quando o pedido foi de uma aula só.

🔒 **`raw/` NUNCA é apagado pelo delete.** O delete remove o **conteúdo gerado e publicado**, não o material do usuário. As notas cruas em `raw/subjects/` são trabalho do aluno (podem ser rascunho de aula ainda não publicada) e os PDFs em `raw/INATEL/` são o arquivo de referência — ambos ficam intactos. Pra apagar nota crua, o usuário faz manualmente.

Efeito colateral útil: com a nota crua preservada, basta rodar `athena <CODIGO> <AULA>` de novo pra regenerar a página do zero.

### Remover UMA AULA

Apagar **apenas os arquivos gerados daquela aula**, preservando a pasta e as outras aulas:

1. `wiki/subjects/<CODIGO>-*/<AULA>.md` (a página gerada)
2. `athena-web/public/materials/<CODIGO>-*/<AULA>.<ext>` (a cópia do material, se houver)
3. `wiki/reviews/<CODIGO>-*/<AULA>-review.md`, se existir review dessa aula
4. **Remover a linha `- [[<AULA>]]` do MOC da matéria**

A linha correspondente no Supabase some sozinha: o `athena publish` do passo `[2/2]` compara o disco com o banco e apaga o que não existe mais.

O `index.md` NÃO muda (a matéria continua existindo). `raw/` não é tocado.

### Remover uma MATÉRIA inteira

1. `wiki/subjects/<CODIGO>-*/` (o conteúdo gerado, incluindo o MOC)
2. `athena-web/public/materials/<CODIGO>-*/` (os materiais copiados pro site — sem a página, viram arquivos fantasma publicados)
3. **Remover a linha da matéria do `index.md`**

A matéria e suas páginas somem do Supabase no passo `[2/2]`, por cascade.

`raw/subjects/<CODIGO>-*/` e `raw/INATEL/<CODIGO>-*/` continuam intactos.

### Regra geral

**Nenhum `[[wikilink]]` pode sobreviver ao arquivo que ele aponta.** Depois de qualquer remoção, varrer MOC e `index.md` atrás de links órfãos — eles viram nó fantasma no grafo do Obsidian e 404 no site. Wiki órfã (página publicada sem motivo) e link órfão são os bugs mais comuns deste sistema — não deixar sobras no que é **gerado**. O que está em `raw/` é do usuário e permanece.

**Contrato do delete** (igual ao ingest): escrever `FAIL` no `.ingest-status` antes de começar, executar a remoção completa, registrar no `log.md` (`- removido: C09/nome-da-aula` ou `- removida matéria: T02`) e só então sobrescrever com `OK`. Se algo não puder ser removido, parar e reportar — remoção parcial é pior que nenhuma.

O `npm run build` deixou de ser necessário aqui: as páginas não são mais pré-renderizadas por arquivo, então remover uma não pode quebrar rota. Quem valida a remoção é o próprio publish, que reporta quantas linhas apagou.

---

