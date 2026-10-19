/* ============================================================
   SINCRONIZAR CON LA NUBE (solo navegador)
   - baja los datos del negocio y el catálogo al celular
   - sube las ventas cobradas (con o sin internet)
   - envía a SUNAT los comprobantes pendientes, uno por uno
   ============================================================ */

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import { enviarSunat } from "@/app/protected/acciones";
import {
  guardar,
  leer,
  productosGuardados,
  quitarVentaLocal,
  reemplazarProductos,
  subirContador,
  ventasPorSubir,
  guardarVentaLocal,
  type Contexto,
  type Producto,
  type VentaLocal,
} from "./local";
import { numeroCompleto } from "./ticket";

/* ---------------- estado de la conexión ---------------- */

let sinConexion = typeof navigator !== "undefined" ? !navigator.onLine : false;
const oyentes = new Set<() => void>();

export function haySinConexion(): boolean {
  return sinConexion;
}

export function marcarSinConexion(valor: boolean) {
  if (sinConexion === valor) return;
  sinConexion = valor;
  oyentes.forEach((f) => f());
}

function suscribir(f: () => void) {
  oyentes.add(f);
  const apagado = () => marcarSinConexion(true);
  const encendido = () => marcarSinConexion(false);
  window.addEventListener("offline", apagado);
  window.addEventListener("online", encendido);
  return () => {
    oyentes.delete(f);
    window.removeEventListener("offline", apagado);
    window.removeEventListener("online", encendido);
  };
}

export function useSinConexion(): boolean {
  return useSyncExternalStore(suscribir, haySinConexion, () => false);
}

export function esErrorDeRed(e: unknown): boolean {
  if (!e) return false;
  const err = e as { message?: string; code?: string; name?: string };
  if (err.code && /^[0-9A-Z]{5}$/.test(err.code)) return false;
  if (err.code && err.code.startsWith("PGRST")) return false;
  return /fetch|network|abort|timeout|timed out|load failed|conexi|internet|502|503|504|gateway/i.test(`${err.name ?? ""} ${err.message ?? ""}`);
}

