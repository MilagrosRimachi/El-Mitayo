"use client";

import { useEffect } from "react";
import { actualizarCatalogo, bajarContexto, enviarPendientesSunat, haySinConexion, subirPendientes } from "@/lib/sincronizar";
import { leer } from "@/lib/local";

const CADA_MS = 3 * 60 * 1000;

/*
 * Trabaja por detrás mientras la plataforma está abierta:
 * sube las ventas, envía los comprobantes a SUNAT y mantiene al día
 * el catálogo y los datos del negocio en el celular.
 */
export default function Sincronizador() {
  useEffect(() => {
    let vivo = true;

    // Guarda la plataforma en el celular para que abra sin internet
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          const urls = performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .filter((u) => u.includes("/_next/static/"));
          reg.active?.postMessage({ tipo: "guardar", urls, paginas: ["/protected/vender", "/protected/ventas"] });
        })
        .catch(() => {});
    }

    async function vuelta(completa: boolean) {
      if (!vivo) return;
      await bajarContexto().catch(() => null);
      if (haySinConexion()) return;

      await subirPendientes().catch(() => []);

      // El catálogo se revisa al abrir y cada 10 minutos; solo se baja si cambió
      const ultimo = await leer<string>("catalogo_en").catch(() => null);
      if (completa || !ultimo || Date.now() - new Date(ultimo).getTime() > 10 * 60 * 1000) {
        const cambio = await actualizarCatalogo().catch(() => false);
        if (cambio) window.dispatchEvent(new Event("mitayo:catalogo"));
      }

      await enviarPendientesSunat().catch(() => {});
      window.dispatchEvent(new Event("mitayo:sincronizado"));
    }

    const primera = setTimeout(() => void vuelta(true), 1500);
    const intervalo = setInterval(() => void vuelta(false), CADA_MS);
    const alVolver = () => setTimeout(() => void vuelta(false), 3000);
    const pedida = () => void vuelta(false);

    window.addEventListener("online", alVolver);
    window.addEventListener("mitayo:sincronizar", pedida);

    return () => {
      vivo = false;
      clearTimeout(primera);
      clearInterval(intervalo);
      window.removeEventListener("online", alVolver);
      window.removeEventListener("mitayo:sincronizar", pedida);
    };
  }, []);

  return null;
}
