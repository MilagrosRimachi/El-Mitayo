/* ============================================================
   COMPROBANTE EN PDF PARA ENVIAR POR WHATSAPP
   Se arma en el mismo celular (con o sin internet), con el mismo
   contenido del ticket de 80 mm, y se comparte con el botón
   «Compartir» del celular: el cliente lo recibe como archivo PDF.
   ============================================================ */

import { montoEnLetras } from "./sunat/xml";
import { conUnidad, d2, fechaHoraLima, impuestos, nombreMetodo, numeroCompleto, textoQr, type DatosTicket } from "./ticket";

type Doc = {
  setFont: (f: string, s: string) => void;
  setFontSize: (n: number) => void;
  text: (t: string | string[], x: number, y: number, o?: { align?: string }) => void;
  splitTextToSize: (t: string, w: number) => string[];
  setLineDashPattern: (p: number[], f: number) => void;
  line: (a: number, b: number, c: number, d: number) => void;
  addImage: (img: string, tipo: string, x: number, y: number, w: number, h: number) => void;
  output: (t: "blob") => Blob;
};
type JsPdf = new (o?: Record<string, unknown>) => Doc;

const ANCHO = 80;
const M = 5; // margen
const UTIL = ANCHO - 2 * M;
const DOC: Record<string, string> = { "0": "", "1": "DNI", "4": "C.E.", "6": "RUC" };

