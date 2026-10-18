"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { consultarSunat, enviarSunat } from "../acciones";
import { d2, fechaHoraLima, imprimir, nombreMetodo, numeroCompleto } from "@/lib/ticket";
import { datosNube, notaDeCredito, original, type FilaNube } from "@/lib/ventasNube";
import EnviarWhatsapp from "./EnviarWhatsapp";
import { IconoWhatsapp } from "./BotonWhatsapp";

export function EstadoSunat({ estado }: { estado: string }) {
  if (estado === "ACEPTADO" || estado === "OBSERVADO") return <span className="whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs font-bold text-green-700">✔ SUNAT</span>;
  if (estado === "RECHAZADO") return <span className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">✖ Rechazado</span>;
  if (estado === "LOCAL") return <span className="whitespace-nowrap rounded-full bg-[#fbe0ea] px-2 py-0.5 text-xs font-bold text-[#6e1f42]">📴 En este equipo</span>;
  return <span className="whitespace-nowrap rounded-full bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-700">⏳ Pendiente</span>;
}

const MOTIVOS = ["Error en el precio", "Error en los productos", "Error en los datos del cliente", "El cliente devolvió los productos", "Venta duplicada"];

type Props = {
  filas: FilaNube[];
  alCambiar: () => void;
  mostrarFecha?: boolean;
};

