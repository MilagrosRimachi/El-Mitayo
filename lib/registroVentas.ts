/* ============================================================
   REGISTRO DE VENTAS DEL MES (para la contadora)
   Una fila por comprobante emitido en el mes, como lo pide un
   registro de ventas: boletas, facturas y notas de crédito
   (las notas restan). Las anuladas se ven con su nota.
   ============================================================ */

import type { Contexto } from "./local";
import { d2, fechaHoraLima, impuestos, nombreMetodo, numeroCompleto } from "./ticket";

type ClienteSb = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type FilaRegistro = {
  fecha: string; // dd/mm/aaaa
  tipo: "01" | "03" | "07";
  serie: string;
  numero: number;
  tipoDoc: string; // 0 sin documento, 1 DNI, 6 RUC
  numDoc: string;
  cliente: string;
  pago: string;
  gravada: number;
  exonerada: number;
  igv: number;
  total: number; // negativo en notas de crédito
  estadoSunat: string;
  observacion: string; // «ANULADA con BC01-1», «Anula B001-5», «Rechazada por SUNAT»
  cuenta: boolean; // false: rechazada por SUNAT (no vale)
  vigente: boolean; // la venta sigue en pie (no anulada)
};

export type ResumenRegistro = {
  boletas: number;
  facturas: number;
  notas: number; // negativo
  neto: number;
  gravada: number;
  exonerada: number;
  igv: number;
  cantidad: { boletas: number; facturas: number; notas: number };
  porMetodo: Array<[string, number]>; // solo ventas vigentes
  pendientes: number;
  rechazados: number;
};

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function nombreMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

export function rangoMes(ym: string): [string, string] {
  const [a, m] = ym.split("-").map(Number);
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return [new Date(`${ym}-01T00:00:00-05:00`).toISOString(), new Date(`${sig}-01T00:00:00-05:00`).toISOString()];
}

export function nombreTipo(t: string): string {
  return t === "01" ? "Factura" : t === "07" ? "Nota de crédito" : "Boleta";
}

function nombreDoc(t: string): string {
  return t === "6" ? "RUC" : t === "1" ? "DNI" : t === "4" ? "C.E." : "";
}

type FilaSb = {
  tipo: "01" | "03" | "07";
  serie: string;
  numero: number;
  fecha_emision: string;
  cliente_tipo_doc: string;
  cliente_numero: string;
  cliente_nombre: string;
  total: number;
  estado: string;
  ref_serie: string | null;
  ref_numero: number | null;
  venta_id: number;
  ventas: { metodo_pago: string; estado: string } | null;
};

export async function cargarRegistro(sb: ClienteSb, ym: string, ambiente: string, afectacion: string): Promise<FilaRegistro[]> {
  const [desde, hasta] = rangoMes(ym);
  const filas: FilaSb[] = [];
  for (let i = 0; i < 100_000; i += 1000) {
    const { data, error } = await sb
      .from("comprobantes")
      .select("tipo, serie, numero, fecha_emision, cliente_tipo_doc, cliente_numero, cliente_nombre, total, estado, ref_serie, ref_numero, venta_id, ventas(metodo_pago, estado)")
      .eq("ambiente", ambiente)
      .gte("fecha_emision", desde)
      .lt("fecha_emision", hasta)
      .order("fecha_emision")
      .order("id")
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    filas.push(...((data ?? []) as FilaSb[]));
    if ((data ?? []).length < 1000) break;
  }

  // Notas de crédito por venta, para decir con cuál se anuló cada comprobante
  const notaDeVenta = new Map<number, string>();
  for (const f of filas) if (f.tipo === "07") notaDeVenta.set(f.venta_id, numeroCompleto(f.serie, f.numero));

  return filas.map((f) => {
    const signo = f.tipo === "07" ? -1 : 1;
    const total = Number(f.total);
    const imp = impuestos(total, afectacion);
    const rechazada = f.estado === "RECHAZADO";
    const anulada = f.tipo !== "07" && f.ventas?.estado === "ANULADA";
    let observacion = "";
    if (rechazada) observacion = "Rechazada por SUNAT (no vale)";
    else if (f.tipo === "07") observacion = `Anula ${f.ref_serie}-${String(f.ref_numero ?? "").padStart(8, "0")}`;
    else if (anulada) observacion = `ANULADA${notaDeVenta.has(f.venta_id) ? ` con ${notaDeVenta.get(f.venta_id)}` : ""}`;

    return {
      fecha: fechaHoraLima(f.fecha_emision).fecha,
      tipo: f.tipo,
      serie: f.serie,
      numero: f.numero,
      tipoDoc: f.cliente_tipo_doc,
      numDoc: f.cliente_tipo_doc === "0" ? "" : f.cliente_numero,
      cliente: f.cliente_nombre,
      pago: f.ventas ? nombreMetodo(f.ventas.metodo_pago) : "",
      gravada: imp.gravado ? signo * imp.base : 0,
      exonerada: imp.gravado ? 0 : signo * imp.base,
      igv: signo * imp.igv,
      total: signo * total,
      estadoSunat: f.estado,
      observacion,
      cuenta: !rechazada,
      vigente: f.tipo !== "07" && !anulada && !rechazada,
    };
  });
}

