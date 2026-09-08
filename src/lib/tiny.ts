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
    const mensagens = (retorno.erros ?? []).map((e) => e.erro).join("; ");
    throw new Error(
      `Tiny API v2 (empresa ${empresa}) ${servico} retornou erro: ${mensagens || retorno.status_processamento}`
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
  await tinyApi2Call(empresa, "pedido.lancar.estoque", { id: idPedido });
}

export async function darEntradaEstoqueProduto(
  empresa: Empresa,
  params: {
    idProduto: string;
    quantidade: string;
    deposito?: string;
    observacoes: string;
  }
): Promise<void> {
  const estoque: Record<string, string> = {
    idProduto: params.idProduto,
    tipo: "E",
    quantidade: params.quantidade,
    observacoes: params.observacoes,
  };
  // Contas com um único estoque geral não têm depósito para informar.
  if (params.deposito) {
    estoque.deposito = params.deposito;
  }
  await tinyApi2Call(empresa, "produto.atualizar.estoque", {
    estoque: JSON.stringify(estoque),
  });
}
