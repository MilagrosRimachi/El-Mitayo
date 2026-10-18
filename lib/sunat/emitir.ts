/* ============================================================
   SUNAT: emitir el comprobante de una venta
   Arma el XML, lo firma con el certificado, lo envía a SUNAT y
   guarda la respuesta. Solo se usa en el servidor.
   ============================================================ */

import { gunzipSync, gzipSync } from "zlib";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { leerCertificado } from "./certificado";
import { descifrar } from "./cifrado";
import { firmarXml } from "./firma";
import { consultarComprobante, enviarComprobante, type Ambiente, type EstadoSunat, type RespuestaSunat } from "./soap";
import { nombreArchivo, xmlSinFirma, type Emisor, type LineaComprobante } from "./xml";
import { crearZip } from "./zip";

export type ConfigSunat = {
  ruc: string | null;
  razon_social: string | null;
  nombre_comercial: string | null;
  direccion: string | null;
  ubigeo: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  urbanizacion: string | null;
  codigo_local: string;
  ambiente: Ambiente;
  usuario_sol: string | null;
  clave_sol_cifrada: string | null;
  certificado_cifrado: string | null;
  certificado_clave_cifrada: string | null;
  certificado_titular: string | null;
  certificado_vence: string | null;
  afectacion: string;
  leyenda_amazonia: boolean;
};

export type ResultadoEmision = {
  ok: boolean;
  estado?: EstadoSunat | "PENDIENTE" | "EN_COLA"; // EN_COLA: espera su turno (otro se está enviando o aún no toca reintentar)
  comprobante?: string; // B001-12
  mensaje?: string;
  error?: string;
  reintentarEnMs?: number; // otro comprobante se está enviando: probar de nuevo en este tiempo
};

export function comprimir(texto: string): string {
  return gzipSync(Buffer.from(texto, "utf8")).toString("base64");
}

export function descomprimir(b64: string | null): string | null {
  return b64 ? gunzipSync(Buffer.from(b64, "base64")).toString("utf8") : null;
}

/* Fecha y hora de Lima */
export function fechaHoraLima(iso: string): { fecha: string; hora: string } {
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

  return { fecha: `${p("year")}-${p("month")}-${p("day")}`, hora: `${p("hour")}:${p("minute")}:${p("second")}` };
}

export function emisorDesde(c: ConfigSunat): Emisor {
  return {
    ruc: c.ruc ?? "",
    razonSocial: c.razon_social ?? "",
    nombreComercial: c.nombre_comercial ?? "",
    direccion: c.direccion ?? "",
    ubigeo: c.ubigeo ?? "",
    departamento: c.departamento ?? "",
    provincia: c.provincia ?? "",
    distrito: c.distrito ?? "",
    urbanizacion: c.urbanizacion ?? "",
    codigoLocal: c.codigo_local || "0000",
  };
}

export function faltaEnConfig(c: ConfigSunat | null): string | null {
  if (!c) return "Falta configurar SUNAT (Configuración → SUNAT).";
  if (!/^(10|15|16|17|20)\d{9}$/.test(c.ruc ?? "")) return "Falta el RUC de la botica en Configuración → SUNAT.";
  if (!c.razon_social || !c.direccion || !c.ubigeo) return "Faltan datos de la botica (razón social, dirección o ubigeo) en Configuración → SUNAT.";
  if (!c.certificado_cifrado || !c.certificado_clave_cifrada) return "Falta subir el certificado digital en Configuración → SUNAT.";
  if (c.ambiente === "PRODUCCION" && (!c.usuario_sol || !c.clave_sol_cifrada)) {
    return "Falta el usuario secundario SOL y su clave en Configuración → SUNAT.";
  }
  return null;
}

type FilaComprobante = {
  id: number;
  venta_id: number;
  tipo: "01" | "03" | "07";
  serie: string;
  numero: number;
  ambiente: Ambiente;
  ref_tipo: string | null;
  ref_serie: string | null;
  ref_numero: number | null;
  motivo_codigo: string | null;
  motivo_texto: string | null;
  fecha_emision: string;
  cliente_tipo_doc: string;
  cliente_numero: string;
  cliente_nombre: string;
  cliente_direccion: string | null;
  total: number;
  estado: string;
  intentos: number;
  codigo_respuesta: string | null;
  enviado_en: string | null;
};

