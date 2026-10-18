/* Ventas guardadas en la nube: lo que se lista en «Venta del día» y «Comprobantes» */

import { createClient } from "@/lib/supabase/client";
import { leer, type Cliente, type Contexto, type Linea } from "@/lib/local";
import type { DatosTicket } from "@/lib/ticket";

export type ComprobanteNube = {
  id: number;
  tipo: string;
  serie: string;
  numero: number;
  estado: string;
  mensaje: string | null;
  ambiente: string;
  token: string;
};

export type FilaNube = {
  id: number;
  fecha: string;
  tipo: "03" | "01";
  total: number;
  metodo_pago: string;
  estado: "CONFIRMADA" | "ANULADA";
  motivo_anulacion: string | null;
  cliente_tipo_doc: string;
  cliente_numero: string;
  cliente_nombre: string;
  cliente_direccion: string | null;
  comprobantes: ComprobanteNube[];
};

export const SELECT_VENTAS =
  "id, fecha, tipo, total, metodo_pago, estado, motivo_anulacion, cliente_tipo_doc, cliente_numero, cliente_nombre, cliente_direccion, comprobantes(id, tipo, serie, numero, estado, mensaje, ambiente, token)";

export function original(v: FilaNube): ComprobanteNube | undefined {
  return v.comprobantes.find((c) => c.tipo === v.tipo);
}

export function notaDeCredito(v: FilaNube): ComprobanteNube | undefined {
  return v.comprobantes.find((c) => c.tipo === "07");
}

export function hoyLima(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

/* Inicio y fin (en hora de Lima) de un rango de días AAAA-MM-DD */
export function rangoDias(desde: string, hasta: string): [string, string] {
  return [new Date(`${desde}T00:00:00-05:00`).toISOString(), new Date(`${hasta}T23:59:59.999-05:00`).toISOString()];
}

/* Arma el comprobante para imprimir o enviar por WhatsApp */
export async function datosNube(v: FilaNube): Promise<DatosTicket | null> {
  const ctx = await leer<Contexto>("contexto");
  const c = original(v);
  if (!ctx || !c) return null;

  const { data, error } = await createClient()
    .from("venta_detalles")
    .select("producto_id, codigo, descripcion, unidad, cantidad, precio, importe")
    .eq("venta_id", v.id)
    .order("id");
  if (error) throw new Error(`No se pudo leer la venta: ${error.message}`);

  return {
    emisor: ctx.emisor,
    ambiente: c.ambiente === "PRODUCCION" ? "PRODUCCION" : "BETA",
    tipo: v.tipo,
    serie: c.serie,
    numero: c.numero,
    fecha: v.fecha,
    cliente: { tipo_doc: v.cliente_tipo_doc as Cliente["tipo_doc"], numero: v.cliente_numero, nombre: v.cliente_nombre, direccion: v.cliente_direccion },
    lineas: ((data ?? []) as Linea[]).map((l) => ({ ...l, cantidad: Number(l.cantidad), precio: Number(l.precio), importe: Number(l.importe) })),
    total: Number(v.total),
    metodo_pago: v.metodo_pago,
  };
}
