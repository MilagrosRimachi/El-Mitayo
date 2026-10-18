"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { d2 } from "@/lib/ticket";
import { hoyLima, rangoDias, SELECT_VENTAS, type FilaNube } from "@/lib/ventasNube";
import TablaComprobantes from "../_components/TablaComprobantes";

function haceDias(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
}

type Filtro = { desde: string; hasta: string; texto: string; tipo: "" | "03" | "01"; estado: "" | "CONFIRMADA" | "ANULADA" };

export default function Comprobantes() {
  const [f, setF] = useState<Filtro>({ desde: haceDias(6), hasta: hoyLima(), texto: "", tipo: "", estado: "" });
  const [aplicado, setAplicado] = useState<Filtro>(f);
  const [filas, setFilas] = useState<FilaNube[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const [desde, hasta] = rangoDias(aplicado.desde <= aplicado.hasta ? aplicado.desde : aplicado.hasta, aplicado.desde <= aplicado.hasta ? aplicado.hasta : aplicado.desde);
    let q = createClient().from("ventas").select(SELECT_VENTAS).gte("fecha", desde).lte("fecha", hasta);
    if (aplicado.tipo) q = q.eq("tipo", aplicado.tipo);
    if (aplicado.estado) q = q.eq("estado", aplicado.estado);
    const t = aplicado.texto.trim().replace(/[%,()*]/g, " ").trim();
    if (t) q = /^\d+$/.test(t) ? q.like("cliente_numero", `%${t}%`) : q.ilike("cliente_nombre", `%${t.replace(/\s+/g, "%")}%`);
    const { data, error: e } = await q.order("fecha", { ascending: false }).limit(500);
    if (e) setError(`No se pudo buscar (¿hay internet?): ${e.message}`);
    else setFilas((data ?? []) as FilaNube[]);
    setCargando(false);
  }, [aplicado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setAplicado({ ...f });
  }

  function rapido(dias: number) {
    const nuevo = { ...f, desde: haceDias(dias), hasta: hoyLima() };
    setF(nuevo);
    setAplicado(nuevo);
  }

  const vigentes = filas.filter((x) => x.estado !== "ANULADA");
  const total = vigentes.reduce((s, x) => s + Number(x.total), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Comprobantes</h1>
        <p className="text-sm text-gray-600">Busca por fecha o por cliente. Desde aquí puedes imprimir, enviar por WhatsApp o anular.</p>
      </div>

      <form onSubmit={buscar} className="space-y-3 rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Desde</span>
            <input type="date" value={f.desde} max={hoyLima()} onChange={(e) => setF({ ...f, desde: e.target.value })} className="h-10 w-full rounded-lg px-2" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Hasta</span>
            <input type="date" value={f.hasta} max={hoyLima()} onChange={(e) => setF({ ...f, hasta: e.target.value })} className="h-10 w-full rounded-lg px-2" />
          </label>
          <label className="block space-y-1 sm:col-span-2 lg:col-span-1">
            <span className="text-sm font-semibold">Cliente</span>
            <input value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} placeholder="Nombre, DNI o RUC" className="h-10 w-full rounded-lg px-3" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Tipo</span>
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Filtro["tipo"] })} className="h-10 w-full rounded-lg px-2">
              <option value="">Todos</option>
              <option value="03">Boletas</option>
              <option value="01">Facturas</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Estado</span>
            <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value as Filtro["estado"] })} className="h-10 w-full rounded-lg px-2">
              <option value="">Todos</option>
              <option value="CONFIRMADA">Vigentes</option>
              <option value="ANULADA">Anulados</option>
            </select>
          </label>
          <button type="submit" className="h-10 rounded-lg bg-[#b8336a] px-5 text-sm font-bold text-white">
            Buscar
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="self-center text-gray-500">Rápido:</span>
          {[
            [0, "Hoy"],
            [6, "7 días"],
            [29, "30 días"],
          ].map(([d, t]) => (
            <button key={t} type="button" onClick={() => rapido(Number(d))} className="h-8 rounded-full border bg-white px-3 font-bold">
              {t}
            </button>
          ))}
        </div>
      </form>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <p className="text-sm text-gray-700">
        {cargando ? (
          "Buscando…"
        ) : (
          <>
            <b>{filas.length}</b> comprobante{filas.length === 1 ? "" : "s"}
            {filas.length >= 500 && " (se muestran los 500 más recientes)"} · vigentes: <b>S/ {d2(total)}</b>
          </>
        )}
      </p>

      {!cargando && filas.length === 0 && !error && (
        <p className="rounded-2xl border-2 border-[#f0bfd1] bg-white py-10 text-center text-sm text-gray-500">No hay comprobantes con esos datos.</p>
      )}

      <TablaComprobantes filas={filas} alCambiar={() => void cargar()} mostrarFecha />
    </div>
  );
}
