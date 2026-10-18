"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { leer, type Contexto } from "@/lib/local";
import { d2, numeroCompleto } from "@/lib/ticket";
import { cargarRegistro, filasExcel, nombreMes, nombreTipo, pdfRegistro, resumir, type FilaRegistro } from "@/lib/registroVentas";
import { IconoWhatsapp } from "../_components/BotonWhatsapp";
import { marcarEnviado } from "@/lib/avisoContadora";

function mesActual(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()).slice(0, 7);
}

export default function Reporte() {
  const [mes, setMes] = useState(mesActual());

  // El aviso de fin de mes abre esta pantalla con ?mes=AAAA-MM
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("mes");
    if (m && /^\d{4}-\d{2}$/.test(m) && m <= mesActual()) setMes(m);
  }, []);
  const [filas, setFilas] = useState<FilaRegistro[]>([]);
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  // Este navegador no deja «Compartir» archivos (por ejemplo Brave en Windows)
  const [sinCompartir, setSinCompartir] = useState(false);
  const fallosCompartir = useRef(0);
  const pdfListo = useRef<{ clave: string; archivo: File } | null>(null);
  const excelListo = useRef<{ clave: string; archivo: File } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    pdfListo.current = null;
    excelListo.current = null;
    const c = await leer<Contexto>("contexto").catch(() => null);
    setCtx(c);
    try {
      setFilas(await cargarRegistro(createClient(), mes, c?.ambiente ?? "PRODUCCION", c?.emisor.afectacion ?? "20"));
    } catch (e) {
      setFilas([]);
      setError(`No se pudo cargar (¿hay internet?): ${e instanceof Error ? e.message : ""}`);
    }
    setCargando(false);
  }, [mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const r = useMemo(() => resumir(filas), [filas]);
  const ambiente = ctx?.ambiente ?? "PRODUCCION";
  const negocio = ctx?.emisor.nombre_comercial || ctx?.emisor.razon_social || 'Multiservicio "El Mitayo"';
  const nombreArchivo = `Registro-ventas-${mes}-El-Mitayo`;
  const clave = `${mes}-${filas.length}-${r.neto}`;

  async function archivoPdf(): Promise<File> {
    if (pdfListo.current?.clave === clave) return pdfListo.current.archivo;
    const datos = await pdfRegistro(filas, r, ctx?.emisor ?? null, mes, ambiente);
    const archivo = new File([datos], `${nombreArchivo}.pdf`, { type: "application/pdf" });
    pdfListo.current = { clave, archivo };
    return archivo;
  }

  async function archivoExcel(): Promise<File> {
    if (excelListo.current?.clave === clave) return excelListo.current.archivo;
    const XLSX = await import("xlsx");
    const hoja = XLSX.utils.aoa_to_sheet(filasExcel(filas, r));
    hoja["!cols"] = [12, 16, 8, 7, 10, 8, 13, 40, 12, 12, 10, 12, 14, 12, 28].map((w) => ({ wch: w }));
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, `Ventas ${mes}`);
    const datos = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const archivo = new File([datos], `${nombreArchivo}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    excelListo.current = { clave, archivo };
    return archivo;
  }

  /* Respaldo para celulares que no dejan compartir .xlsx: CSV que Excel abre
     directo (UTF-16 con tabulaciones: respeta tildes y columnas) */
  function archivoCsv(): File {
    const texto = filasExcel(filas, r)
      .map((fila) => fila.map((v) => String(v ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"))
      .join("\r\n");
    const bytes = new Uint8Array(2 + texto.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < texto.length; i++) {
      const c = texto.charCodeAt(i);
      bytes[2 + i * 2] = c & 0xff;
      bytes[3 + i * 2] = c >> 8;
    }
    return new File([bytes], `${nombreArchivo}.csv`, { type: "text/csv" });
  }

  /* Se arma por adelantado: así al tocar «Enviar» se abre WhatsApp al toque */
  useEffect(() => {
    if (!cargando && filas.length) {
      void archivoPdf().catch(() => undefined);
      void archivoExcel().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, clave]);

  function descargar(b: Blob, nombre: string) {
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function enviarWhatsapp() {
    setTrabajando("wa");
    setError(null);
    try {
      const [pdf, excel] = await Promise.all([archivoPdf(), archivoExcel()]);
      const texto = `Hola, te envío el registro de ventas de ${nombreMes(mes)} de ${negocio} en PDF y Excel. Total neto: S/ ${d2(r.neto)}.`;
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      const puede = (files: File[]) => !!nav.canShare && nav.canShare({ files });

      // Lo mejor que acepte este equipo: PDF + Excel; si no, PDF + CSV
      const juntos = puede([pdf, excel]) ? [pdf, excel] : puede([pdf, archivoCsv()]) ? [pdf, archivoCsv()] : null;

      if (juntos) {
        await nav.share({ files: juntos, title: `Ventas ${nombreMes(mes)}`, text: texto });
        marcarEnviado(mes);
      } else {
        setSinCompartir(true);
        abrirChatConArchivos(pdf, excel);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        // 1ª vez puede ser que el archivo tardó en armarse; 2ª vez: el navegador lo bloquea
        fallosCompartir.current++;
        if (fallosCompartir.current >= 2) setSinCompartir(true);
        else setError("Vuelve a tocar «Enviar ventas a contadora».");
      }
      else if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "No se pudo armar el reporte.");
    } finally {
      setTrabajando(null);
    }
  }

  /* Sin «Compartir»: descarga PDF y Excel y abre el chat de la contadora (se adjuntan con 📎) */
  function abrirChatConArchivos(pdf?: File, excel?: File) {
    const p = pdf ?? pdfListo.current?.archivo;
    const x = excel ?? excelListo.current?.archivo;
    const numero = (ctx?.whatsapp ?? "").replace(/\D/g, "");
    const texto = `Hola, te envío el registro de ventas de ${nombreMes(mes)} de ${negocio} en PDF y Excel. Total neto: S/ ${d2(r.neto)}.`;
    window.open(`https://wa.me/${numero ? `51${numero.slice(-9)}` : ""}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    if (p) descargar(p, p.name);
    if (x) setTimeout(() => descargar(x, x.name), 400);
    marcarEnviado(mes);
  }

  async function descargarPdf() {
    setTrabajando("pdf");
    setError(null);
    try {
      const a = await archivoPdf();
      descargar(a, a.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar el PDF.");
    } finally {
      setTrabajando(null);
    }
  }

  async function descargarExcel() {
    const a = await archivoExcel();
    descargar(a, a.name);
  }

  const vacio = !cargando && filas.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Reporte del mes</h1>
          <p className="text-sm text-gray-600">Registro de ventas para la contadora</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="mes" className="text-sm font-semibold">
            Mes
          </label>
          <input id="mes" type="month" value={mes} max={mesActual()} onChange={(e) => setMes(e.target.value || mesActual())} className="h-10 rounded-lg px-2" />
        </div>
      </div>

      {ambiente === "BETA" && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900">Estás en modo pruebas: el reporte muestra los comprobantes de prueba.</p>
      )}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border-2 border-[#b8336a] bg-[#f8d3e0] p-4">
          <p className="text-sm font-semibold text-[#5c1a37]">Total neto de {nombreMes(mes)}</p>
          <p className="text-3xl font-extrabold text-[#5c1a37]">S/ {d2(r.neto)}</p>
          <p className="text-xs text-[#6e1f42]">Boletas + facturas − notas de crédito</p>
        </div>
        <div className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4">
          <p className="flex justify-between text-sm">
            <span>Boletas ({r.cantidad.boletas})</span>
            <b>S/ {d2(r.boletas)}</b>
          </p>
          <p className="flex justify-between text-sm">
            <span>Facturas ({r.cantidad.facturas})</span>
            <b>S/ {d2(r.facturas)}</b>
          </p>
          <p className="flex justify-between text-sm text-red-700">
            <span>Notas de crédito ({r.cantidad.notas})</span>
            <b>S/ {d2(r.notas)}</b>
          </p>
        </div>
        <div className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4">
          <p className="text-sm text-gray-600">Cobrado por medio de pago</p>
          {r.porMetodo.length === 0 ? (
            <p className="text-sm">—</p>
          ) : (
            r.porMetodo.map(([m, t]) => (
              <p key={m} className="flex justify-between text-sm">
                <span>{m}</span>
                <b>S/ {d2(t)}</b>
              </p>
            ))
          )}
        </div>
        <div className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 text-sm">
          <p className="text-gray-600">IGV</p>
          <p>
            {r.igv === 0 ? `Exonerado: S/ ${d2(r.exonerada)}` : `Gravado: S/ ${d2(r.gravada)} · IGV S/ ${d2(r.igv)}`}
          </p>
          {r.pendientes > 0 && <p className="mt-1 text-xs text-orange-700">⏳ {r.pendientes} aún sin respuesta de SUNAT</p>}
          {r.rechazados > 0 && <p className="mt-1 text-xs text-red-700">✖ {r.rechazados} rechazado(s): no suman</p>}
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm">
        <button
          type="button"
          disabled={cargando || !!trabajando || vacio}
          onClick={enviarWhatsapp}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#25a244] text-lg font-extrabold text-white disabled:opacity-50"
        >
          <IconoWhatsapp className="h-6 w-6" />
          {trabajando === "wa" ? "Preparando PDF y Excel…" : "Enviar ventas a contadora"}
        </button>
        {sinCompartir && (
          <div className="space-y-2 rounded-xl border-2 border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
            <p>
              <b>Este navegador no deja adjuntar archivos solo</b> (pasa con Brave). Para que sea con un toque, abre la plataforma en <b>Google Chrome</b> o{" "}
              <b>Microsoft Edge</b>.
            </p>
            <p>Por ahora: toca el botón de abajo, se abre el chat de la contadora y se descargan el PDF y el Excel; arrástralos al chat o adjúntalos con 📎.</p>
            <button
              type="button"
              onClick={() => abrirChatConArchivos()}
              className="h-11 w-full rounded-xl border-2 border-[#1d6b34] bg-white font-bold text-[#14532d]"
            >
              Abrir WhatsApp de la contadora y descargar los archivos
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={cargando || !!trabajando || vacio} onClick={descargarPdf} className="h-11 rounded-xl border bg-white font-bold disabled:opacity-50">
            {trabajando === "pdf" ? "Armando…" : "Descargar PDF"}
          </button>
          <button type="button" disabled={cargando || vacio} onClick={descargarExcel} className="h-11 rounded-xl border bg-white font-bold disabled:opacity-50">
            Descargar Excel
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Se abre «Compartir» con el PDF y el Excel juntos → WhatsApp → elige a tu contadora → enviar. Llevan todos los comprobantes del mes, las anuladas y sus notas de crédito.
        </p>
      </section>

      <section className="rounded-2xl border-2 border-[#f0bfd1] bg-white shadow-sm">
        <h2 className="border-b-2 border-[#f0bfd1] px-4 py-3 font-extrabold">Comprobantes de {nombreMes(mes)}</h2>
        {cargando ? (
          <p className="p-6 text-center text-sm text-gray-500">Cargando…</p>
        ) : vacio ? (
          <p className="p-6 text-center text-sm text-gray-500">No hay comprobantes en {nombreMes(mes)}.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="sticky top-0">
                <tr className="text-left text-xs uppercase">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Comprobante</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f6d5e1]">
                {filas.map((f) => (
                  <tr key={`${f.serie}-${f.numero}`} className={!f.vigente ? "text-red-800" : ""}>
                    <td className="whitespace-nowrap px-3 py-1.5">{f.fecha}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <b>{numeroCompleto(f.serie, f.numero)}</b> <span className="text-xs text-gray-500">{nombreTipo(f.tipo)}</span>
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5">{f.cliente}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-bold">{d2(f.total)}</td>
                    <td className="px-3 py-1.5 text-xs">{f.observacion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
