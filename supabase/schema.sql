create table if not exists transferencias (
  id bigint generated always as identity primary key,
  id_pedido_a text not null unique,
  status text not null default 'detectado'
    check (status in ('detectado', 'estoque_baixado_em_a', 'concluido', 'erro')),
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create or replace function set_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists transferencias_atualizado_em on transferencias;
create trigger transferencias_atualizado_em
before update on transferencias
for each row execute function set_atualizado_em();
