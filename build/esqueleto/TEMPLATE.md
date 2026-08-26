# TEMPLATE.md — Estrutura da página de aula

Catálogo de seções possíveis, **não** roteiro obrigatório. Quem manda na ordem é o material do professor.

- Nunca reagrupar tematicamente o que o professor apresentou em outra ordem
- Seção que não se aplica não existe (`Registradores` numa aula teórica)
- Seção que o material tem e este catálogo não prevê é criada com nome próprio, no lugar onde aparece
- Só `Boas práticas` e `Referências` ficam no fim — são fecho

```markdown
---
updated: 2026-07-18
source: "13. Visão Geral sobre Áudio.pdf"
sourceHref: "/materials/C09-Computacao-Grafica/visao-geral-sobre-audio.pdf"
---
# Título do conceito

> Matéria: [[C09-Computacao-Grafica]]

**Matéria:** CODIGO — Nome  
**Aula:** N  
**Tópico:** descrição curta

---

## A disciplina

[só em aulas de apresentação: ementa, avaliação, bibliografia, IDE —
 na posição em que o professor apresentou]

## O que é

[explicação conceitual]

## Registradores / Estruturas

[tabelas de bits e parâmetros — quando aplicável]

## Código

[comentado linha a linha]

## Boas práticas

[o que fazer e o que evitar]

## Fluxo de execução

[sequência de operações]
```

## Frontmatter

| Campo | Quando | Observação |
|---|---|---|
| `updated` | sempre | data do ingest; ao reprocessar, atualiza |
| `source` | havendo material oficial | nome do arquivo do professor |
| `sourceHref` | havendo material oficial | `/materials/<CODIGO>-Nome/<AULA>.<ext>` |

`source` e `sourceHref` **andam juntos**, mais a cópia em `athena-web/public/materials/`. Um sem o outro vira texto morto no painel "Original material".

A aula **não leva campo `type`** — só o review leva (`type: review`).
