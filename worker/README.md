# athena-r2 — o portão do bucket

O bucket do R2 é privado, e continua privado. Este Worker é a única porta por
onde o app entra nele: recebe o token de acesso do Supabase (o mesmo do login),
descobre de quem é, e só entrega objeto que esteja debaixo de `u/<id-da-conta>/`.

Com ele, um PC novo baixa o material do professor sem nenhuma credencial da
Cloudflare na máquina — o único pedaço que faltava para "instalou, logou,
escolheu a pasta, pronto".

## Publicar (uma vez só)

```powershell
cd C:\Users\donat\Desktop\athena-app\worker
npx wrangler login      # abre o navegador; autorize a conta da Cloudflare
npx wrangler deploy
```

O deploy termina imprimindo o endereço, algo como:

```
https://athena-r2.donatto-athena.workers.dev
```

Esse endereço entra no app em **um lugar só**: `electron/bootstrap.ts`,
constante `WORKER_PADRAO`. Depois é `npm run dist` de novo, para o instalador
sair com ele dentro.

Enquanto a constante estiver vazia, o app funciona normalmente e só avisa, na
tela do primeiro uso, que o material do professor não foi baixado.

## Conferir

```powershell
curl https://athena-r2.donatto-athena.workers.dev/health
```

Tem que responder `ok`. Sem token, qualquer outra rota responde 401 — é o
comportamento certo.

Antes de publicar, `npm run test:worker` (na raiz do athena-app) roda o Worker
contra um bucket de mentira: cobre 401 sem token, 403 com token de outra conta,
paginação da listagem e nome de arquivo com acento e espaço.

## Rotas

| Rota | O que faz |
| --- | --- |
| `GET /health` | responde `ok`, sem token |
| `GET /list?prefixo=inatel` | lista os objetos da conta naquele grupo |
| `GET /list?prefixo=raw-attachments` | idem, para as imagens coladas nas notas |
| `GET /f?k=<chave>` | devolve o arquivo |

Todas, menos `/health`, exigem `Authorization: Bearer <access_token>`.

## O que garante o isolamento entre contas

A chave do objeto começa com `u/<id-da-conta>/`. O Worker compara esse pedaço
com o dono do token e recusa o resto — 403. Não há tabela de permissão para
alguém envenenar, nem consulta que possa devolver "sim" por engano: o dono está
escrito na própria chave.

Quem escreve essas chaves é o `athena publish`
(`Athena/athena-web/scripts/athena-publish.mjs`), que sobe cada fonte para
`u/<id>/inatel/...` e `u/<id>/raw-attachments/...`. O que já estava no bucket
com o nome antigo é copiado para o novo por dentro do R2, sem reenviar byte.

## Custo

O plano gratuito do Workers cobre 100 mil requisições por dia. Um pull completo
do vault gasta algumas dezenas.
