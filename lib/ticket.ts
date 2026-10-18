/* ============================================================
   TICKET DE VENTA (80 mm o 58 mm)
   Se arma en el mismo celular con los datos de la venta, así sale
   al instante, con o sin internet:
   - por Bluetooth con la app RawBT (comandos ESC/POS, sin diálogo)
   - o con la ventana de impresión del navegador (computadora)
   ============================================================ */

import { montoEnLetras } from "./sunat/xml";
import { unidadCorta } from "./unidades";
import { leerImpresion, type Cliente, type Contexto, type Linea } from "./local";

export type DatosTicket = {
  emisor: Contexto["emisor"];
  ambiente: "BETA" | "PRODUCCION";
  tipo: "03" | "01";
  serie: string;
  numero: number;
  fecha: string; // ISO
  cliente: Cliente;
  lineas: Linea[];
  total: number;
  metodo_pago: string;
  sin_conexion?: boolean;
};

const DOC: Record<string, string> = { "0": "", "1": "DNI", "4": "C.E.", "6": "RUC" };

export const METODOS: Array<[string, string]> = [
  ["EFECTIVO", "Efectivo"],
  ["YAPE", "Yape"],
  ["PLIN", "Plin"],
  ["TARJETA", "Tarjeta"],
  ["TRANSFERENCIA", "Transferencia"],
];

export function nombreMetodo(codigo: string): string {
  return METODOS.find(([c]) => c === codigo)?.[1] ?? codigo;
}

export function d2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/* «0.5 kg», «2 m»; las unidades sueltas no llevan nada */
export function conUnidad(u: string | undefined): string {
  return u && u !== "NIU" ? ` ${unidadCorta(u)}` : "";
}