/* Si SUNAT dijo "documento igual en proceso" (0140), se espera este tiempo antes de volver a intentar */
export const ESPERA_EN_PROCESO_MS = 20 * 60 * 1000;

/* ============================================================
   COLA DE ENVÍO (script 42)
   Un solo comprobante se envía a la vez en toda la botica: antes de
   enviarlo se «toma» (app_sunat_tomar) y al terminar se «suelta»
   (app_sunat_liberar), que programa el próximo intento según lo que
   respondió SUNAT: 0102 → 5, 15 y 30 minutos; 0140 → 20 minutos;
   sin respuesta → 5 minutos; otros → 2 minutos.
   ============================================================ */
type Toma = { ok: boolean; motivo?: "NO_EXISTE" | "FINAL" | "ESPERA" | "OCUPADO"; hasta?: string; estado?: string };

/* Mensaje claro para la cajera según el código de SUNAT y la hora del próximo intento */
function mensajeDeEspera(codigo: string | null, hasta: string | null): string {
  const hora = hasta ? horaLima(new Date(hasta).getTime()) : null;
  const cuando = hora ? `Se vuelve a intentar sola desde las ${hora}.` : "Se vuelve a intentar sola.";

  if (codigo === "0140") return `SUNAT lo está procesando. ${cuando} El ticket es válido.`;
  if (codigo === "0102") return `SUNAT no aceptó el ingreso en este momento (suele pasar cuando está saturado). ${cuando} El ticket es válido.`;
  if (codigo === "SIN_RESPUESTA") return `SUNAT no respondió a tiempo. ${cuando} El ticket es válido.`;
  return `${cuando} El ticket es válido.`;
}

function usuarioYClave(cfg: ConfigSunat): { usuario: string; clave: string } {
  const ruc = cfg.ruc ?? "";
  return cfg.ambiente === "BETA"
    ? { usuario: `${ruc}MODDATOS`, clave: "moddatos" }
    : { usuario: `${ruc}${(cfg.usuario_sol ?? "").toUpperCase()}`, clave: descifrar(cfg.clave_sol_cifrada as string) };
}

