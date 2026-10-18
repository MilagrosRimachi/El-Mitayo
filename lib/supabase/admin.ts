import { createClient as crearClienteSupabase } from "@supabase/supabase-js";

/* Cliente con la «clave de servicio» de Supabase: SOLO en el servidor.
   Se usa para firmar y enviar a SUNAT y para leer la clave SOL y el certificado. */
export function crearClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !clave) return null;

  return crearClienteSupabase(url, clave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const MENSAJE_FALTA_CLAVE =
  "Falta la clave de servicio de Supabase (SUPABASE_SERVICE_ROLE_KEY) en el archivo .env.local y en Netlify.";
