"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { marcarEnviado, mesPorEnviar } from "@/lib/avisoContadora";
import { nombreMes } from "@/lib/registroVentas";

export default function AvisoContadora() {
  const [mes, setMes] = useState<string | null>(null);
  const ruta = usePathname();

  useEffect(() => {
    const revisar = () => setMes(mesPorEnviar());
    revisar();
    const t = setInterval(revisar, 5 * 60 * 1000);
    window.addEventListener("mitayo:contadora", revisar);
    return () => {
      clearInterval(t);
      window.removeEventListener("mitayo:contadora", revisar);
    };
  }, []);

  if (!mes) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5 lg:px-8">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-[#1d6b34] bg-[#e8f8ec] px-4 py-3">
        <span className="text-2xl" aria-hidden="true">
          📅
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-[#14532d]">
          ¡Fin de mes! Envía las ventas de <b>{nombreMes(mes)}</b> a la contadora.
        </p>
        {!ruta.startsWith("/protected/reporte") && (
          <Link href={`/protected/reporte?mes=${mes}`} className="h-10 rounded-xl bg-[#25a244] px-4 text-sm font-extrabold leading-10 text-white">
            Enviar ventas a contadora
          </Link>
        )}
        <button type="button" onClick={() => marcarEnviado(mes)} className="h-10 rounded-xl border-2 border-[#1d6b34] bg-white px-3 text-xs font-bold text-[#14532d]">
          Ya lo envié
        </button>
      </div>
    </div>
  );
}
