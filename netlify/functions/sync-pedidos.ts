import type { Config } from "@netlify/functions";
import { pesquisarPedidos, obterPedido, lancarEstoquePedido, darEntradaEstoqueProduto } from "../../src/lib/tiny";
import { supabaseAdmin } from "../../src/lib/supabaseAdmin";
import type { Transferencia } from "../../src/lib/supabaseAdmin";

const CNPJ_EMPRESA_B = onlyDigits(process.env.CNPJ_EMPRESA_B ?? "");
const SITUACAO_GATILHO_PEDIDO = process.env.SITUACAO_GATILHO_PEDIDO ?? "Aprovado";
const DEPOSITO_ID_EMPRESA_B = process.env.DEPOSITO_ID_EMPRESA_B ?? "";

function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

// O webhook nativo do Tiny ("Receber notificações de vendas") não disparou em
// testes para pedidos criados/alterados manualmente dentro do próprio ERP —
// parece cobrir só pedidos vindos de integração com e-commerce. Por isso a
// detecção é por verificação periódica (a cada 10 min), não por webhook.
export default async () => {
  const sb = supabaseAdmin();

  const pedidos = await pesquisarPedidos("a", {
    cpfCnpj: CNPJ_EMPRESA_B,
    situacao: SITUACAO_GATILHO_PEDIDO,
  });

  for (const resumo of pedidos) {
    const idPedidoA = String(resumo.id);

    const { data: existente, error: selectError } = await sb
      .from("transferencias")
      .select("*")
      .eq("id_pedido_a", idPedidoA)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existente?.status === "concluido") continue;

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
      await avancarTransferencia(registro);
    } catch (err: any) {
      await sb
        .from("transferencias")
        .update({ status: "erro", erro: String(err?.message ?? err) })
        .eq("id_pedido_a", idPedidoA);
    }
  }
};

async function avancarTransferencia(registro: Transferencia) {
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
    const pedido = await obterPedido("a", idPedidoA);

    // ATENÇÃO: idProduto assumido igual nas duas contas (cadastro
    // compartilhado no multiempresa), confirmado pelo usuário.
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

// Roda a cada 10 minutos. Ajuste conforme o volume de transferências e o
// rate limit do plano Tiny contratado em cada conta.
export const config: Config = {
  schedule: "*/10 * * * *",
};
