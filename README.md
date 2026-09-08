# Transferência automática entre empresas — Tiny ERP (API v2)

Automação que, quando um pedido é criado na Empresa A destinado à Empresa B
(multiempresa do Tiny) e atinge a situação configurada (ex.: "Aprovado"),
baixa o estoque em A e dá entrada no estoque de B — sem emissão de nota
fiscal, sem intervenção manual depois da criação do pedido.

Ver o plano completo (contexto, decisões e riscos) em:
`C:\Users\hp\.claude\plans\eu-uso-o-erp-serene-hellman.md`

## Por que API v2 (e não v3)

A conta do usuário só tem a credencial de **token único** (Integrações > API
do ERP), que é a **API v2** do Tiny — não existe a tela de "Aplicativos"
(OAuth2/client_id) usada pela v3. A v2 é mais simples (token fixo, sem
refresh) mas **não tem endpoint de Ordem de Compra**. Por isso a "entrada"
em B é feita como um lançamento de estoque (`produto.atualizar.estoque.php`,
tipo `E`) com uma observação referenciando o pedido de origem — **não gera
um documento de Ordem de Compra/Borderô visível em B como no processo manual
atual**. Se isso for essencial para o controle do usuário, o passo de criar
a Ordem de Compra em B continua manual; só a baixa em A e uma entrada de
estoque "crua" em B são automatizadas.

## Como funciona o gatilho

A conta A tem um recurso nativo de **Webhooks** (Configurações > Webhooks).
Ativamos "Receber notificações de vendas" com a URL desta function. O Tiny
faz um POST a cada mudança de situação de um pedido; a function então:

1. Confere um `secret` na própria URL (o Tiny não assina o payload).
2. Reconsulta o pedido com `pedido.obter.php` usando o token da empresa A
   (nunca confia nos dados do POST além do id do pedido).
3. Só age se o cliente do pedido for a Empresa B (por CNPJ) **e** a situação
   bater com a configurada.
4. Baixa o estoque em A (`pedido.lancar.estoque.php`).
5. Dá entrada, item a item, no estoque de B (`produto.atualizar.estoque.php`,
   tipo `E`), usando o mesmo `idProduto` do pedido (cadastro compartilhado
   entre as contas).

Cada pedido processado vira uma linha na tabela `transferencias` do
Supabase, usada para nunca reprocessar o mesmo pedido (o webhook pode
disparar várias vezes para o mesmo pedido, a cada mudança de situação).

## Pré-requisitos

- Conta Tiny ativa para Empresa A e Empresa B, multiempresa configurado.
- Empresa B cadastrada como contato/cliente na conta A, com CNPJ preenchido.
- Um depósito de estoque definido na conta B para receber a mercadoria.
- Token da API v2 de cada conta (Integrações > API do ERP > Credenciais de
  acesso > campo "Token" — **trate como senha, nunca compartilhe**).
- Conta gratuita no [Supabase](https://supabase.com).
- Conta gratuita no [Netlify](https://netlify.com) e [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`npm i -g netlify-cli`).

## 1. Criar o projeto no Supabase

1. Crie um projeto novo (gratuito).
2. Em **SQL Editor**, rode o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
3. Em **Project Settings > API**, copie a `URL` do projeto e a chave
   `service_role`.

## 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Preencha `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, os dois tokens Tiny,
`CNPJ_EMPRESA_B`, `SITUACAO_GATILHO_PEDIDO`, `DEPOSITO_ID_EMPRESA_B` e
`WEBHOOK_SECRET` (valor aleatório qualquer). As mesmas variáveis precisam
ser cadastradas no painel do Netlify (**Site settings > Environment
variables**) antes do deploy.

## 3. Instalar dependências e testar localmente

```bash
npm install
npm run dev
```

## 4. Deploy

```bash
netlify deploy --prod
```

## 5. Configurar o webhook na conta A

Em **Configurações > Webhooks**, ative "Receber notificações de vendas" e
cole a URL:

```
https://SEUSITE.netlify.app/.netlify/functions/webhook-pedido?secret=SEU_WEBHOOK_SECRET
```

## Acompanhando as transferências

Consulte a tabela `transferencias` no Supabase: cada linha mostra o `status`
atual (`detectado` → `estoque_baixado_em_a` → `concluido`) ou `erro` (com a
mensagem em `erro`, para correção manual no Tiny).

## Pontos para validar no primeiro teste real

- Crie um pedido de teste em A, com item de baixo valor/quantidade, tendo a
  Empresa B como cliente, e leve-o até a situação configurada em
  `SITUACAO_GATILHO_PEDIDO`.
- Confira nos logs da function (painel do Netlify) que o webhook chegou.
- Confirme que o estoque baixou em A e subiu em B, e que a observação do
  lançamento em B referencia o pedido de origem.
- Mude a situação do mesmo pedido de novo (ex. para "Faturado") e confirme
  que a automação **não** duplica a baixa/entrada (o registro já está
  `concluido` no Supabase).
- Se `SITUACAO_GATILHO_PEDIDO` não corresponder ao texto exato que o Tiny
  retorna em `pedido.obter.php` (`situacao`), ajuste a variável de ambiente
  — não há uma tabela oficial completa desses valores, então o primeiro
  teste real é quem confirma o texto certo.
