-- ============================================================
-- EL MITAYO · 04 · SERIES NUEVAS Y BORRAR LAS PRUEBAS
-- El sistema anterior usa B002 y F002. Para no repetir números,
-- esta plataforma usa series propias:
--   boletas B003 · facturas F003 · notas de crédito BC03 / FC03
-- También borra las ventas de prueba en producción (B001/F001)
-- que SUNAT nunca aceptó, para que no se envíen.
-- Se ejecuta una sola vez en el SQL Editor de Supabase (El Mitayo).
-- ============================================================

update public.sunat_config
set serie_boleta = 'B003',
    serie_factura = 'F003',
    serie_nc_boleta = 'BC03',
    serie_nc_factura = 'FC03',
    actualizado_en = now()
where id = 1;

-- Ventas de prueba en producción con B001 / F001 que SUNAT no aceptó
with pruebas as (
  select distinct venta_id
  from public.comprobantes
  where ambiente = 'PRODUCCION'
    and serie in ('B001', 'F001')
    and estado not in ('ACEPTADO', 'OBSERVADO')
)
delete from public.ventas v
using pruebas p
where v.id = p.venta_id;

delete from public.comprobante_correlativos
where ambiente = 'PRODUCCION' and serie in ('B001', 'F001')
  and not exists (
    select 1 from public.comprobantes c
    where c.ambiente = 'PRODUCCION' and c.serie = comprobante_correlativos.serie
  );

select serie_boleta, serie_factura, serie_nc_boleta, serie_nc_factura,
       (select count(*) from public.comprobantes where ambiente = 'PRODUCCION') as comprobantes_reales_que_quedan
from public.sunat_config where id = 1;