/* Métodos de pago de las ventas vigentes (lo que entró a caja) */
export function resumir(filas: FilaRegistro[]): ResumenRegistro {
  const r: ResumenRegistro = {
    boletas: 0,
    facturas: 0,
    notas: 0,
    neto: 0,
    gravada: 0,
    exonerada: 0,
    igv: 0,
    cantidad: { boletas: 0, facturas: 0, notas: 0 },
    porMetodo: [],
    pendientes: 0,
    rechazados: 0,
  };
  const metodos = new Map<string, number>();
  for (const f of filas) {
    if (!f.cuenta) {
      r.rechazados++;
      continue;
    }
    if (f.tipo === "01") {
      r.facturas += f.total;
      r.cantidad.facturas++;
    } else if (f.tipo === "03") {
      r.boletas += f.total;
      r.cantidad.boletas++;
    } else {
      r.notas += f.total;
      r.cantidad.notas++;
    }
    r.gravada += f.gravada;
    r.exonerada += f.exonerada;
    r.igv += f.igv;
    if (!["ACEPTADO", "OBSERVADO"].includes(f.estadoSunat)) r.pendientes++;
    if (f.vigente && f.pago) metodos.set(f.pago, (metodos.get(f.pago) ?? 0) + f.total);
  }
  const red = (n: number) => Math.round(n * 100) / 100;
  r.boletas = red(r.boletas);
  r.facturas = red(r.facturas);
  r.notas = red(r.notas);
  r.neto = red(r.boletas + r.facturas + r.notas);
  r.gravada = red(r.gravada);
  r.exonerada = red(r.exonerada);
  r.igv = red(r.igv);
  r.porMetodo = Array.from(metodos).map(([m, t]) => [m, red(t)] as [string, number]);
  return r;
}

/* ---------------- PDF (A4 horizontal) ---------------- */

type JsPdf = {
  setFontSize: (n: number) => void;
  setFont: (f: string, s: string) => void;
  setTextColor: (r: number, g?: number, b?: number) => void;
  setFillColor: (r: number, g: number, b: number) => void;
  rect: (x: number, y: number, w: number, h: number, s?: string) => void;
  text: (t: string | string[], x: number, y: number, o?: { align?: string }) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  addPage: () => void;
  splitTextToSize: (t: string, w: number) => string[];
  getNumberOfPages: () => number;
  setPage: (n: number) => void;
  output: (t: "arraybuffer") => ArrayBuffer;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
};