function cantidadTexto(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function numeroCompleto(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(8, "0")}`;
}

export function fechaHoraLima(iso: string): { fecha: string; hora: string; ymd: string } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "00";

  return {
    fecha: `${p("day")}/${p("month")}/${p("year")}`,
    hora: `${p("hour")}:${p("minute")}:${p("second")}`,
    ymd: `${p("year")}-${p("month")}-${p("day")}`,
  };
}

function tituloDoc(tipo: string): string {
  return tipo === "01" ? "FACTURA ELECTRÓNICA" : "BOLETA DE VENTA ELECTRÓNICA";
}

/* Exonerado (Amazonía) o con IGV incluido en el precio */
export function impuestos(total: number, afectacion: string): { base: number; igv: number; gravado: boolean } {
  if (afectacion === "10") {
    const base = Math.round((total / 1.18) * 100) / 100;
    return { base, igv: Math.round((total - base) * 100) / 100, gravado: true };
  }
  return { base: total, igv: 0, gravado: false };
}

export function textoQr(d: DatosTicket): string {
  const { ymd } = fechaHoraLima(d.fecha);
  const { igv } = impuestos(d.total, d.emisor.afectacion);
  return [d.emisor.ruc, d.tipo, d.serie, d.numero, d2(igv), d2(d.total), ymd, d.cliente.tipo_doc, d.cliente.numero, ""].join("|") + "|";
}

/* ---------------- ESC/POS (RawBT) ---------------- */

const CP850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, "°": 0xf8, º: 0xa7, ª: 0xa6, "¿": 0xa8, "¡": 0xad,
};

function bytesDe(texto: string): number[] {
  const salida: number[] = [];
  for (const ch of texto) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c < 127) salida.push(c);
    else if (CP850[ch] !== undefined) salida.push(CP850[ch]);
    else if (ch === "\n") salida.push(10);
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      salida.push(base && base.charCodeAt(0) < 127 ? base.charCodeAt(0) : 63);
    }
  }
  return salida;
}

function partir(texto: string, ancho: number): string[] {
  const palabras = texto.replace(/\s+/g, " ").trim().split(" ");
  const lineas: string[] = [];
  let actual = "";

  for (const p of palabras) {
    if (!actual) actual = p;
    else if ((actual + " " + p).length <= ancho) actual += " " + p;
    else {
      lineas.push(actual);
      actual = p;
    }
    while (actual.length > ancho) {
      lineas.push(actual.slice(0, ancho));
      actual = actual.slice(ancho);
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}

function aLosLados(izq: string, der: string, ancho: number): string {
  const espacio = ancho - izq.length - der.length;
  if (espacio >= 1) return izq + " ".repeat(espacio) + der;
  return izq.slice(0, Math.max(0, ancho - der.length - 1)) + " " + der;
}

export function ticketEscPos(d: DatosTicket, columnas: 48 | 32 = 48): Uint8Array {
  const b: number[] = [];
  const ESC = 0x1b;
  const GS = 0x1d;
  const linea = (t = "") => b.push(...bytesDe(t), 10);
  const centro = () => b.push(ESC, 0x61, 1);
  const izquierda = () => b.push(ESC, 0x61, 0);
  const negrita = (s: boolean) => b.push(ESC, 0x45, s ? 1 : 0);
  const grande = (s: boolean) => b.push(GS, 0x21, s ? 0x11 : 0x00);
  const raya = () => linea("-".repeat(columnas));

  b.push(ESC, 0x40, ESC, 0x74, 2); // reinicio + página de códigos 850 (tildes y ñ)

  centro();
  negrita(true);
  grande(true);
  for (const l of partir(d.emisor.nombre_comercial || d.emisor.razon_social, columnas / 2)) linea(l);
  grande(false);
  negrita(false);
  if (d.emisor.razon_social && d.emisor.razon_social !== d.emisor.nombre_comercial) {
    for (const l of partir(d.emisor.razon_social, columnas)) linea(l);
  }
  if (d.emisor.ruc) linea(`RUC ${d.emisor.ruc}`);
  for (const l of partir(d.emisor.direccion, columnas)) if (l) linea(l);
  if (d.emisor.lugar) for (const l of partir(d.emisor.lugar, columnas)) linea(l);
  if (d.emisor.telefono) linea(`Tel. ${d.emisor.telefono}`);
  linea();
  negrita(true);
  linea(tituloDoc(d.tipo));
  linea(numeroCompleto(d.serie, d.numero));
  negrita(false);
  if (d.ambiente === "BETA") linea("*** PRUEBA - SIN VALOR ***");

  izquierda();
  raya();
  const { fecha, hora } = fechaHoraLima(d.fecha);
  linea(`Fecha: ${fecha} ${hora}`);
  for (const l of partir(`Cliente: ${d.cliente.nombre || "CLIENTES VARIOS"}`, columnas)) linea(l);
  if (DOC[d.cliente.tipo_doc]) linea(`${DOC[d.cliente.tipo_doc]}: ${d.cliente.numero}`);
  if (d.tipo === "01" && d.cliente.direccion) for (const l of partir(`Dirección: ${d.cliente.direccion}`, columnas)) linea(l);
  raya();

  for (const l of d.lineas) {
    for (const t of partir(l.descripcion, columnas)) linea(t);
    negrita(true);
    linea(aLosLados(`  ${cantidadTexto(l.cantidad)}${conUnidad(l.unidad)} x ${d2(l.precio)}`, d2(l.importe), columnas));
    negrita(false);
  }

  raya();
  const imp = impuestos(d.total, d.emisor.afectacion);
  linea(aLosLados(imp.gravado ? "Op. gravada" : "Op. exonerada", `S/ ${d2(imp.base)}`, columnas));
  linea(aLosLados("IGV", `S/ ${d2(imp.igv)}`, columnas));
  negrita(true);
  grande(true);
  linea(aLosLados("TOTAL", `S/ ${d2(d.total)}`, columnas / 2));
  grande(false);
  negrita(false);
  for (const l of partir(`SON: ${montoEnLetras(d.total)}`, columnas)) linea(l);
  linea(`Pago: ${nombreMetodo(d.metodo_pago)} S/ ${d2(d.total)}`);

  if (!imp.gravado && d.emisor.leyenda_amazonia) {
    centro();
    linea();
    for (const l of partir("BIENES TRANSFERIDOS EN LA AMAZONÍA REGIÓN SELVA PARA SER CONSUMIDOS EN LA MISMA", columnas)) linea(l);
  }

  // Código QR (lo dibuja la impresora)
  centro();
  linea();
  const qr = bytesDe(textoQr(d));
  const largo = qr.length + 3;
  b.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00);
  b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, columnas === 48 ? 6 : 5);
  b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);
  b.push(GS, 0x28, 0x6b, largo % 256, Math.floor(largo / 256), 0x31, 0x50, 0x30, ...qr);
  b.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
  linea();

  for (const l of partir(`Representación impresa de la ${d.tipo === "01" ? "Factura" : "Boleta de Venta"} Electrónica.`, columnas)) linea(l);
  if (d.sin_conexion) for (const l of partir("Emitido sin internet: se envía a SUNAT al volver la conexión.", columnas)) linea(l);
  negrita(true);
  linea("¡Gracias por su compra!");
  negrita(false);

  b.push(ESC, 0x64, 4); // avanza el papel
  b.push(GS, 0x56, 0x42, 0x00); // corta (si la impresora tiene cortador)

  return Uint8Array.from(b);
}

function aBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* Manda el ticket a la app RawBT (Android): imprime por Bluetooth sin preguntar */
export function imprimirConRawBT(d: DatosTicket, columnas: 48 | 32) {
  const b64 = aBase64(ticketEscPos(d, columnas));
  window.location.href = `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

/* ---------------- HTML (impresión desde el navegador) ---------------- */

function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function ticketHtml(d: DatosTicket, columnas: 48 | 32 = 48): Promise<string> {
  let qr = "";
  try {
    const QRCode = (await import("qrcode")).default;
    qr = await QRCode.toDataURL(textoQr(d), { margin: 1, width: 220, errorCorrectionLevel: "M" });
  } catch {
    qr = "";
  }

  const { fecha, hora } = fechaHoraLima(d.fecha);
  const imp = impuestos(d.total, d.emisor.afectacion);
  const ancho = columnas === 48 ? "80mm" : "58mm";
  const fila = (a: string, b: string, clase = "") => `<div class="f ${clase}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(numeroCompleto(d.serie, d.numero))}</title>
<style>
@page{size:${ancho} auto;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#000;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace}
.t{width:${ancho};padding:0 ${columnas === 48 ? "6mm 0 7mm" : "3mm 0 3mm"}}
.c{text-align:center}.b{font-weight:700}.g{font-size:17px;font-weight:800}
.r{border-top:1px dashed #000;margin:6px 0}
.f{display:flex;justify-content:space-between;gap:8px}
.tot{font-size:15px;font-weight:800}
img{display:block;margin:6px auto;width:34mm;height:34mm}
p{margin:0}
</style></head><body><div class="t">
<p class="c g">${esc(d.emisor.nombre_comercial || d.emisor.razon_social)}</p>
${d.emisor.razon_social && d.emisor.razon_social !== d.emisor.nombre_comercial ? `<p class="c">${esc(d.emisor.razon_social)}</p>` : ""}
${d.emisor.ruc ? `<p class="c">RUC ${esc(d.emisor.ruc)}</p>` : ""}
<p class="c">${esc(d.emisor.direccion)}</p>
${d.emisor.lugar ? `<p class="c">${esc(d.emisor.lugar)}</p>` : ""}
${d.emisor.telefono ? `<p class="c">Tel. ${esc(d.emisor.telefono)}</p>` : ""}
<p class="c b" style="margin-top:6px">${tituloDoc(d.tipo)}</p>
<p class="c b">${numeroCompleto(d.serie, d.numero)}</p>
${d.ambiente === "BETA" ? `<p class="c b">*** PRUEBA – SIN VALOR ***</p>` : ""}
<div class="r"></div>
<p>Fecha: ${fecha} ${hora}</p>
<p>Cliente: ${esc(d.cliente.nombre || "CLIENTES VARIOS")}</p>
${DOC[d.cliente.tipo_doc] ? `<p>${DOC[d.cliente.tipo_doc]}: ${esc(d.cliente.numero)}</p>` : ""}
${d.tipo === "01" && d.cliente.direccion ? `<p>Dirección: ${esc(d.cliente.direccion)}</p>` : ""}
<div class="r"></div>
${d.lineas.map((l) => `<p>${esc(l.descripcion)}</p>${fila(`${cantidadTexto(l.cantidad)}${conUnidad(l.unidad)} x ${d2(l.precio)}`, d2(l.importe), "b")}`).join("")}
<div class="r"></div>
${fila(imp.gravado ? "Op. gravada" : "Op. exonerada", `S/ ${d2(imp.base)}`)}
${fila("IGV", `S/ ${d2(imp.igv)}`)}
${fila("TOTAL", `S/ ${d2(d.total)}`, "tot")}
<p>SON: ${esc(montoEnLetras(d.total))}</p>
<p>Pago: ${esc(nombreMetodo(d.metodo_pago))} S/ ${d2(d.total)}</p>
${!imp.gravado && d.emisor.leyenda_amazonia ? `<p class="c" style="margin-top:6px">BIENES TRANSFERIDOS EN LA AMAZONÍA REGIÓN SELVA PARA SER CONSUMIDOS EN LA MISMA</p>` : ""}
${qr ? `<img src="${qr}" alt="">` : ""}
<p class="c">Representación impresa de la ${d.tipo === "01" ? "Factura" : "Boleta de Venta"} Electrónica.</p>
${d.sin_conexion ? `<p class="c">Emitido sin internet: se envía a SUNAT al volver la conexión.</p>` : ""}
<p class="c b" style="margin-top:4px">¡Gracias por su compra!</p>
</div></body></html>`;
}

/* Imprime el HTML en un marco invisible (sin abrir otra pestaña) */
export async function imprimirEnNavegador(d: DatosTicket, columnas: 48 | 32) {
  const html = await ticketHtml(d, columnas);
  const marco = document.createElement("iframe");
  marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  marco.setAttribute("aria-hidden", "true");
  document.body.appendChild(marco);

  const doc = marco.contentDocument;
  const ventana = marco.contentWindow;
  if (!doc || !ventana) {
    marco.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  let hecho = false;
  const imprimir = () => {
    if (hecho) return;
    hecho = true;
    setTimeout(() => {
      try {
        ventana.focus();
        ventana.print();
      } catch {
        // nada
      }
    }, 150);
  };

  const img = doc.images[0];
  if (!img || img.complete) imprimir();
  else img.addEventListener("load", imprimir);
  setTimeout(imprimir, 1500);
  setTimeout(() => marco.remove(), 60_000);
}

/* Imprime según cómo esté configurado este equipo (Ajustes → Impresora) */
/* forzar: al tocar «Imprimir» se imprime aunque este equipo no imprima solo */
export function imprimir(t: DatosTicket, forzar = false) {
  const p = leerImpresion();
  if (p.modo === "RAWBT") imprimirConRawBT(t, p.columnas);
  else if (p.modo === "NAVEGADOR" || forzar) void imprimirEnNavegador(t, p.columnas);
}
