import { createClient } from "@supabase/supabase-js";

export function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type StatusTransferencia =
  | "detectado"
  | "estoque_baixado_em_a"
  | "concluido"
  | "erro";

export interface Transferencia {
  id: number;
  id_pedido_a: string;
  status: StatusTransferencia;
  erro: string | null;
}
