/* ============================================================
   SUNAT: envío del comprobante (servicio sendBill) y lectura del CDR
   ============================================================ */

import { leerZip } from "./zip";

export const URL_SUNAT = {
  BETA: "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
  PRODUCCION: "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
} as const;

export type Ambiente = keyof typeof URL_SUNAT;

export type EstadoSunat = "ACEPTADO" | "OBSERVADO" | "RECHAZADO" | "ERROR";

export type RespuestaSunat = {
  estado: EstadoSunat;
  codigo: string;
  mensaje: string;
  observaciones: string[];
  cdrXml: string | null;
};

function escXml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function desescapar(t: string): string {
  return t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function etiqueta(xml: string, nombre: string): string | null {
  const r = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`);
  const m = xml.match(r);
  return m ? desescapar(m[1].trim()) : null;
}

function todas(xml: string, nombre: string): string[] {
  const r = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, "g");
  return Array.from(xml.matchAll(r)).map((m) => desescapar(m[1].trim()));
}

/* Lee la constancia (CDR) que devuelve SUNAT */
export function leerCdr(cdrXml: string): RespuestaSunat {
  const respuesta = cdrXml.match(/<(?:[\w-]+:)?DocumentResponse[\s\S]*?<\/(?:[\w-]+:)?DocumentResponse>/)?.[0] ?? cdrXml;
  const codigo = etiqueta(respuesta, "ResponseCode") ?? "";
  const mensaje = etiqueta(respuesta, "Description") ?? "";
  const observaciones = todas(cdrXml, "Note");
  const n = Number(codigo);

  let estado: EstadoSunat;

  if (n === 0) estado = observaciones.length > 0 ? "OBSERVADO" : "ACEPTADO";
  else if (n >= 4000) estado = "OBSERVADO";
  else if (n >= 2000) estado = "RECHAZADO";
  else estado = "ERROR";

  return { estado, codigo, mensaje, observaciones, cdrXml };
}

/* Convierte un error (soap Fault) de SUNAT en un estado */
function leerFalla(xml: string, http: number): RespuestaSunat {
  const faultcode = etiqueta(xml, "faultcode") ?? "";
  const faultstring = etiqueta(xml, "faultstring") ?? `SUNAT respondió con error (${http}).`;
  const codigo = faultcode.match(/(\d{3,4})\s*$/)?.[1] ?? faultstring.match(/^\s*(\d{3,4})\b/)?.[1] ?? "";
  const n = Number(codigo);

  if (n === 1033) {
    // Ya estaba registrado en SUNAT (por ejemplo, un reenvío)
    return {
      estado: "ACEPTADO",
      codigo,
      mensaje: "SUNAT ya tenía registrado este comprobante.",
      observaciones: [],
      cdrXml: null,
    };
  }

  return {
    estado: n >= 2000 && n < 4000 ? "RECHAZADO" : "ERROR",
    codigo,
    mensaje: faultstring,
    observaciones: [],
    cdrXml: null,
  };
}

export async function enviarComprobante(opciones: {
  ambiente: Ambiente;
  usuario: string; // RUC + usuario SOL (en pruebas: RUC + MODDATOS)
  clave: string;
  nombreZip: string;
  zip: Buffer;
  esperaMs?: number;
}): Promise<RespuestaSunat> {
  const sobre =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" ` +
    `xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">` +
    `<soapenv:Header><wsse:Security><wsse:UsernameToken>` +
    `<wsse:Username>${escXml(opciones.usuario)}</wsse:Username>` +
    `<wsse:Password>${escXml(opciones.clave)}</wsse:Password>` +
    `</wsse:UsernameToken></wsse:Security></soapenv:Header>` +
    `<soapenv:Body><ser:sendBill>` +
    `<fileName>${escXml(opciones.nombreZip)}</fileName>` +
    `<contentFile>${opciones.zip.toString("base64")}</contentFile>` +
    `</ser:sendBill></soapenv:Body></soapenv:Envelope>`;

  let r: Response;

  try {
    r = await fetch(URL_SUNAT[opciones.ambiente], {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "urn:sendBill" },
      body: sobre,
      cache: "no-store",
      signal: AbortSignal.timeout(opciones.esperaMs ?? 9000),
    });
  } catch (e) {
    const tiempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

    return {
      estado: "ERROR",
      codigo: "",
      mensaje: tiempo
        ? "SUNAT no respondió a tiempo. Se puede reenviar."
        : "No se pudo conectar con SUNAT (¿hay internet?). Se puede reenviar.",
      observaciones: [],
      cdrXml: null,
    };
  }

  const texto = await r.text();

  if (/Fault>/.test(texto)) return leerFalla(texto, r.status);

  const respuesta = etiqueta(texto, "applicationResponse");

  if (!respuesta) {
    return {
      estado: "ERROR",
      codigo: String(r.status),
      mensaje: `Respuesta inesperada de SUNAT (${r.status}).`,
      observaciones: [],
      cdrXml: null,
    };
  }

  const archivos = leerZip(Buffer.from(respuesta, "base64"));
  const cdr = archivos.find((a) => a.nombre.toLowerCase().endsWith(".xml"));

  if (!cdr) {
    return { estado: "ERROR", codigo: "", mensaje: "La constancia de SUNAT llegó vacía.", observaciones: [], cdrXml: null };
  }

  return leerCdr(cdr.contenido.toString("utf8"));
}

/* ============================================================
   CONSULTA: ¿SUNAT ya tiene registrado este comprobante?
   Servicio billConsultService (solo producción). Primero pide la
   constancia (getStatusCdr); si no la da, pregunta el estado (getStatus).
   El usuario SOL necesita la opción «Consultar envíos de CPE».
   ============================================================ */

