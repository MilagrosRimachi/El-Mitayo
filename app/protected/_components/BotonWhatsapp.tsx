"use client";

import { useEffect, useRef, useState } from "react";
import { comprobantePdf, compartirPdf, textoMensaje } from "@/lib/comprobantePdf";
import type { DatosTicket } from "@/lib/ticket";

type Props = {
  /* Datos ya listos (se prepara el PDF en cuanto aparece el botón) */
  datos?: DatosTicket;
  /* O una función que los trae al tocar (por ejemplo, desde la nube) */
  traer?: () => Promise<DatosTicket | null>;
  grande?: boolean;
  /* Texto del botón mediano (por ejemplo «Compartir PDF») */
  etiqueta?: string;
  alError?: (texto: string) => void;
};

export function IconoWhatsapp({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

export default function BotonWhatsapp({ datos, traer, grande, etiqueta, alError }: Props) {
  const [estado, setEstado] = useState<"LISTO" | "ARMANDO" | "REPETIR">("LISTO");
  const archivo = useRef<{ clave: string; file: File; texto: string } | null>(null);
  // Si el navegador bloquea «Compartir» dos veces (ej. Brave en Windows): se descarga y se abre WhatsApp
  const bloqueos = useRef(0);

  const clave = datos ? `${datos.serie}-${datos.numero}-${datos.total}` : "";

  /* Se arma el PDF por adelantado para que al tocar se abra WhatsApp al toque */
  useEffect(() => {
    if (!datos) return;
    let vivo = true;
    // Un momento después, para que la pantalla de la venta aparezca primero
    const t = setTimeout(() => {
      void comprobantePdf(datos)
        .then((file) => {
          if (vivo) archivo.current = { clave, file, texto: textoMensaje(datos) };
        })
        .catch(() => undefined);
    }, 700);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [datos, clave]);

  async function tocar() {
    try {
      let a = archivo.current && (!datos || archivo.current.clave === clave) ? archivo.current : null;
      if (!a) {
        setEstado("ARMANDO");
        const d = datos ?? (traer ? await traer() : null);
        if (!d) return setEstado("LISTO");
        a = { clave, file: await comprobantePdf(d), texto: textoMensaje(d) };
        archivo.current = a;
      }
      const r = await compartirPdf(a.file, a.texto, bloqueos.current >= 2);
      if (r === "REPETIR") bloqueos.current++;
      setEstado(r === "REPETIR" ? "REPETIR" : "LISTO");
    } catch (e) {
      setEstado("LISTO");
      alError?.(e instanceof Error ? e.message : "No se pudo armar el PDF.");
    }
  }

  const texto = estado === "ARMANDO" ? "Preparando…" : estado === "REPETIR" ? "Listo: toca para enviar" : grande ? "Enviar por WhatsApp" : etiqueta ?? "";

  return (
    <button
      type="button"
      onClick={tocar}
      disabled={estado === "ARMANDO"}
      aria-label="Enviar por WhatsApp"
      className={
        grande
          ? "flex w-full items-center justify-center gap-2 rounded-xl bg-[#25a244] px-4 py-4 font-bold text-white disabled:opacity-60"
          : estado !== "LISTO" || etiqueta
          ? "flex items-center justify-center gap-2 rounded-xl bg-[#25a244] px-4 py-3 font-bold text-white disabled:opacity-60"
          : "flex h-9 w-9 items-center justify-center rounded-lg bg-[#25a244] text-white"
      }
    >
      <IconoWhatsapp className={grande ? "h-6 w-6" : "h-5 w-5"} />
      {texto && <span className={grande ? "text-lg" : "text-sm"}>{texto}</span>}
    </button>
  );
}
