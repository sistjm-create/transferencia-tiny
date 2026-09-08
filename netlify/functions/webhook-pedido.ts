import type { Handler } from "@netlify/functions";
import { obterPedido, lancarEstoquePedido, darEntradaEstoqueProduto } from "../../src/lib/tiny";
import { supabaseAdmin } from "../../src/lib/supabaseAdmin";
import type { Transferencia } from "../../src/lib/supabaseAdmin";

const CNPJ_EMPRESA_B = onlyDigits(process.env.CNPJ_EMPRESA_B ?? "");
const SITUACAO_GATILHO_PEDIDO = (process.env.SITUACAO_GATILHO_PEDIDO ?? "aprovado").toLowerCase();
const DEPOSITO_ID_EMPRESA_B = process.env.DEPOSITO_ID_EMPRESA_B ?? "";

function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

interface WebhookPedidoPayload {
  dados?: {
    idVendaTiny?: number | string;
  };
}

// O Tiny não assina o payload do webhook, então esta função nunca confia nos
// dados do POST além do id do pedido: tudo o mais é reconsultado com o
// próprio token da conta A antes de qualquer ação.
export const handler: Handler = async (event) => {
  const secret = event.queryStringParameters?.secret;
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 403, body: "secret inválido" };
  }

  let payload: WebhookPedidoPayload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "JSON inválido" };
  }

  const idPedidoA = payload.dados?.idVendaTiny;
  if (!idPedidoA) {
    // Payload sem id de pedido: responde 200 para o Tiny não ficar retentando
    // algo que nunca vamos conseguir processar.
    return { statusCode: 200, body: "sem idVendaTiny, ignorado" };
  }

  try {
    await processarNotificacao(String(idPedidoA));
  } catch (err: any) {
    console.error("Erro ao processar webhook de pedido:", err);
    // Responde 200 mesmo em erro (o erro já foi registrado no Supabase pela
    // função abaixo) para o Tiny não ficar retentando indefinidamente algo
    // que exige correção manual.
  }

  return { statusCode: 200, body: "ok" };
};

async function processarNotificacao(idPedidoA: string) {
  const sb = supabaseAdmin();

  const { data: existente, error: selectError } = await sb
    .from("transferencias")
    .select("*")
    .eq("id_pedido_a", idPedidoA)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existente?.status === "concluido") return;

  const pedido = await obterPedido("a", idPedidoA);

  const cnpjCliente = onlyDigits(pedido.cliente?.cnpj ?? "");
  const situacao = pedido.situacao?.toLowerCase() ?? "";

  const eTransferenciaParaB = cnpjCliente === CNPJ_EMPRESA_B;
  const situacaoBate = situacao === SITUACAO_GATILHO_PEDIDO;
  if (!eTransferenciaParaB || !situacaoBate) {
    return;
  }

  let registro: Transferencia = existente as Transferencia;
  if (!registro) {
    const { data, error } = await sb
      .from("transferencias")
      .insert({ id_pedido_a: idPedidoA, status: "detectado" })
      .select()
      .single();
    if (error) throw error;
    registro = data as Transferencia;
  }

  try {
    await avancarTransferencia(registro, pedido);
  } catch (err: any) {
    await sb
      .from("transferencias")
      .update({ status: "erro", erro: String(err?.message ?? err) })
      .eq("id_pedido_a", idPedidoA);
    throw err;
  }
}

async function avancarTransferencia(
  registro: Transferencia,
  pedido: Awaited<ReturnType<typeof obterPedido>>
) {
  const sb = supabaseAdmin();
  const idPedidoA = registro.id_pedido_a;

  if (registro.status === "detectado") {
    await lancarEstoquePedido("a", idPedidoA);
    await sb
      .from("transferencias")
      .update({ status: "estoque_baixado_em_a" })
      .eq("id_pedido_a", idPedidoA);
    registro.status = "estoque_baixado_em_a";
  }

  if (registro.status === "estoque_baixado_em_a") {
    for (const { item } of pedido.itens) {
      await darEntradaEstoqueProduto("b", {
        idProduto: item.id_produto,
        quantidade: item.quantidade,
        deposito: DEPOSITO_ID_EMPRESA_B,
        observacoes: `Transferência automática referente ao pedido #${pedido.numero} (id ${idPedidoA}) da Empresa A.`,
      });
    }
    await sb
      .from("transferencias")
      .update({ status: "concluido" })
      .eq("id_pedido_a", idPedidoA);
  }
}