export const URL_CONSULTA = "https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService";

export type ResultadoConsulta =
  | { resultado: "ENCONTRADO"; respuesta: RespuestaSunat }
  | { resultado: "NO_EXISTE"; mensaje: string }
  | { resultado: "ERROR"; codigo: string; mensaje: string };

async function llamarConsulta(
  metodo: "getStatusCdr" | "getStatus",
  o: { usuario: string; clave: string; ruc: string; tipo: string; serie: string; numero: number; esperaMs: number }
): Promise<{ ok: true; xml: string } | { ok: false; codigo: string; mensaje: string }> {
  const sobre =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" ` +
    `xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">` +
    `<soapenv:Header><wsse:Security><wsse:UsernameToken>` +
    `<wsse:Username>${escXml(o.usuario)}</wsse:Username>` +
    `<wsse:Password>${escXml(o.clave)}</wsse:Password>` +
    `</wsse:UsernameToken></wsse:Security></soapenv:Header>` +
    `<soapenv:Body><ser:${metodo}>` +
    `<rucComprobante>${escXml(o.ruc)}</rucComprobante>` +
    `<tipoComprobante>${escXml(o.tipo)}</tipoComprobante>` +
    `<serieComprobante>${escXml(o.serie)}</serieComprobante>` +
    `<numeroComprobante>${o.numero}</numeroComprobante>` +
    `</ser:${metodo}></soapenv:Body></soapenv:Envelope>`;

  try {
    const r = await fetch(URL_CONSULTA, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `urn:${metodo}` },
      body: sobre,
      cache: "no-store",
      signal: AbortSignal.timeout(o.esperaMs),
    });
    const texto = await r.text();

    if (/Fault>/.test(texto)) {
      const f = leerFalla(texto, r.status);
      return { ok: false, codigo: f.codigo, mensaje: f.mensaje };
    }

    // Algo que no es una respuesta de SUNAT (página de error, acceso denegado...): se muestra tal cual
    if (!/statusCode/.test(texto)) {
      const corto = texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      return { ok: false, codigo: String(r.status), mensaje: `SUNAT respondió (${r.status}): ${corto || "sin contenido"}` };
    }

    return { ok: true, xml: texto };
  } catch (e) {
    const tiempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, codigo: "", mensaje: tiempo ? "SUNAT no respondió a tiempo." : "No se pudo conectar con SUNAT." };
  }
}

/* Interpreta el código de estado de la consulta */
function estadoDeConsulta(codigo: string, mensaje: string): ResultadoConsulta | null {
  const texto = mensaje.toLowerCase();

  if (codigo === "0001" || /existe y est[aá] aceptado/.test(texto)) {
    return { resultado: "ENCONTRADO", respuesta: { estado: "ACEPTADO", codigo: "0", mensaje: "SUNAT lo tiene registrado y aceptado.", observaciones: [], cdrXml: null } };
  }

  if (codigo === "0002" || /rechazad/.test(texto)) {
    return { resultado: "ENCONTRADO", respuesta: { estado: "RECHAZADO", codigo, mensaje: mensaje || "SUNAT lo tiene registrado como rechazado.", observaciones: [], cdrXml: null } };
  }

  if (codigo === "0003" || /de baja/.test(texto)) {
    return { resultado: "ENCONTRADO", respuesta: { estado: "RECHAZADO", codigo, mensaje: mensaje || "SUNAT lo tiene dado de baja.", observaciones: [], cdrXml: null } };
  }

  if (codigo === "0011" || codigo === "0127" || /no existe/.test(texto)) {
    return { resultado: "NO_EXISTE", mensaje: mensaje || "SUNAT no tiene registrado este comprobante." };
  }

  return null;
}

export async function consultarComprobante(o: {
  usuario: string;
  clave: string;
  ruc: string;
  tipo: string;
  serie: string;
  numero: number;
  esperaMs?: number;
}): Promise<ResultadoConsulta> {
  const espera = o.esperaMs ?? 4000;

  // 1) La constancia (CDR)
  const cdr = await llamarConsulta("getStatusCdr", { ...o, esperaMs: espera });

  if (cdr.ok) {
    const contenido = etiqueta(cdr.xml, "content");

    if (contenido) {
      try {
        const archivos = leerZip(Buffer.from(contenido, "base64"));
        const xml = archivos.find((a) => a.nombre.toLowerCase().endsWith(".xml"));
        if (xml) return { resultado: "ENCONTRADO", respuesta: leerCdr(xml.contenido.toString("utf8")) };
      } catch {
        // constancia ilegible: se pregunta el estado
      }
    }

    const r = estadoDeConsulta(etiqueta(cdr.xml, "statusCode") ?? "", etiqueta(cdr.xml, "statusMessage") ?? "");
    if (r) return r;
  }

  // 2) Solo el estado
  const est = await llamarConsulta("getStatus", { ...o, esperaMs: espera });

  if (est.ok) {
    const codigo = etiqueta(est.xml, "statusCode") ?? "";
    const mensaje = etiqueta(est.xml, "statusMessage") ?? "";
    const r = estadoDeConsulta(codigo, mensaje);
    if (r) return r;
    return { resultado: "ERROR", codigo, mensaje: `SUNAT respondió código ${codigo || "?"}: ${mensaje || "sin mensaje"}` };
  }

  const falla = cdr.ok ? est : cdr;
  return { resultado: "ERROR", codigo: falla.ok ? "" : falla.codigo, mensaje: falla.ok ? "" : falla.mensaje };
}
