"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guardar, leer, ventasPorSubir, type Contexto, type VentaLocal } from "@/lib/local";
import { useSinConexion, type Aviso } from "@/lib/sincronizar";
import { d2, fechaHoraLima, imprimir, METODOS, nombreMetodo, numeroCompleto, type DatosTicket } from "@/lib/ticket";
import { hoyLima, rangoDias, SELECT_VENTAS, type FilaNube } from "@/lib/ventasNube";
import TablaComprobantes, { EstadoSunat } from "../_components/TablaComprobantes";
import BotonWhatsapp from "../_components/BotonWhatsapp";

export default function ListaVentas() {
  const sinConexion = useSinConexion();
  const [dia, setDia] = useState(hoyLima());
  const [filas, setFilas] = useState<FilaNube[]>([]);
  const [locales, setLocales] = useState<VentaLocal[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    setLocales(await ventasPorSubir().catch(() => []));
    setAvisos((await leer<Aviso[]>("avisos").catch(() => null)) ?? []);

    const [desde, hasta] = rangoDias(dia, dia);
    const { data, error: e } = await createClient()
      .from("ventas")
      .select(SELECT_VENTAS)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: false })
      .limit(1000);

    if (e) setError(sinConexion ? "Sin internet: solo se ven las ventas guardadas en este equipo." : e.message);
    else setFilas((data ?? []) as FilaNube[]);
    setCargando(false);
  }, [dia, sinConexion]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const f = () => void cargar();
    window.addEventListener("mitayo:sincronizado", f);
    return () => window.removeEventListener("mitayo:sincronizado", f);
  }, [cargar]);

  const esHoy = dia === hoyLima();
  const localesDelDia = esHoy ? locales : [];

  const resumen = useMemo(() => {
    const vigentes = filas.filter((f) => f.estado !== "ANULADA");
    const porMetodo = new Map<string, number>();
    let boletas = 0;
    let facturas = 0;
    for (const f of vigentes) {
      porMetodo.set(f.metodo_pago, (porMetodo.get(f.metodo_pago) ?? 0) + Number(f.total));
      if (f.tipo === "01") facturas += Number(f.total);
      else boletas += Number(f.total);
    }
    for (const v of localesDelDia) {
      porMetodo.set(v.metodo_pago, (porMetodo.get(v.metodo_pago) ?? 0) + v.total);
      if (v.tipo === "01") facturas += v.total;
      else boletas += v.total;
    }
    return {
      total: boletas + facturas,
      cantidad: vigentes.length + localesDelDia.length,
      anuladas: filas.length - vigentes.length,
      boletas,
      facturas,
      porMetodo: METODOS.map(([m]) => [m, porMetodo.get(m) ?? 0] as [string, number]).filter(([, t]) => t > 0),
    };
  }, [filas, localesDelDia]);

  function datosLocal(v: VentaLocal, ctx: Contexto): DatosTicket {
    return { emisor: ctx.emisor, ambiente: ctx.ambiente, tipo: v.tipo, serie: v.serie, numero: v.numero, fecha: v.fecha, cliente: v.cliente, lineas: v.lineas, total: v.total, metodo_pago: v.metodo_pago, sin_conexion: v.sin_conexion };
  }

  async function traerLocal(v: VentaLocal) {
    const ctx = await leer<Contexto>("contexto");
    return ctx ? datosLocal(v, ctx) : null;
  }

  async function imprimirLocal(v: VentaLocal) {
    const d = await traerLocal(v);
    if (d) imprimir(d, true);
  }

  async function borrarAvisos() {
    await guardar("avisos", []);
    setAvisos([]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Venta del día</h1>
          <p className="text-sm text-gray-600">{esHoy ? "Hoy" : dia.split("-").reverse().join("/")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="dia" className="text-sm font-semibold">
            Día
          </label>
          <input id="dia" type="date" value={dia} max={hoyLima()} onChange={(e) => setDia(e.target.value || hoyLima())} className="h-10 rounded-lg px-2" />
          {!esHoy && (
            <button type="button" onClick={() => setDia(hoyLima())} className="h-10 rounded-lg border bg-white px-3 text-sm font-bold">
              Hoy
            </button>
          )}
          <button type="button" onClick={() => window.dispatchEvent(new Event("mitayo:sincronizar"))} className="h-10 rounded-lg bg-[#b8336a] px-3 text-sm font-bold text-white">
            Sincronizar
          </button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border-2 border-[#b8336a] bg-[#f8d3e0] p-4">
          <p className="text-sm font-semibold text-[#5c1a37]">Total vendido</p>
          <p className="text-3xl font-extrabold text-[#5c1a37]">S/ {d2(resumen.total)}</p>
          <p className="text-sm text-[#6e1f42]">
            {resumen.cantidad} ventas{resumen.anuladas > 0 && ` · ${resumen.anuladas} anulada${resumen.anuladas > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4">
          <p className="text-sm text-gray-600">Por medio de pago</p>
          {resumen.porMetodo.length === 0 ? (
            <p className="text-sm">—</p>
          ) : (
            resumen.porMetodo.map(([m, t]) => (
              <p key={m} className="flex justify-between text-sm">
                <span>{nombreMetodo(m)}</span>
                <b>S/ {d2(t)}</b>
              </p>
            ))
          )}
        </div>
        <div className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4">
          <p className="text-sm text-gray-600">Boletas</p>
          <p className="text-xl font-extrabold text-[#5c1a37]">S/ {d2(resumen.boletas)}</p>
          <p className="mt-1 text-sm text-gray-600">Facturas</p>
          <p className="text-xl font-extrabold text-[#5c1a37]">S/ {d2(resumen.facturas)}</p>
        </div>
        <div className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4">
          <p className="text-sm text-gray-600">Efectivo en caja (ventas)</p>
          <p className="text-xl font-extrabold text-[#5c1a37]">S/ {d2(resumen.porMetodo.find(([m]) => m === "EFECTIVO")?.[1] ?? 0)}</p>
          <p className="mt-1 text-xs text-gray-500">Las anuladas no suman.</p>
        </div>
      </section>

      {avisos.length > 0 && (
        <div className="space-y-1 rounded-xl border-2 border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          {avisos.map((a) => (
            <p key={`${a.uid}-${a.creado}`}>⚠ {a.texto}</p>
          ))}
          <button type="button" onClick={borrarAvisos} className="text-xs font-semibold underline">
            Entendido, borrar avisos
          </button>
        </div>
      )}

      {error && <p className="rounded-xl bg-[#fbe0ea] px-4 py-3 text-sm text-[#6e1f42]">{error}</p>}

      {localesDelDia.length > 0 && (
        <section className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-3 shadow-sm">
          <h2 className="px-1 pb-2 font-bold">Guardadas en este equipo (se suben solas)</h2>
          <ul className="divide-y divide-[#f6d5e1]">
            {localesDelDia.map((v) => (
              <li key={v.uid} className="flex flex-wrap items-center justify-between gap-2 px-1 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {numeroCompleto(v.serie, v.numero)} <EstadoSunat estado="LOCAL" />
                  </p>
                  <p className="truncate text-xs text-gray-600">
                    {fechaHoraLima(v.fecha).hora.slice(0, 5)} · {v.cliente.nombre} · {nombreMetodo(v.metodo_pago)}
                  </p>
                  {v.error && <p className="text-xs text-red-700">{v.error}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <b>S/ {d2(v.total)}</b>
                  <button type="button" onClick={() => imprimirLocal(v)} className="h-9 rounded-lg border bg-white px-2 text-xs font-bold">
                    🖨
                  </button>
                  <BotonWhatsapp traer={() => traerLocal(v)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cargando && <p className="py-6 text-center text-sm text-gray-500">Cargando…</p>}
      {!cargando && filas.length === 0 && localesDelDia.length === 0 && (
        <p className="rounded-2xl border-2 border-[#f0bfd1] bg-white py-10 text-center text-sm text-gray-500">No hay ventas este día.</p>
      )}
      <TablaComprobantes filas={filas} alCambiar={() => void cargar()} />
    </div>
  );
}
