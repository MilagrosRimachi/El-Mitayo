"use client";

import { useEffect, useState } from "react";
import { comprobantePdf, textoMensaje } from "@/lib/comprobantePdf";
import type { DatosTicket } from "@/lib/ticket";
import BotonWhatsapp, { IconoWhatsapp } from "./BotonWhatsapp";

/* ============================================================
   ENVIAR EL COMPROBANTE EN PDF POR WHATSAPP
   - Celular, y computadora con Chrome o Edge: se abre la ventana
     «Compartir» con el PDF ya adjunto → WhatsApp → eliges al
     cliente y envías. Le llega el archivo PDF, sin buscar carpetas.
   - Navegadores que no pueden compartir archivos (algunos Brave o
     Firefox): se descarga el PDF y se abre el chat del cliente.
   ============================================================ */

type Props = {
  datos?: DatosTicket;
  traer?: () => Promise<DatosTicket | null>;
  alError?: (t: string) => void;
};

function limpiar(t: string): string {
  const d = t.replace(/\D/g, "");
  return d.startsWith("51") && d.length === 11 ? d.slice(2) : d.slice(0, 9);
}

/* ¿Este navegador puede abrir «Compartir» con un archivo? */
function puedeCompartirArchivos(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    return !!nav.canShare && nav.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

export default function EnviarWhatsapp({ datos, traer, alError }: Props) {
  const [compartir, setCompartir] = useState<boolean | null>(null);
  const [numero, setNumero] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => setCompartir(puedeCompartirArchivos()), []);

  async function enviarDesdeComputadora(e: React.FormEvent) {
    e.preventDefault();
    setAviso(null);
    const n = limpiar(numero);
    if (n && !/^9\d{8}$/.test(n)) {
      setAviso("Escribe el celular de 9 dígitos (empieza con 9), o déjalo vacío para elegir el chat en WhatsApp.");
      return;
    }

    // La ventana se abre en el mismo toque (si no, el navegador la bloquea)
    const ventana = window.open("about:blank", "_blank");
    setTrabajando(true);
    try {
      const d = datos ?? (traer ? await traer() : null);
      if (!d) throw new Error("No se encontró la venta.");
      const archivo = await comprobantePdf(d);

      const url = URL.createObjectURL(archivo);
      const a = document.createElement("a");
      a.href = url;
      a.download = archivo.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const wa = `https://wa.me/${n ? `51${n}` : ""}?text=${encodeURIComponent(textoMensaje(d))}`;
      if (ventana) ventana.location.href = wa;
      else window.open(wa, "_blank");
      setAviso(`✔ Se descargó «${archivo.name}». En el chat toca 📎 (o arrastra el archivo) y envíalo.`);
    } catch (er) {
      ventana?.close();
      alError?.(er instanceof Error ? er.message : "No se pudo armar el PDF.");
    } finally {
      setTrabajando(false);
    }
  }

  if (compartir === null) return null;

  if (compartir) {
    return (
      <div className="space-y-1">
        <BotonWhatsapp datos={datos} traer={traer} grande alError={alError} />
        <p className="text-center text-xs text-gray-600">
          Se abre «Compartir» con el PDF → elige <b>WhatsApp</b> → busca al cliente (nombre o número) → enviar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border-2 border-[#25a244]/40 bg-[#effaf2] p-3">
      <form onSubmit={enviarDesdeComputadora} className="flex flex-wrap items-center gap-2">
        <label htmlFor="wa-num" className="flex items-center gap-1 text-sm font-bold text-[#1d6b34]">
          <IconoWhatsapp /> PDF por WhatsApp
        </label>
        <div className="flex min-w-[11rem] flex-1 items-center rounded-lg border-2 border-[#25a244]/50 bg-white">
          <span className="pl-2 text-sm text-gray-500">+51</span>
          <input
            id="wa-num"
            inputMode="tel"
            autoComplete="off"
            placeholder="Celular del cliente"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent px-2"
            style={{ border: 0, outline: "none" }}
          />
        </div>
        <button type="submit" disabled={trabajando} className="h-10 rounded-lg bg-[#25a244] px-4 text-sm font-bold text-white disabled:opacity-60">
          {trabajando ? "Preparando…" : "Enviar PDF"}
        </button>
      </form>
      <p className="text-xs text-[#1d6b34]">
        Este navegador no puede adjuntar el PDF solo: se descarga y se abre el chat (adjúntalo con 📎). Para que sea directo, abre la plataforma en{" "}
        <b>Google Chrome</b> o <b>Microsoft Edge</b>.
      </p>
      {aviso && <p className="text-xs font-semibold text-[#6e1f42]">{aviso}</p>}
    </div>
  );
}