/* Guarda lo que SUNAT respondió en una consulta (cuando ya lo tenía registrado) */
async function guardarConsulta(
  admin: NonNullable<ReturnType<typeof crearClienteAdmin>>,
  comp: FilaComprobante,
  r: RespuestaSunat
) {
  return admin
    .from("comprobantes")
    .update({
      estado: r.estado,
      cdr_gz: r.cdrXml ? comprimir(r.cdrXml) : null,
      codigo_respuesta: r.codigo || null,
      mensaje: r.mensaje || null,
      observaciones: r.observaciones.length ? r.observaciones.join(" | ") : null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", comp.id);
}

function horaLima(ms: number): string {
  return new Intl.DateTimeFormat("es-PE", { timeStyle: "short", timeZone: "America/Lima" }).format(new Date(ms));
}

/* ============================================================
   CONSULTAR EN SUNAT (botón): si ya lo tiene, se marca y se baja
   la constancia; si no, se avisa que se puede reenviar.
   ============================================================ */
export async function consultarEnSunat(comprobanteId: number): Promise<ResultadoEmision> {
  const admin = crearClienteAdmin();

  if (!admin) return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." };

  const compR = await admin.from("comprobantes").select("*").eq("id", comprobanteId).maybeSingle();
  const comp = compR.data as FilaComprobante | null;

  if (!comp) return { ok: false, error: "El comprobante no existe." };

  const nombre = `${comp.serie}-${comp.numero}`;

  if (comp.estado === "ACEPTADO" || comp.estado === "OBSERVADO") {
    return { ok: true, estado: comp.estado, comprobante: nombre, mensaje: "Ya figura aceptado por SUNAT." };
  }

  const cfgR = await admin.from("sunat_config").select("*").eq("id", 1).maybeSingle();
  const cfg = cfgR.data as ConfigSunat | null;
  const falta = faltaEnConfig(cfg);

  if (falta || !cfg) return { ok: false, comprobante: nombre, error: falta ?? "Falta configurar SUNAT." };

  if (cfg.ambiente !== "PRODUCCION" || comp.ambiente !== "PRODUCCION") {
    return { ok: false, comprobante: nombre, error: "La consulta en SUNAT solo funciona en producción." };
  }

  try {
    const { usuario, clave } = usuarioYClave(cfg);
    const c = await consultarComprobante({
      usuario,
      clave,
      ruc: cfg.ruc ?? "",
      tipo: comp.tipo,
      serie: comp.serie,
      numero: comp.numero,
      esperaMs: 8000,
    });

    if (c.resultado === "ENCONTRADO") {
      const upd = await guardarConsulta(admin, comp, c.respuesta);
      if (upd.error) return { ok: false, comprobante: nombre, error: upd.error.message };
      return {
        ok: true,
        estado: c.respuesta.estado,
        comprobante: nombre,
        mensaje:
          c.respuesta.estado === "ACEPTADO" || c.respuesta.estado === "OBSERVADO"
            ? "✔ SUNAT ya lo tenía registrado: quedó como aceptado."
            : `SUNAT lo tiene como ${c.respuesta.estado.toLowerCase()}: ${c.respuesta.mensaje}`,
      };
    }

    if (c.resultado === "NO_EXISTE") {
      // Se quita la espera del 0140: el siguiente envío va de frente
      await admin
        .from("comprobantes")
        .update({ codigo_respuesta: "NO_EXISTE", mensaje: "SUNAT no lo tiene registrado: se reenviará.", proximo_intento: null, actualizado_en: new Date().toISOString() })
        .eq("id", comp.id);
      return { ok: true, estado: "PENDIENTE", comprobante: nombre, mensaje: "SUNAT todavía no lo tiene registrado. Se puede reenviar." };
    }

    return {
      ok: false,
      comprobante: nombre,
      error: `No se pudo consultar${c.codigo ? ` (${c.codigo})` : ""}: ${c.mensaje}${
        c.codigo === "0111" ? " Marca en SUNAT, para el usuario secundario, la opción «Consultar envíos de CPE»." : ""
      }`,
    };
  } catch (e) {
    return { ok: false, comprobante: nombre, error: e instanceof Error ? e.message : "No se pudo consultar." };
  }
}

export async function lineasDeVenta(
  admin: NonNullable<ReturnType<typeof crearClienteAdmin>>,
  ventaId: number
): Promise<LineaComprobante[]> {
  const det = await admin
    .from("venta_detalles")
    .select("producto_id, codigo, descripcion, unidad, cantidad, importe")
    .eq("venta_id", ventaId)
    .order("id");

  if (det.error) throw new Error(det.error.message);

  const filas = det.data as Array<{ producto_id: number | null; codigo: string | null; descripcion: string; unidad: string | null; cantidad: number; importe: number }>;

  return filas.map((f, i) => ({
    codigo: f.codigo || (f.producto_id ? String(f.producto_id) : String(i + 1)),
    descripcion: f.descripcion,
    unidad: f.unidad ?? "NIU",
    cantidad: Math.round(Number(f.cantidad) * 1000) / 1000,
    importe: Math.round(Number(f.importe) * 100) / 100,
  }));
}

/* Boleta o factura de una venta */
export async function emitirComprobanteDeVenta(ventaId: number): Promise<ResultadoEmision> {
  const admin = crearClienteAdmin();

  if (!admin) return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." };

  const r = await admin
    .from("comprobantes")
    .select("id")
    .eq("venta_id", ventaId)
    .in("tipo", ["01", "03"])
    .maybeSingle();

  if (r.error) return { ok: false, error: r.error.message };
  if (!r.data) return { ok: false, error: "Esta venta no tiene comprobante (se registró antes de conectar SUNAT)." };

  return emitirComprobante(Number((r.data as { id: number }).id));
}

/* Cualquier comprobante (boleta, factura o nota de crédito) por su id */
/* Arma el XML del comprobante y lo firma con el certificado (no lo envía) */
async function armarYFirmar(
  admin: NonNullable<ReturnType<typeof crearClienteAdmin>>,
  comp: FilaComprobante,
  cfg: ConfigSunat
) {
  const ventaId = Number(comp.venta_id);
  const pfx = descifrar(cfg.certificado_cifrado as string);
  const claveCert = descifrar(cfg.certificado_clave_cifrada as string);
  const cert = leerCertificado(pfx, claveCert);
  const emisor = emisorDesde(cfg);
  const { fecha, hora } = fechaHoraLima(comp.fecha_emision);
  const lineas = await lineasDeVenta(admin, ventaId);

  if (lineas.length === 0) throw new Error("La venta no tiene productos.");

  const datos = {
    tipo: comp.tipo,
    referencia:
      comp.tipo === "07"
        ? {
            tipo: comp.ref_tipo ?? "03",
            serie: comp.ref_serie ?? "",
            numero: Number(comp.ref_numero ?? 0),
            motivoCodigo: comp.motivo_codigo ?? "01",
            motivoTexto: comp.motivo_texto ?? "ANULACION DE LA OPERACION",
          }
        : null,
    serie: comp.serie,
    numero: comp.numero,
    fecha,
    hora,
    emisor,
    cliente: {
      tipoDoc: comp.cliente_tipo_doc,
      numero: comp.cliente_numero,
      nombre: comp.cliente_nombre,
      direccion: comp.cliente_direccion,
    },
    lineas,
    total: Number(comp.total),
    afectacion: cfg.afectacion || "20",
    leyendaAmazonia: cfg.leyenda_amazonia,
  };

  const firmado = firmarXml(xmlSinFirma(datos), cert.llavePem, cert.certificadoB64);
  return { firmado, datos, emisor };
}

/* ============================================================
   FIRMAR ANTES DE IMPRIMIR: al cobrar, el ticket sale enseguida
   con su código hash, sin esperar la respuesta de SUNAT.
   ============================================================ */
export async function firmarComprobanteDeVenta(ventaId: number): Promise<{ ok: boolean; error?: string }> {
  const admin = crearClienteAdmin();

  if (!admin) return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." };

  const compR = await admin
    .from("comprobantes")
    .select("*")
    .eq("venta_id", ventaId)
    .in("tipo", ["01", "03"])
    .maybeSingle();

  const comp = compR.data as (FilaComprobante & { hash: string | null }) | null;

  if (!comp) return { ok: false, error: "Esta venta no tiene comprobante." };
  if (comp.hash) return { ok: true };

  const cfgR = await admin.from("sunat_config").select("*").eq("id", 1).maybeSingle();
  const cfg = cfgR.data as ConfigSunat | null;

  if (faltaEnConfig(cfg) || !cfg) return { ok: false, error: "Falta configurar SUNAT." };

  try {
    const { firmado } = await armarYFirmar(admin, comp, cfg);

    await admin
      .from("comprobantes")
      .update({ hash: firmado.hash, xml_gz: comprimir(firmado.xml), actualizado_en: new Date().toISOString() })
      .eq("id", comp.id)
      .is("hash", null);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo firmar." };
  }
}

export async function emitirComprobante(comprobanteId: number): Promise<ResultadoEmision> {
  const admin = crearClienteAdmin();

  if (!admin) return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." };

  const compR = await admin.from("comprobantes").select("*").eq("id", comprobanteId).maybeSingle();

  if (compR.error) return { ok: false, error: compR.error.message };

  const comp = compR.data as FilaComprobante | null;

  if (!comp) return { ok: false, error: "El comprobante no existe." };

  const nombre = `${comp.serie}-${comp.numero}`;

  if (comp.estado === "ACEPTADO" || comp.estado === "OBSERVADO") {
    return { ok: true, estado: comp.estado, comprobante: nombre, mensaje: "Ya fue aceptado por SUNAT." };
  }

  const cfgR = await admin.from("sunat_config").select("*").eq("id", 1).maybeSingle();

  if (cfgR.error) return { ok: false, error: cfgR.error.message };

  const cfg = cfgR.data as ConfigSunat | null;
  const falta = faltaEnConfig(cfg);

  if (falta || !cfg) {
    return { ok: true, estado: "PENDIENTE", comprobante: nombre, mensaje: falta ?? "Falta configurar SUNAT." };
  }

  // La nota de crédito espera a que SUNAT acepte la boleta o factura que anula
  if (comp.tipo === "07") {
    const orig = await admin
      .from("comprobantes")
      .select("estado")
      .eq("serie", comp.ref_serie ?? "")
      .eq("numero", Number(comp.ref_numero ?? 0))
      .eq("ambiente", comp.ambiente)
      .maybeSingle();
    const estadoOrig = (orig.data as { estado: string } | null)?.estado;
    if (estadoOrig !== "ACEPTADO" && estadoOrig !== "OBSERVADO") {
      return {
        ok: true,
        estado: "EN_COLA",
        comprobante: nombre,
        mensaje: `Espera a que SUNAT acepte ${comp.ref_serie}-${comp.ref_numero}; luego se envía sola.`,
      };
    }
  }

  if (cfg.ambiente !== comp.ambiente) {
    return {
      ok: false,
      comprobante: nombre,
      error: `Este comprobante se numeró en ${comp.ambiente === "BETA" ? "pruebas" : "producción"} y SUNAT está en ${cfg.ambiente === "BETA" ? "pruebas" : "producción"}: no se envía.`,
    };
  }

  const inicio = Date.now();

  // 1) Se «toma» el comprobante: si otro se está enviando en este momento
  //    (desde cualquier caja o pantalla), este espera su turno.
  const toma = await admin.rpc("app_sunat_tomar", { p_id: comp.id });

  if (toma.error) return { ok: false, comprobante: nombre, error: toma.error.message };

  const t = toma.data as Toma;

  if (!t.ok) {
    if (t.motivo === "FINAL") {
      return { ok: true, estado: (t.estado as EstadoSunat) ?? "ACEPTADO", comprobante: nombre, mensaje: "SUNAT ya respondió este comprobante." };
    }
    if (t.motivo === "ESPERA") {
      return { ok: true, estado: "EN_COLA", comprobante: nombre, mensaje: mensajeDeEspera(comp.codigo_respuesta, t.hasta ?? null) };
    }
    return {
      ok: true,
      estado: "EN_COLA",
      comprobante: nombre,
      mensaje: "En cola: SUNAT está recibiendo otro comprobante. Se envía en unos segundos. El ticket es válido.",
      reintentarEnMs: 5000,
    };
  }

  // Lo que respondió SUNAT, para programar el próximo intento al soltarlo
  let codigoFinal: string | null = null;
  let estadoFinal: string = "ERROR";

  try {
    const r = await enviarTomado(admin, comp, cfg, nombre, inicio);
    codigoFinal = r.codigo;
    estadoFinal = r.resultado.estado ?? "ERROR";

    if (r.resultado.ok && r.resultado.estado === "ERROR") {
      const lib = await admin.rpc("app_sunat_liberar", { p_id: comp.id, p_codigo: codigoFinal ?? "", p_estado: estadoFinal });
      const hasta = (lib.data as { proximo_intento?: string } | null)?.proximo_intento ?? null;
      codigoFinal = "__LIBERADO__";
      const conocido = r.codigo === "0140" || r.codigo === "0102" || r.codigo === "SIN_RESPUESTA";
      const espera = mensajeDeEspera(r.codigo, hasta);
      return { ...r.resultado, mensaje: conocido || !r.resultado.mensaje ? espera : `${r.resultado.mensaje} · ${espera}` };
    }

    return r.resultado;
  } finally {
    if (codigoFinal !== "__LIBERADO__") {
      await admin.rpc("app_sunat_liberar", { p_id: comp.id, p_codigo: codigoFinal ?? "", p_estado: estadoFinal });
    }
  }
}

/* Envío de un comprobante ya «tomado» (nadie más lo está enviando) */
async function enviarTomado(
  admin: NonNullable<ReturnType<typeof crearClienteAdmin>>,
  comp: FilaComprobante,
  cfg: ConfigSunat,
  nombre: string,
  inicio: number
): Promise<{ resultado: ResultadoEmision; codigo: string | null }> {
  const { usuario, clave } = usuarioYClave(cfg);

  // Si ya se intentó antes, primero se pregunta a SUNAT si ya lo tiene (evita reenvíos y el error 0140)
  if (cfg.ambiente === "PRODUCCION" && comp.intentos > 0 && comp.codigo_respuesta !== "NO_EXISTE") {
    try {
      const c = await consultarComprobante({
        usuario,
        clave,
        ruc: cfg.ruc ?? "",
        tipo: comp.tipo,
        serie: comp.serie,
        numero: comp.numero,
        esperaMs: 3500,
      });

      if (c.resultado === "ENCONTRADO") {
        const upd = await guardarConsulta(admin, comp, c.respuesta);
        if (upd.error) return { resultado: { ok: false, comprobante: nombre, error: upd.error.message }, codigo: null };
        return {
          resultado: { ok: true, estado: c.respuesta.estado, comprobante: nombre, mensaje: c.respuesta.mensaje },
          codigo: c.respuesta.codigo || null,
        };
      }
    } catch {
      // si la consulta falla, se envía igual
    }
  }

  try {
    const { firmado, datos } = await armarYFirmar(admin, comp, cfg);
    const base = nombreArchivo(datos);
    const zip = crearZip(`${base}.xml`, firmado.xml);

    // El servidor tiene un límite de tiempo por pedido: lo que quede se le da a SUNAT
    const esperaMs = Math.max(4000, 9000 - (Date.now() - inicio));

    const r = await enviarComprobante({ ambiente: cfg.ambiente, usuario, clave, nombreZip: `${base}.zip`, zip, esperaMs });

    // 1033 = «ya estaba registrado»: se da por aceptado. Si queda tiempo, se baja su constancia (CDR).
    let cdrXml = r.cdrXml;
    if (r.codigo === "1033" && !cdrXml && cfg.ambiente === "PRODUCCION" && Date.now() - inicio < 6000) {
      try {
        const c = await consultarComprobante({
          usuario,
          clave,
          ruc: cfg.ruc ?? "",
          tipo: comp.tipo,
          serie: comp.serie,
          numero: comp.numero,
          esperaMs: Math.max(2000, 8500 - (Date.now() - inicio)),
        });
        if (c.resultado === "ENCONTRADO") cdrXml = c.respuesta.cdrXml;
      } catch {
        // sin constancia: se puede bajar después con «Consultar en SUNAT»
      }
    }

    const codigo = r.codigo || (r.estado === "ERROR" ? "SIN_RESPUESTA" : null);

    const upd = await admin
      .from("comprobantes")
      .update({
        estado: r.estado,
        hash: firmado.hash,
        xml_gz: comprimir(firmado.xml),
        cdr_gz: cdrXml ? comprimir(cdrXml) : null,
        // Sin respuesta (tiempo agotado o sin internet): se marca para esperar antes de reenviar
        codigo_respuesta: codigo,
        mensaje: r.mensaje || null,
        observaciones: r.observaciones.length ? r.observaciones.join(" | ") : null,
        intentos: comp.intentos + 1,
        enviado_en: new Date().toISOString(),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", comp.id);

    if (upd.error) return { resultado: { ok: false, comprobante: nombre, error: upd.error.message }, codigo };

    return { resultado: { ok: true, estado: r.estado, comprobante: nombre, mensaje: r.mensaje }, codigo };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "Error al preparar el comprobante.";

    await admin
      .from("comprobantes")
      .update({
        estado: "ERROR",
        mensaje,
        intentos: comp.intentos + 1,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", comp.id);

    return { resultado: { ok: true, estado: "ERROR", comprobante: nombre, mensaje }, codigo: null };
  }
}
