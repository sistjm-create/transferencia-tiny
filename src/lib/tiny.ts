const TINY_API2_BASE = "https://api.tiny.com.br/api2";

export type Empresa = "a" | "b";

function tokenFor(empresa: Empresa): string {
  const envVar = empresa === "a" ? "TINY_EMPRESA_A_TOKEN" : "TINY_EMPRESA_B_TOKEN";
  const token = process.env[envVar];
  if (!token) {
    throw new Error(`Variável de ambiente ${envVar} não configurada.`);
  }
  return token;
}

interface RetornoBase {
  status_processamento: number;
  status: "OK" | "Erro";
  codigo_erro?: number;
  erros?: { erro: string }[];
}

async function tinyApi2Call<T>(
  empresa: Empresa,
  servico: string,
  params: Record<string, string>
): Promise<T> {
  const body = new URLSearchParams({
    token: tokenFor(empresa),
    formato: "json",
    ...params,
  });

  const res = await fetch(`${TINY_API2_BASE}/${servico}.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Tiny API v2 (empresa ${empresa}) ${servico} -> HTTP ${res.status}: ${text}`
    );
  }

  const json = (await res.json()) as { retorno: RetornoBase & T };
  const retorno = json.retorno;
  if (retorno.status !== "OK") {
    const mensagens = (retorno.erros ?? []).map((e) => e.erro).filter(Boolean).join("; ");
    // Alguns endpoints retornam o motivo em formatos diferentes de
    // `erros[].erro` (ex.: aninhado em `registros`). Nesses casos, inclui o
    // JSON completo em vez de só o status_processamento genérico, pra dar
    // pra diagnosticar sem depender dos logs do Netlify.
    throw new Error(
      `Tiny API v2 (empresa ${empresa}) ${servico} retornou erro: ${mensagens || JSON.stringify(retorno)}`
    );
  }
  return retorno;
}

export interface PedidoItem {
  item: {
    id_produto: string;
    codigo: string;
    descricao: string;
    quantidade: string;
    valor_unitario: string;
  };
}

export interface Pedido {
  id: string;
  numero: string;
  situacao: string;
  cliente: {
    nome: string;
    cnpj?: string;
    cpf?: string;
  };
  itens: PedidoItem[];
}

export interface PedidoResumo {
  id: string;
  numero: string;
  situacao: string;
}

export async function pesquisarPedidos(
  empresa: Empresa,
  params: { cpfCnpj: string; situacao?: string }
): Promise<PedidoResumo[]> {
  const body: Record<string, string> = { cpf_cnpj: params.cpfCnpj };
  if (params.situacao) body.situacao = params.situacao;
  const retorno = await tinyApi2Call<{ pedidos?: { pedido: PedidoResumo }[] }>(
    empresa,
    "pedidos.pesquisa",
    body
  );
  return (retorno.pedidos ?? []).map((p) => p.pedido);
}

export async function obterPedido(empresa: Empresa, idPedido: string): Promise<Pedido> {
  const retorno = await tinyApi2Call<{ pedido: Pedido }>(empresa, "pedido.obter", {
    id: idPedido,
  });
  return retorno.pedido;
}

export async function lancarEstoquePedido(empresa: Empresa, idPedido: string): Promise<void> {
  try {
    await tinyApi2Call(empresa, "pedido.lancar.estoque", { id: idPedido });
  } catch (err: any) {
    // Contas com a configuração "baixar estoque ao aprovar o pedido" já
    // baixam o estoque sozinhas ao atingir SITUACAO_GATILHO_PEDIDO — a
    // chamada explícita então chega tarde e o Tiny recusa. O objetivo
    // (estoque baixado em A) já está cumprido nesse caso.
    if (String(err?.message ?? err).includes("Estoque já lançado")) return;
    throw err;
  }
}

export async function darEntradaEstoqueProduto(
  empresa: Empresa,
  params: {
    codigo: string;
    quantidade: string;
    deposito?: string;
    observacoes: string;
  }
): Promise<void> {
  // Usa o código (SKU) em vez de idProduto — o id interno é sempre
  // diferente entre as duas contas, mas o código é o mesmo, e o Tiny
  // aceita esse campo como alternativa ao idProduto nesse endpoint.
  const estoque: Record<string, unknown> = {
    codigo: params.codigo,
    tipo: "E",
    quantidade: Number(params.quantidade),
    observacoes: params.observacoes,
  };
  // Contas com um único estoque geral não têm depósito para informar.
  if (params.deposito) {
    estoque.deposito = params.deposito;
  }
  const estoqueJson = JSON.stringify(estoque);
  try {
    await tinyApi2Call(empresa, "produto.atualizar.estoque", {
      estoque: estoqueJson,
    });
  } catch (err: any) {
    throw new Error(`${err?.message ?? err} | payload enviado: estoque=${estoqueJson}`);
  }
}
