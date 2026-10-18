/* ============================================================
   SUNAT: cifrado de los datos secretos (certificado y claves)
   Se guardan cifrados en Supabase con una llave que solo vive en
   .env.local y en Netlify: SUNAT_LLAVE (32 bytes en base64).
   ============================================================ */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function llave(): Buffer {
  const texto = process.env.SUNAT_LLAVE;

  if (!texto) {
    throw new Error("Falta SUNAT_LLAVE en .env.local (y en Netlify). Revisa las instrucciones de la pantalla SUNAT.");
  }

  const b = Buffer.from(texto, "base64");

  if (b.length !== 32) {
    throw new Error("SUNAT_LLAVE no es válida: debe ser de 32 bytes en base64.");
  }

  return b;
}

export function hayLlave(): boolean {
  try {
    llave();
    return true;
  } catch {
    return false;
  }
}

/* Devuelve "iv.tag.datos" en base64 */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);

  return [iv.toString("base64"), c.getAuthTag().toString("base64"), datos.toString("base64")].join(".");
}

export function descifrar(guardado: string): string {
  const [iv, tag, datos] = guardado.split(".");

  if (!iv || !tag || !datos) throw new Error("Dato cifrado dañado.");

  try {
    const d = createDecipheriv("aes-256-gcm", llave(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));

    return Buffer.concat([d.update(Buffer.from(datos, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new Error("No se pudo descifrar: ¿cambió SUNAT_LLAVE? Vuelve a subir el certificado y la clave SOL.");
  }
}
