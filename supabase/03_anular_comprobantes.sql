-- ============================================================
-- EL MITAYO · 03 · ANULAR COMPROBANTES (nota de crédito automática)
-- Se ejecuta una sola vez en el SQL Editor, después de 01 y 02.
-- Se puede volver a ejecutar sin problema.
--
-- SUNAT no deja «borrar» una boleta o factura. Para anularla se emite
-- una NOTA DE CRÉDITO (motivo 01: anulación de la operación):
--   boletas  → serie BC01      facturas → serie FC01
-- La nota se envía sola a SUNAT, después de que SUNAT acepte el original.
-- ============================================================

alter table public.sunat_config add column if not exists serie_nc_boleta text not null default 'BC01';
alter table public.sunat_config add column if not exists serie_nc_factura text not null default 'FC01';

alter table public.ventas add column if not exists anulada_en timestamptz;
alter table public.ventas add column if not exists motivo_anulacion text;

create index if not exists ventas_cliente_idx on public.ventas (lower(cliente_nombre));

create or replace function public.app_venta_anular(p_venta_id bigint, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.ventas%rowtype;
  o public.comprobantes%rowtype;
  c public.sunat_config%rowtype;
  v_serie text;
  v_numero integer;
  v_motivo text := upper(left(coalesce(nullif(btrim(p_motivo), ''), 'ANULACION DE LA OPERACION'), 200));
  v_nc_id bigint;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;

  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if v.estado = 'ANULADA' then raise exception 'Esta venta ya está anulada.'; end if;

  select * into o from comprobantes where venta_id = v.id and tipo in ('01', '03') order by id limit 1;
  if not found then raise exception 'La venta no tiene comprobante.'; end if;

  update ventas set estado = 'ANULADA', anulada_en = now(), motivo_anulacion = v_motivo where id = v.id;

  -- Si SUNAT rechazó el original, no vale: basta con marcarla anulada
  if o.estado = 'RECHAZADO' then
    return jsonb_build_object('ok', true, 'nota', null);
  end if;

  select * into c from sunat_config where id = 1;
  v_serie := case when o.tipo = '01' then c.serie_nc_factura else c.serie_nc_boleta end;

  insert into comprobante_correlativos (serie, ambiente, ultimo) values (v_serie, o.ambiente, 0)
  on conflict (serie, ambiente) do nothing;

  update comprobante_correlativos set ultimo = ultimo + 1
  where serie = v_serie and ambiente = o.ambiente
  returning ultimo into v_numero;

  insert into comprobantes (venta_id, tipo, serie, numero, ambiente, fecha_emision, cliente_tipo_doc, cliente_numero,
                            cliente_nombre, cliente_direccion, total, ref_tipo, ref_serie, ref_numero,
                            motivo_codigo, motivo_texto)
  values (v.id, '07', v_serie, v_numero, o.ambiente, now(), o.cliente_tipo_doc, o.cliente_numero,
          o.cliente_nombre, o.cliente_direccion, o.total, o.tipo, o.serie, o.numero, '01', v_motivo)
  returning id into v_nc_id;

  return jsonb_build_object('ok', true, 'nota', jsonb_build_object('id', v_nc_id, 'serie', v_serie, 'numero', v_numero));
end;
$$;

revoke all on function public.app_venta_anular(bigint, text) from public, anon;
grant execute on function public.app_venta_anular(bigint, text) to authenticated;

select 'Listo: ya se pueden anular comprobantes desde la plataforma.' as resultado;
