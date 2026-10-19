import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /*
   * Solo la entrada y las pantallas de inicio de sesión pasan por aquí.
   * Las pantallas de trabajo (/protected/...) abren directo, sin esperar
   * al servidor: la sesión se revisa en el mismo equipo (ver Guardia) y
   * los datos los protege Supabase con sus reglas de seguridad.
   */
  matcher: ["/", "/auth/:path*"],
};
