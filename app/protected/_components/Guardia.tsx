"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/* Si no hay sesión en este equipo, manda a iniciar sesión.
   Se revisa en el mismo equipo (rápido y funciona sin internet). */
export default function Guardia() {
  useEffect(() => {
    const sb = createClient();
    void sb.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (!data.session) window.location.replace("/auth/login");
    });
    const { data } = sb.auth.onAuthStateChange((evento: string) => {
      if (evento === "SIGNED_OUT") window.location.replace("/auth/login");
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