export default function TablaComprobantes({ filas, alCambiar, mostrarFecha }: Props) {
  const [abierta, setAbierta] = useState<{ id: number; que: "WHATSAPP" | "ANULAR" } | null>(null);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  function abrir(id: number, que: "WHATSAPP" | "ANULAR") {
    setMensaje(null);
    setAbierta((a) => (a && a.id === id && a.que === que ? null : { id, que }));
  }

  async function imprimirFila(v: FilaNube) {
    try {
      const d = await datosNube(v);
      if (d) imprimir(d, true);
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof Error ? e.message : "No se pudo imprimir." });
    }
  }

  async function anular(v: FilaNube) {
    const c = original(v);
    if (!c) return;
    if (!window.confirm(`¿Anular ${numeroCompleto(c.serie, c.numero)} por S/ ${d2(Number(v.total))}?\n\nSe emite una nota de crédito y se envía a SUNAT. No se puede deshacer.`)) return;
    setOcupado(v.id);
    const { data, error } = await createClient().rpc("app_venta_anular", { p_venta_id: v.id, p_motivo: motivo });
    setOcupado(null);
    if (error) return setMensaje({ ok: false, texto: error.message });
    const nota = (data as { nota: { serie: string; numero: number } | null }).nota;
    setMensaje({
      ok: true,
      texto: nota
        ? `✔ Anulada. Nota de crédito ${numeroCompleto(nota.serie, nota.numero)}: se envía sola a SUNAT${c.estado === "ACEPTADO" || c.estado === "OBSERVADO" ? "" : " cuando SUNAT acepte el comprobante"}.`
        : "✔ Anulada (SUNAT la había rechazado, no necesita nota de crédito).",
    });
    setAbierta(null);
    alCambiar();
    window.dispatchEvent(new Event("mitayo:sincronizar"));
  }

  async function sunat(id: number, consultar: boolean) {
    setOcupado(id);
    const r = await (consultar ? consultarSunat(id) : enviarSunat(id)).catch(() => null);
    setOcupado(null);
    setMensaje(r ? { ok: r.ok, texto: r.ok ? r.mensaje ?? r.estado ?? "Listo." : r.error ?? "No se pudo." } : { ok: false, texto: "No hay conexión." });
    alCambiar();
  }

  if (filas.length === 0) return null;

  return (
    <div className="space-y-2">
      {mensaje && (
        <p className={`rounded-xl px-4 py-3 text-sm ${mensaje.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{mensaje.texto}</p>
      )}
      <div className="overflow-x-auto rounded-2xl border-2 border-[#f0bfd1] bg-white shadow-sm">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide">
              <th className="px-3 py-2">{mostrarFecha ? "Fecha" : "Hora"}</th>
              <th className="px-3 py-2">Comprobante</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Pago</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">SUNAT</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f6d5e1]">
            {filas.map((v) => {
              const c = original(v);
              const nc = notaDeCredito(v);
              const anulada = v.estado === "ANULADA";
              const pendiente = c && !["ACEPTADO", "OBSERVADO", "RECHAZADO"].includes(c.estado);
              const { fecha, hora } = fechaHoraLima(v.fecha);
              const esta = abierta?.id === v.id ? abierta.que : null;
              return [
                <tr key={v.id} className={anulada ? "bg-gray-50 text-gray-500" : ""}>
                  <td className="whitespace-nowrap px-3 py-2">{mostrarFecha ? `${fecha} ${hora.slice(0, 5)}` : hora.slice(0, 5)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <b className={anulada ? "line-through" : ""}>{c ? numeroCompleto(c.serie, c.numero) : `Venta #${v.id}`}</b>
                    <span className="block text-xs text-gray-500">{v.tipo === "01" ? "Factura" : "Boleta"}</span>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2">
                    <span className="block truncate font-semibold">{v.cliente_nombre}</span>
                    {v.cliente_tipo_doc !== "0" && <span className="text-xs text-gray-500">{v.cliente_tipo_doc === "6" ? "RUC" : "DNI"} {v.cliente_numero}</span>}
                  </td>
                  <td className="px-3 py-2">{nombreMetodo(v.metodo_pago)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right font-extrabold ${anulada ? "line-through" : "text-[#5c1a37]"}`}>S/ {d2(Number(v.total))}</td>
                  <td className="px-3 py-2">
                    {c && <EstadoSunat estado={c.estado} />}
                    {anulada && (
                      <span className="mt-1 block whitespace-nowrap text-xs font-bold text-red-700">
                        ANULADA{nc ? ` · NC ${numeroCompleto(nc.serie, nc.numero)}` : ""}
                        {nc && !["ACEPTADO", "OBSERVADO"].includes(nc.estado) && " ⏳"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => imprimirFila(v)} className="h-9 rounded-lg border bg-white px-2 text-xs font-bold" title="Imprimir">
                        🖨
                      </button>
                      {!anulada && (
                        <button
                          type="button"
                          onClick={() => abrir(v.id, "WHATSAPP")}
                          className={`flex h-9 items-center rounded-lg px-2 text-white ${esta === "WHATSAPP" ? "bg-[#1d6b34]" : "bg-[#25a244]"}`}
                          title="Enviar por WhatsApp"
                          aria-label="Enviar por WhatsApp"
                        >
                          <IconoWhatsapp />
                        </button>
                      )}
                      {!anulada && (
                        <button type="button" onClick={() => abrir(v.id, "ANULAR")} className="h-9 rounded-lg border bg-white px-2 text-xs font-bold text-red-700">
                          Anular
                        </button>
                      )}
                    </div>
                  </td>
                </tr>,
                esta || (pendiente && !anulada) ? (
                  <tr key={`${v.id}-extra`} className="bg-[#fff7fa]">
                    <td colSpan={7} className="px-3 py-2">
                      {pendiente && !anulada && !esta && c && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {c.mensaje && <span className="text-gray-600">{c.mensaje}</span>}
                          <button type="button" disabled={ocupado === c.id} onClick={() => sunat(c.id, false)} className="h-8 rounded-lg bg-[#b8336a] px-3 font-bold text-white disabled:opacity-50">
                            {ocupado === c.id ? "Enviando…" : "Enviar a SUNAT"}
                          </button>
                          <button type="button" disabled={ocupado === c.id} onClick={() => sunat(c.id, true)} className="h-8 rounded-lg border bg-white px-3 font-bold disabled:opacity-50">
                            Consultar en SUNAT
                          </button>
                        </div>
                      )}
                      {esta === "WHATSAPP" && <EnviarWhatsapp traer={() => datosNube(v)} alError={(t) => setMensaje({ ok: false, texto: t })} />}
                      {esta === "ANULAR" && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 p-3">
                          <label htmlFor={`mot-${v.id}`} className="text-sm font-bold text-red-800">
                            Motivo
                          </label>
                          <select id={`mot-${v.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-10 rounded-lg px-2">
                            {MOTIVOS.map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                          <button type="button" disabled={ocupado === v.id} onClick={() => anular(v)} className="h-10 rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50">
                            {ocupado === v.id ? "Anulando…" : "Anular comprobante"}
                          </button>
                          <button type="button" onClick={() => setAbierta(null)} className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold">
                            Cancelar
                          </button>
                          <p className="w-full text-xs text-red-800">SUNAT no permite borrar comprobantes: se emite una nota de crédito que lo anula y la venta deja de sumar.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
