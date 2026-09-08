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

## Como funciona o gatilho (polling, não webhook)

Testamos primeiro o recurso nativo de **Webhooks** do Tiny (Configurações >
Webhooks > "Receber notificações de vendas"), mas em teste real ele **não
disparou** para um pedido criado/alterado manualmente dentro do próprio
Tiny — esse recurso parece cobrir só pedidos vindos de uma integração de
e-commerce conectada, não pedidos internos. Por isso a automação usa
**verificação periódica** em vez de webhook:

A function `sync-pedidos` roda a cada 10 minutos e:

1. Busca em A, via `pedidos.pesquisa.php`, pedidos do cliente com o CNPJ da
   Empresa B e na situação configurada (`SITUACAO_GATILHO_PEDIDO`).
2. Para cada pedido ainda não processado (controlado pela tabela
   `transferencias` no Supabase, evitando duplicar), busca os itens
   completos com `pedido.obter.php`.
3. Baixa o estoque em A (`pedido.lancar.estoque.php`).
4. Dá entrada, item a item, no estoque de B (`produto.atualizar.estoque.php`,
   tipo `E`), usando o mesmo `idProduto` do pedido (cadastro compartilhado
   entre as contas).

## Pré-requisitos

- Conta Tiny ativa para Empresa A e Empresa B, multiempresa configurado.
- Empresa B cadastrada como contato/cliente na conta A, com CNPJ preenchido.
- Um depósito de estoque definido na conta B para receber a mercadoria (ou
  nenhum, se a conta B usa só um estoque geral).
- Token da API v2 de cada conta (Integrações > API do ERP > Credenciais de
  acesso > campo "Token" — **trate como senha, nunca compartilhe**).
- Conta gratuita no [Supabase](https://supabase.com).
- Conta gratuita no [Netlify](https://netlify.com).

## 1. Criar o projeto no Supabase

1. Crie um projeto novo (gratuito).
2. Em **SQL Editor**, rode o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
3. Em **Project Settings > API > Legacy anon, service_role API keys**, copie
   a `URL` do projeto e a chave `service_role`.

## 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Preencha `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, os dois tokens Tiny,
`CNPJ_EMPRESA_B` e `SITUACAO_GATILHO_PEDIDO`. `DEPOSITO_ID_EMPRESA_B` só é
necessário se a conta B tiver múltiplos depósitos de estoque configurados —
deixe em branco se ela usa só um estoque geral. As mesmas variáveis
precisam ser cadastradas no painel do Netlify (**Project configuration >
Environment variables**) antes do deploy.

## 3. Deploy

Conecte o repositório no Netlify (Import an existing project) ou rode:

```bash
npm install
netlify deploy --prod
```

**Importante:** o site precisa estar com **Production visibility: Public**
(Project configuration > General > Visitor access) — por padrão o Netlify
cria projetos novos como privados, o que bloquearia qualquer chamada
externa às functions.

A função `sync-pedidos` já roda sozinha a cada 10 minutos assim que
publicada (não precisa configurar nada no Tiny para o gatilho).

## Acompanhando as transferências

Consulte a tabela `transferencias` no Supabase: cada linha mostra o `status`
atual (`detectado` → `estoque_baixado_em_a` → `concluido`) ou `erro` (com a
mensagem em `erro`, para correção manual no Tiny).

## Pontos para validar no primeiro teste real

- Crie um pedido de teste em A, com item de baixo valor/quantidade, tendo a
  Empresa B como cliente, e leve-o até a situação configurada em
  `SITUACAO_GATILHO_PEDIDO`.
- Aguarde até 10 minutos e confira a tabela `transferencias` no Supabase.
- Confirme que o estoque baixou em A e subiu em B, e que a observação do
  lançamento em B referencia o pedido de origem.
- Se `SITUACAO_GATILHO_PEDIDO` não corresponder ao texto exato que o Tiny
  espera no filtro de `pedidos.pesquisa.php` (`situacao`), ajuste a
  variável de ambiente — não há uma tabela oficial completa desses valores,
  então o primeiro teste real é quem confirma o texto certo.
- Pode desativar o toggle "Receber notificações de vendas" em Configurações
  > Webhooks na conta A — não é mais usado por este projeto.
