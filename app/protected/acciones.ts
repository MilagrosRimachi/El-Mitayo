"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { crearClienteAdmin, MENSAJE_FALTA_CLAVE } from "@/lib/supabase/admin";
import { consultarEnSunat, emitirComprobante, type ResultadoEmision } from "@/lib/sunat/emitir";
import { leerCertificado } from "@/lib/sunat/certificado";
import { cifrar, descifrar } from "@/lib/sunat/cifrado";
import { errorDocumento, type ResultadoDocumento, type TipoDocumento } from "@/lib/documento";

type Respuesta = { ok: boolean; error?: string; aviso?: string };

async function conSesion() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? { supabase, usuario: data.user.id } : null;
}

/* ============================================================
   SUNAT: enviar y consultar
   ============================================================ */

export async function enviarSunat(comprobanteId: number): Promise<ResultadoEmision> {
  if (!(await conSesion())) return { ok: false, error: "Inicia sesión." };
  return emitirComprobante(comprobanteId);
}

export async function consultarSunat(comprobanteId: number): Promise<ResultadoEmision> {
  if (!(await conSesion())) return { ok: false, error: "Inicia sesión." };
  return consultarEnSunat(comprobanteId);
}

/* ============================================================
   CLIENTE: DNI / RUC
   1) Primero los clientes ya guardados.
   2) Si no está, se consulta en RENIEC / SUNAT con Decolecta
      (token en .env.local y en Netlify como DECOLECTA_TOKEN).
   ============================================================ */

type RespuestaDni = { full_name?: string; first_name?: string; first_last_name?: string; second_last_name?: string };
type RespuestaRuc = { razon_social?: string; direccion?: string; distrito?: string; provincia?: string; departamento?: string; estado?: string; condicion?: string };

export async function consultarDocumento(tipo: TipoDocumento, numero: string): Promise<ResultadoDocumento> {
  const n = numero.trim();
  const problema = errorDocumento(tipo, n);
  if (problema) return { ok: false, error: problema };

  const s = await conSesion();
  if (!s) return { ok: false, error: "Inicia sesión." };

  const guardado = await s.supabase
    .from("clientes")
    .select("nombre, direccion")
    .eq("tipo_doc", tipo === "DNI" ? "1" : "6")
    .eq("numero", n)
    .maybeSingle();

  if (!guardado.error && guardado.data) {
    const c = guardado.data as { nombre: string; direccion: string | null };
    return { ok: true, nombre: c.nombre, direccion: c.direccion ?? "" };
  }

  const token = process.env.DECOLECTA_TOKEN;
  if (!token) return { ok: false, error: "Falta configurar la consulta de DNI/RUC (DECOLECTA_TOKEN). Escribe el nombre a mano." };

  const url =
    tipo === "DNI" ? `https://api.decolecta.com/v1/reniec/dni?numero=${n}` : `https://api.decolecta.com/v1/sunat/ruc?numero=${n}`;

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });

    if (r.status === 404 || r.status === 422) return { ok: false, error: `No se encontró ese ${tipo}. Escribe el nombre a mano.` };
    if (r.status === 401 || r.status === 403) {
      return { ok: false, error: "La consulta no está disponible (token o plan). Escribe el nombre a mano: quedará guardado." };
    }
    if (r.status === 429) return { ok: false, error: "Se alcanzó el límite de consultas. Escribe el nombre a mano." };
    if (!r.ok) return { ok: false, error: `La consulta respondió con error (${r.status}). Escribe el nombre a mano.` };

    if (tipo === "DNI") {
      const d = (await r.json()) as RespuestaDni;
      const nombre = d.full_name?.trim() || [d.first_last_name, d.second_last_name, d.first_name].filter(Boolean).join(" ").trim();
      return nombre ? { ok: true, nombre, direccion: "" } : { ok: false, error: "No se encontró ese DNI. Escribe el nombre a mano." };
    }

    const d = (await r.json()) as RespuestaRuc;
    if (!d.razon_social) return { ok: false, error: "No se encontró ese RUC. Escribe la razón social a mano." };

    const lugar = [d.distrito, d.provincia, d.departamento].filter(Boolean).join(" - ");
    const direccion = [d.direccion && d.direccion !== "-" ? d.direccion : "", lugar].filter(Boolean).join(", ");
    const avisos: string[] = [];
    if (d.estado && d.estado.toUpperCase() !== "ACTIVO") avisos.push(`estado ${d.estado}`);
    if (d.condicion && d.condicion.toUpperCase() !== "HABIDO") avisos.push(`condición ${d.condicion}`);

    return {
      ok: true,
      nombre: d.razon_social,
      direccion,
      ...(avisos.length ? { aviso: `Ojo: este RUC figura con ${avisos.join(" y ")} en SUNAT.` } : {}),
    };
  } catch {
    return { ok: false, error: "No hay conexión para consultar. Escribe el nombre a mano." };
  }
}