export async function pdfRegistro(filas: FilaRegistro[], r: ResumenRegistro, emisor: Contexto["emisor"] | null, ym: string, ambiente: string): Promise<ArrayBuffer> {
  const { jsPDF } = (await import("jspdf")) as unknown as { jsPDF: new (o?: Record<string, unknown>) => JsPdf };
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const M = 10;
  const gravado = filas.some((f) => f.gravada !== 0 || f.igv !== 0);
  let y = 14;

  const negocio = emisor?.nombre_comercial || emisor?.razon_social || 'Multiservicio "El Mitayo"';
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`REGISTRO DE VENTAS · ${nombreMes(ym).toUpperCase()}${ambiente === "BETA" ? " (PRUEBAS, SIN VALOR)" : ""}`, M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${negocio}${emisor?.razon_social && emisor.razon_social !== negocio ? ` · ${emisor.razon_social}` : ""}${emisor?.ruc ? ` · RUC ${emisor.ruc}` : ""}`, M, y);
  y += 5;
  doc.text(gravado ? "Operaciones gravadas con IGV (precios con IGV incluido)." : "Operaciones exoneradas de IGV (Ley de la Amazonía).", M, y);
  y += 6;

  // Cuadro resumen
  const cajas: Array<[string, string]> = [
    [`Boletas (${r.cantidad.boletas})`, `S/ ${d2(r.boletas)}`],
    [`Facturas (${r.cantidad.facturas})`, `S/ ${d2(r.facturas)}`],
    [`Notas de crédito (${r.cantidad.notas})`, `S/ ${d2(r.notas)}`],
    ["TOTAL NETO DEL MES", `S/ ${d2(r.neto)}`],
  ];
  const anchoCaja = (ancho - 2 * M - 9) / 4;
  cajas.forEach(([t, v], i) => {
    const x = M + i * (anchoCaja + 3);
    doc.setFillColor(i === 3 ? 248 : 253, i === 3 ? 211 : 241, i === 3 ? 224 : 245);
    doc.rect(x, y, anchoCaja, 14, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(t, x + 3, y + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(v, x + 3, y + 11.5);
  });
  y += 19;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${gravado ? `Op. gravada S/ ${d2(r.gravada)} · IGV S/ ${d2(r.igv)}` : `Op. exonerada S/ ${d2(r.exonerada)} · IGV S/ 0.00`}   ·   Cobrado (ventas vigentes): ${r.porMetodo.map(([m, t]) => `${m} S/ ${d2(t)}`).join(" · ") || "—"}`,
    M,
    y
  );
  y += 4.5;
  if (r.pendientes || r.rechazados) {
    doc.text(
      [r.pendientes ? `${r.pendientes} comprobante(s) aún sin respuesta de SUNAT.` : "", r.rechazados ? `${r.rechazados} rechazado(s) por SUNAT: no suman.` : ""].filter(Boolean).join("  "),
      M,
      y
    );
    y += 4.5;
  }
  y += 3;

  // Columnas
  const X = { fecha: M, tipo: M + 19, comp: M + 41, doc: M + 70, cli: M + 100, pago: M + 170, base: M + 214, igv: M + 232, total: M + 252, obs: M + 255 };
  const encabezado = () => {
    doc.setFillColor(248, 211, 224);
    doc.rect(M, y - 4, ancho - 2 * M, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Fecha", X.fecha + 1, y);
    doc.text("Tipo", X.tipo, y);
    doc.text("Serie-Número", X.comp, y);
    doc.text("Doc. cliente", X.doc, y);
    doc.text("Cliente", X.cli, y);
    doc.text("Pago", X.pago, y);
    doc.text(gravado ? "Op. gravada" : "Exonerado", X.base, y, { align: "right" });
    doc.text("IGV", X.igv, y, { align: "right" });
    doc.text("Total", X.total, y, { align: "right" });
    doc.text("Observación", X.obs, y);
    y += 5;
    doc.setFont("helvetica", "normal");
  };
  encabezado();

  for (const f of filas) {
    doc.setFontSize(8);
    const cliente = doc.splitTextToSize(f.cliente, 68);
    const obs = doc.splitTextToSize(f.observacion, ancho - M - X.obs);
    const h = 3.8 * Math.max(cliente.length, obs.length || 1);
    if (y + h > alto - 12) {
      doc.addPage();
      y = 14;
      encabezado();
    }
    if (!f.cuenta || f.tipo === "07" || !f.vigente) doc.setTextColor(150, 30, 60);
    doc.text(f.fecha, X.fecha + 1, y);
    doc.text(f.tipo === "07" ? "N. crédito" : nombreTipo(f.tipo), X.tipo, y);
    doc.text(numeroCompleto(f.serie, f.numero), X.comp, y);
    doc.text(f.numDoc ? `${nombreDoc(f.tipoDoc)} ${f.numDoc}` : "—", X.doc, y);
    doc.text(cliente, X.cli, y);
    doc.text(f.pago, X.pago, y);
    doc.text(d2(gravado ? f.gravada : f.exonerada), X.base, y, { align: "right" });
    doc.text(d2(f.igv), X.igv, y, { align: "right" });
    doc.text(d2(f.total), X.total, y, { align: "right" });
    if (obs.length) doc.text(obs, X.obs, y);
    doc.setTextColor(0);
    y += h + 0.6;
  }

  if (y + 10 > alto - 12) {
    doc.addPage();
    y = 14;
  }
  doc.line(M, y - 2, ancho - M, y - 2);
  y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TOTALES DEL MES", X.cli, y);
  doc.text(d2(gravado ? r.gravada : r.exonerada), X.base, y, { align: "right" });
  doc.text(d2(r.igv), X.igv, y, { align: "right" });
  doc.text(d2(r.neto), X.total, y, { align: "right" });

  // Número de página
  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`${negocio} · Registro de ventas ${nombreMes(ym)} · Página ${p} de ${paginas}`, ancho - M, alto - 6, { align: "right" });
  }

  return doc.output("arraybuffer");
}

/* ---------------- Excel ---------------- */

export function filasExcel(filas: FilaRegistro[], r: ResumenRegistro): Array<Array<string | number>> {
  return [
    [
      "Fecha de emisión",
      "Tipo de comprobante",
      "Cód. tipo",
      "Serie",
      "Número",
      "Tipo doc. cliente",
      "N° doc. cliente",
      "Cliente / Razón social",
      "Op. gravada",
      "Op. exonerada",
      "IGV",
      "Importe total",
      "Medio de pago",
      "Estado SUNAT",
      "Observación",
    ],
    ...filas.map((f) => [
      f.fecha,
      nombreTipo(f.tipo),
      f.tipo,
      f.serie,
      f.numero,
      f.numDoc ? f.tipoDoc : "0",
      f.numDoc || "-",
      f.cliente,
      f.gravada,
      f.exonerada,
      f.igv,
      f.total,
      f.pago,
      f.estadoSunat,
      f.observacion,
    ]),
    [],
    ["", "", "", "", "", "", "", "TOTALES", r.gravada, r.exonerada, r.igv, r.neto],
    [],
    ["Boletas", r.boletas],
    ["Facturas", r.facturas],
    ["Notas de crédito", r.notas],
    ["Total neto", r.neto],
  ];
}