function limite(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/* ---------------- bajar datos ---------------- */

export async function bajarContexto(): Promise<Contexto | null> {
  const sb = createClient();
  const { data, error } = await sb.rpc("app_contexto").abortSignal(limite(8000));

  if (error) {
    if (esErrorDeRed(error)) marcarSinConexion(true);
    return leer<Contexto>("contexto");
  }

  marcarSinConexion(false);
  const ctx = data as Contexto;
  await guardar("contexto", ctx);

  // El contador del celular nunca queda por debajo del de la nube
  await subirContador(ctx.series["03"], ctx.ambiente, ctx.ultimos["03"]);
  await subirContador(ctx.series["01"], ctx.ambiente, ctx.ultimos["01"]);

  return ctx;
}

/* Huella del catálogo: cuántos productos hay y cuándo cambió el último.
   Si es la misma de la última vez, no se vuelve a bajar todo. */
async function huellaCatalogo(): Promise<string | null> {
  const sb = createClient();
  const [cuenta, ultimo] = await Promise.all([
    sb.from("productos").select("id", { count: "exact", head: true }).abortSignal(limite(8000)),
    sb.from("productos").select("actualizado_en").order("actualizado_en", { ascending: false }).limit(1).abortSignal(limite(8000)),
  ]);
  if (cuenta.error || ultimo.error) return null;
  const fecha = ((ultimo.data ?? []) as Array<{ actualizado_en: string }>)[0]?.actualizado_en ?? "";
  return `${cuenta.count ?? 0}|${fecha}`;
}

/* Baja el catálogo solo si cambió (o si se pide forzar). Devuelve true si lo renovó. */
export async function actualizarCatalogo(forzar = false): Promise<boolean> {
  const huella = await huellaCatalogo().catch(() => null);
  const anterior = await leer<string>("catalogo_huella").catch(() => null);
  const guardados = await productosGuardados().catch(() => []);
  if (!forzar && huella && huella === anterior && guardados.length > 0) {
    await guardar("catalogo_en", new Date().toISOString());
    return false;
  }
  const lista = await bajarCatalogo();
  if (lista && huella) await guardar("catalogo_huella", huella);
  return !!lista;
}

export async function bajarCatalogo(): Promise<Producto[] | null> {
  const sb = createClient();
  const todos: Producto[] = [];
  const pagina = 1000;

  for (let desde = 0; desde < 50_000; desde += pagina) {
    const { data, error } = await sb
      .from("productos")
      .select("id, codigo, nombre, unidad, precio")
      .eq("activo", true)
      .order("id")
      .range(desde, desde + pagina - 1)
      .abortSignal(limite(15000));

    if (error) {
      if (esErrorDeRed(error)) marcarSinConexion(true);
      return null;
    }

    const filas = (data ?? []) as Array<{ id: number; codigo: string; nombre: string; unidad: string; precio: number | string }>;
    for (const f of filas) todos.push({ id: Number(f.id), codigo: f.codigo, nombre: f.nombre, unidad: f.unidad, precio: Number(f.precio) });
    if (filas.length < pagina) break;
  }

  await reemplazarProductos(todos);
  await guardar("catalogo_en", new Date().toISOString());
  return todos;
}

/* ---------------- subir ventas ---------------- */

export type Aviso = { uid: string; texto: string; creado: number };

async function agregarAviso(texto: string, uid: string) {
  const lista = (await leer<Aviso[]>("avisos")) ?? [];
  lista.push({ uid, texto, creado: Date.now() });
  await guardar("avisos", lista.slice(-20));
}

export type ResultadoSubir = { ok: true; ventaId: number; comprobanteId: number; serie: string; numero: number; renumerado: boolean } | { ok: false; red: boolean; error: string };

export async function subirVenta(v: VentaLocal): Promise<ResultadoSubir> {
  const sb = createClient();
  const { data, error } = await sb
    .rpc("app_venta_registrar", {
      p_uid: v.uid,
      p_datos: {
        fecha: v.fecha,
        tipo: v.tipo,
        numero: v.numero,
        metodo_pago: v.metodo_pago,
        cliente: v.cliente,
        lineas: v.lineas,
        total: v.total,
        sin_conexion: v.sin_conexion,
      },
    })
    .abortSignal(limite(10000));

  if (error) {
    const red = esErrorDeRed(error);
    if (red) marcarSinConexion(true);
    return { ok: false, red, error: error.message };
  }

  marcarSinConexion(false);

  const r = data as { venta_id: number; comprobante_id: number; serie: string; numero: number; renumerado: boolean; repetida: boolean };
  await quitarVentaLocal(v.uid);

  const ctx = await leer<Contexto>("contexto");
  if (ctx) await subirContador(r.serie, ctx.ambiente, Number(r.numero));

  if (r.renumerado) {
    await agregarAviso(
      `La venta del ticket ${numeroCompleto(v.serie, v.numero)} quedó registrada como ${numeroCompleto(r.serie, r.numero)} (ese número ya estaba usado). Si el cliente lo pide, reimprímela desde Ventas.`,
      v.uid
    );
  }

  return { ok: true, ventaId: Number(r.venta_id), comprobanteId: Number(r.comprobante_id), serie: r.serie, numero: Number(r.numero), renumerado: r.renumerado };
}

let subiendo = false;

export async function subirPendientes(): Promise<number[]> {
  if (subiendo) return [];
  subiendo = true;
  const ids: number[] = [];

  try {
    for (const v of await ventasPorSubir()) {
      const r = await subirVenta(v);
      if (r.ok) ids.push(r.comprobanteId);
      else if (r.red) break;
      else {
        await guardarVentaLocal({ ...v, estado: "ERROR", error: r.error, intentos: v.intentos + 1 });
        await agregarAviso(`No se pudo subir la venta ${numeroCompleto(v.serie, v.numero)}: ${r.error}`, v.uid);
      }
    }
  } finally {
    subiendo = false;
  }

  return ids;
}

/* ---------------- enviar a SUNAT ---------------- */

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

let enviando = false;

export async function enviarPendientesSunat(maximo = 15): Promise<void> {
  if (enviando || haySinConexion()) return;
  enviando = true;

  try {
    const ctx = await leer<Contexto>("contexto");
    const sb = createClient();
    const { data, error } = await sb
      .from("comprobantes")
      .select("id")
      .in("estado", ["PENDIENTE", "ERROR"])
      .eq("ambiente", ctx?.ambiente ?? "BETA")
      .or(`proximo_intento.is.null,proximo_intento.lte."${new Date().toISOString()}"`)
      .order("id")
      .limit(maximo);

    if (error) return;

    let fallas = 0;

    for (const { id } of (data ?? []) as Array<{ id: number }>) {
      let r = await enviarSunat(Number(id)).catch(() => null);

      for (let k = 0; k < 3 && r && r.ok && r.estado === "EN_COLA" && r.reintentarEnMs; k++) {
        await pausa(r.reintentarEnMs);
        r = await enviarSunat(Number(id)).catch(() => null);
      }

      if (!r || !r.ok || r.estado === "PENDIENTE") break; // falta configurar SUNAT o no hay conexión
      if (r.estado === "ERROR" && ++fallas >= 3) break;

      await pausa(3000);
    }
  } finally {
    enviando = false;
  }
}