/* ============================================================
   CONFIGURACIÓN DEL NEGOCIO Y DE SUNAT
   ============================================================ */

export type ConfigVista = {
  ruc: string;
  razon_social: string;
  nombre_comercial: string;
  direccion: string;
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  urbanizacion: string;
  codigo_local: string;
  telefono: string;
  afectacion: string;
  leyenda_amazonia: boolean;
  serie_boleta: string;
  serie_factura: string;
  whatsapp_contadora: string;
  ambiente: "BETA" | "PRODUCCION";
  usuario_sol: string;
  tiene_clave_sol: boolean;
  certificado_titular: string | null;
  certificado_vence: string | null;
  hay_llave: boolean;
  hay_admin: boolean;
};

export async function leerConfiguracion(): Promise<{ ok: boolean; error?: string; config?: ConfigVista }> {
  if (!(await conSesion())) return { ok: false, error: "Inicia sesión." };

  const admin = crearClienteAdmin();
  if (!admin) return { ok: false, error: MENSAJE_FALTA_CLAVE };

  const { data, error } = await admin.from("sunat_config").select("*").eq("id", 1).maybeSingle();
  if (error) return { ok: false, error: `${error.message}. ¿Ejecutaste el script 01_mitayo.sql?` };

  const c = (data ?? {}) as Record<string, unknown>;
  const t = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");

  return {
    ok: true,
    config: {
      ruc: t("ruc"),
      razon_social: t("razon_social"),
      nombre_comercial: t("nombre_comercial"),
      direccion: t("direccion"),
      ubigeo: t("ubigeo"),
      departamento: t("departamento"),
      provincia: t("provincia"),
      distrito: t("distrito"),
      urbanizacion: t("urbanizacion"),
      codigo_local: t("codigo_local") || "0000",
      telefono: t("telefono"),
      afectacion: t("afectacion") || "20",
      leyenda_amazonia: c.leyenda_amazonia !== false,
      serie_boleta: t("serie_boleta") || "B001",
      serie_factura: t("serie_factura") || "F001",
      whatsapp_contadora: t("whatsapp_contadora"),
      ambiente: t("ambiente") === "PRODUCCION" ? "PRODUCCION" : "BETA",
      usuario_sol: t("usuario_sol"),
      tiene_clave_sol: Boolean(c.clave_sol_cifrada),
      certificado_titular: (c.certificado_titular as string | null) ?? null,
      certificado_vence: (c.certificado_vence as string | null) ?? null,
      hay_llave: Boolean(process.env.SUNAT_LLAVE),
      hay_admin: true,
    },
  };
}

function may(t: string): string {
  return t.replace(/\s+/g, " ").trim().toUpperCase();
}

export type DatosNegocio = {
  ruc: string;
  razon_social: string;
  nombre_comercial: string;
  direccion: string;
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  urbanizacion: string;
  codigo_local: string;
  telefono: string;
  afectacion: string;
  leyenda_amazonia: boolean;
  serie_boleta: string;
  serie_factura: string;
  whatsapp_contadora: string;
};