function cantidadTexto(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function nombreArchivo(d: DatosTicket): string {
  return `${d.tipo === "01" ? "Factura" : "Boleta"}-${d.serie}-${d.numero}.pdf`;
}

export function textoMensaje(d: DatosTicket): string {
  const negocio = d.emisor.nombre_comercial || d.emisor.razon_social;
  return `${negocio}: te enviamos tu ${d.tipo === "01" ? "factura" : "boleta"} ${numeroCompleto(d.serie, d.numero)} por S/ ${d2(d.total)}. ¡Gracias por tu compra!`;
}

export async function comprobantePdf(d: DatosTicket): Promise<File> {
  const { jsPDF } = (await import("jspdf")) as unknown as { jsPDF: JsPdf };

  let qr = "";
  try {
    const QRCode = (await import("qrcode")).default;
    qr = await QRCode.toDataURL(textoQr(d), { margin: 1, width: 300, errorCorrectionLevel: "M" });
  } catch {
    qr = "";
  }

  const { fecha, hora } = fechaHoraLima(d.fecha);
  const imp = impuestos(d.total, d.emisor.afectacion);

  /* Se dibuja dos veces: la primera solo mide el alto del papel */
  function dibujar(doc: Doc | null, medidor: Doc): number {
    let y = 7;
    const t = (texto: string, o: { tam?: number; negrita?: boolean; centro?: boolean; derecha?: string } = {}) => {
      const tam = o.tam ?? 8.5;
      medidor.setFont("helvetica", o.negrita ? "bold" : "normal");
      medidor.setFontSize(tam);
      const lineas = o.derecha ? [texto] : medidor.splitTextToSize(texto, UTIL);
      const alto = tam * 0.42;
      if (doc) {
        doc.setFont("helvetica", o.negrita ? "bold" : "normal");
        doc.setFontSize(tam);
        lineas.forEach((l, i) => doc.text(l, o.centro ? ANCHO / 2 : M, y + i * alto, o.centro ? { align: "center" } : undefined));
        if (o.derecha) doc.text(o.derecha, ANCHO - M, y, { align: "right" });
      }
      y += alto * lineas.length + 0.6;
    };
    const raya = () => {
      y += 0.8;
      if (doc) {
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, y, ANCHO - M, y);
      }
      y += 3.6;
    };

    t(d.emisor.nombre_comercial || d.emisor.razon_social, { tam: 12, negrita: true, centro: true });
    if (d.emisor.razon_social && d.emisor.razon_social !== d.emisor.nombre_comercial) t(d.emisor.razon_social, { centro: true });
    if (d.emisor.ruc) t(`RUC ${d.emisor.ruc}`, { centro: true });
    if (d.emisor.direccion) t(d.emisor.direccion, { centro: true });
    if (d.emisor.lugar) t(d.emisor.lugar, { centro: true });
    if (d.emisor.telefono) t(`Tel. ${d.emisor.telefono}`, { centro: true });
    y += 1.5;
    t(d.tipo === "01" ? "FACTURA ELECTRÓNICA" : "BOLETA DE VENTA ELECTRÓNICA", { negrita: true, centro: true, tam: 9.5 });
    t(numeroCompleto(d.serie, d.numero), { negrita: true, centro: true, tam: 9.5 });
    if (d.ambiente === "BETA") t("*** PRUEBA - SIN VALOR ***", { negrita: true, centro: true });
    raya();
    t(`Fecha: ${fecha} ${hora}`);
    t(`Cliente: ${d.cliente.nombre || "CLIENTES VARIOS"}`);
    if (DOC[d.cliente.tipo_doc]) t(`${DOC[d.cliente.tipo_doc]}: ${d.cliente.numero}`);
    if (d.tipo === "01" && d.cliente.direccion) t(`Dirección: ${d.cliente.direccion}`);
    raya();
    for (const l of d.lineas) {
      t(l.descripcion);
      t(`${cantidadTexto(l.cantidad)}${conUnidad(l.unidad)} x ${d2(l.precio)}`, { negrita: true, derecha: d2(l.importe) });
    }
    raya();
    t(imp.gravado ? "Op. gravada" : "Op. exonerada", { derecha: `S/ ${d2(imp.base)}` });
    t("IGV", { derecha: `S/ ${d2(imp.igv)}` });
    t("TOTAL", { tam: 11, negrita: true, derecha: `S/ ${d2(d.total)}` });
    t(`SON: ${montoEnLetras(d.total)}`);
    t(`Pago: ${nombreMetodo(d.metodo_pago)}`);
    if (!imp.gravado && d.emisor.leyenda_amazonia) {
      y += 1;
      t("BIENES TRANSFERIDOS EN LA AMAZONÍA REGIÓN SELVA PARA SER CONSUMIDOS EN LA MISMA", { centro: true, tam: 7.5 });
    }
    if (qr) {
      y += 1;
      if (doc) doc.addImage(qr, "PNG", (ANCHO - 30) / 2, y, 30, 30);
      y += 34;
    }
    t(`Representación impresa de la ${d.tipo === "01" ? "Factura" : "Boleta de Venta"} Electrónica.`, { centro: true, tam: 7.5 });
    if (d.sin_conexion) t("Emitido sin internet: se envía a SUNAT al volver la conexión.", { centro: true, tam: 7.5 });
    t("¡Gracias por su compra!", { negrita: true, centro: true });
    return y + 4;
  }

  const medidor = new jsPDF({ unit: "mm", format: [ANCHO, 200] });
  const alto = Math.max(90, dibujar(null, medidor));
  const doc = new jsPDF({ unit: "mm", format: [ANCHO, alto] });
  dibujar(doc, doc);

  return new File([doc.output("blob")], nombreArchivo(d), { type: "application/pdf" });
}

/* Abre «Compartir» del celular con el PDF (WhatsApp, etc.).
   Devuelve "REPETIR" si el celular pide tocar el botón otra vez. */
export async function compartirPdf(archivo: File, texto: string, sinCompartir = false): Promise<"OK" | "CANCELADO" | "REPETIR" | "DESCARGADO"> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (!sinCompartir && nav.canShare && nav.canShare({ files: [archivo] })) {
    try {
      await nav.share({ files: [archivo], text: texto });
      return "OK";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "CANCELADO";
      if (e instanceof DOMException && e.name === "NotAllowedError") return "REPETIR";
      throw e;
    }
  }

  /* Computadora: se descarga el PDF y se abre WhatsApp Web para adjuntarlo */
  const url = URL.createObjectURL(archivo);
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  window.open(`https://wa.me/?text=${encodeURIComponent(texto + " (adjunto el PDF)")}`, "_blank", "noopener");
  return "DESCARGADO";
}