export async function guardarNegocio(d: DatosNegocio): Promise<Respuesta> {
  const s = await conSesion();
  if (!s) return { ok: false, error: "Inicia sesión." };
  const admin = crearClienteAdmin();
  if (!admin) return { ok: false, error: MENSAJE_FALTA_CLAVE };

  const ruc = d.ruc.replace(/\D/g, "");
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return { ok: false, error: "El RUC debe tener 11 dígitos." };
  if (!/^\d{6}$/.test(d.ubigeo.trim())) return { ok: false, error: "El ubigeo debe tener 6 dígitos (ej. 160113 para San Juan Bautista)." };
  if (!/^\d{4}$/.test(d.codigo_local.trim())) return { ok: false, error: "El código de local debe tener 4 dígitos (normalmente 0000)." };
  if (may(d.razon_social).length < 3 || may(d.direccion).length < 5) return { ok: false, error: "Completa la razón social y la dirección." };
  if (!["10", "20"].includes(d.afectacion)) return { ok: false, error: "Elige si vendes exonerado o con IGV." };

  const sb = may(d.serie_boleta);
  const sf = may(d.serie_factura);
  if (!/^B[A-Z0-9]{3}$/.test(sb)) return { ok: false, error: "La serie de boleta debe empezar con B y tener 4 caracteres (ej. B001)." };
  if (!/^F[A-Z0-9]{3}$/.test(sf)) return { ok: false, error: "La serie de factura debe empezar con F y tener 4 caracteres (ej. F001)." };

  const wsp = d.whatsapp_contadora.replace(/\D/g, "");
  if (wsp && wsp.length !== 9 && !(wsp.length === 11 && wsp.startsWith("51"))) {
    return { ok: false, error: "El WhatsApp debe tener 9 dígitos (ej. 965001274)." };
  }

  const { error } = await admin
    .from("sunat_config")
    .update({
      ruc,
      razon_social: may(d.razon_social),
      nombre_comercial: d.nombre_comercial.replace(/\s+/g, " ").trim() || null,
      direccion: may(d.direccion),
      ubigeo: d.ubigeo.trim(),
      departamento: may(d.departamento),
      provincia: may(d.provincia),
      distrito: may(d.distrito),
      urbanizacion: may(d.urbanizacion) || null,
      codigo_local: d.codigo_local.trim(),
      telefono: d.telefono.trim() || null,
      afectacion: d.afectacion,
      leyenda_amazonia: d.leyenda_amazonia,
      serie_boleta: sb,
      serie_factura: sf,
      whatsapp_contadora: wsp ? wsp.slice(-9) : null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/protected/configuracion");
  return { ok: true };
}

export async function subirCertificado(pfxBase64: string, clave: string): Promise<Respuesta> {
  const s = await conSesion();
  if (!s) return { ok: false, error: "Inicia sesión." };
  const admin = crearClienteAdmin();
  if (!admin) return { ok: false, error: MENSAJE_FALTA_CLAVE };

  if (!pfxBase64 || pfxBase64.length > 200_000) return { ok: false, error: "El archivo del certificado no es válido." };

  let cert: ReturnType<typeof leerCertificado>;
  try {
    cert = leerCertificado(pfxBase64, clave);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer el certificado." };
  }

  let pfxCifrado: string;
  let claveCifrada: string;
  try {
    pfxCifrado = cifrar(pfxBase64);
    claveCifrada = cifrar(clave);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo cifrar." };
  }

  const cfg = await admin.from("sunat_config").select("ruc").eq("id", 1).maybeSingle();
  const rucConfig = (cfg.data as { ruc: string | null } | null)?.ruc ?? null;

  const { error } = await admin
    .from("sunat_config")
    .update({
      certificado_cifrado: pfxCifrado,
      certificado_clave_cifrada: claveCifrada,
      certificado_titular: cert.titular,
      certificado_vence: cert.venceEn,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/protected/configuracion");

  const avisos: string[] = [];
  if (new Date(cert.venceEn).getTime() < Date.now()) avisos.push("¡Ojo! Este certificado ya venció.");
  if (cert.ruc && rucConfig && cert.ruc !== rucConfig) avisos.push(`El certificado es del RUC ${cert.ruc}, pero el negocio tiene el RUC ${rucConfig}.`);

  return { ok: true, aviso: avisos.join(" ") || undefined };
}

export async function guardarClaveSol(usuario: string, clave: string): Promise<Respuesta> {
  const s = await conSesion();
  if (!s) return { ok: false, error: "Inicia sesión." };
  const admin = crearClienteAdmin();
  if (!admin) return { ok: false, error: MENSAJE_FALTA_CLAVE };

  const u = usuario.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(u)) return { ok: false, error: "Escribe solo el usuario secundario (sin el RUC), por ejemplo MITAYO01." };

  const cambios: Record<string, string> = { usuario_sol: u, actualizado_en: new Date().toISOString() };

  if (clave) {
    try {
      cambios.clave_sol_cifrada = cifrar(clave);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "No se pudo cifrar." };
    }
  }

  const { error } = await admin.from("sunat_config").update(cambios).eq("id", 1);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/protected/configuracion");
  return { ok: true };
}

export async function cambiarAmbiente(ambiente: "BETA" | "PRODUCCION"): Promise<Respuesta> {
  const s = await conSesion();
  if (!s) return { ok: false, error: "Inicia sesión." };
  const admin = crearClienteAdmin();
  if (!admin) return { ok: false, error: MENSAJE_FALTA_CLAVE };

  if (ambiente === "PRODUCCION") {
    const cfg = await admin
      .from("sunat_config")
      .select("ruc, usuario_sol, clave_sol_cifrada, certificado_cifrado, certificado_clave_cifrada")
      .eq("id", 1)
      .maybeSingle();

    const c = cfg.data as {
      ruc: string | null;
      usuario_sol: string | null;
      clave_sol_cifrada: string | null;
      certificado_cifrado: string | null;
      certificado_clave_cifrada: string | null;
    } | null;

    if (!c?.ruc || !c.usuario_sol || !c.clave_sol_cifrada || !c.certificado_cifrado || !c.certificado_clave_cifrada) {
      return { ok: false, error: "Antes de pasar a producción completa el RUC, el certificado y el usuario SOL." };
    }

    try {
      descifrar(c.clave_sol_cifrada);
      leerCertificado(descifrar(c.certificado_cifrado), descifrar(c.certificado_clave_cifrada));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "El certificado o la clave no se pueden leer." };
    }
  }

  const { error } = await admin.from("sunat_config").update({ ambiente, actualizado_en: new Date().toISOString() }).eq("id", 1);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/protected/configuracion");
  return { ok: true };
}
