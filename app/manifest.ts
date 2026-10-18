import type { MetadataRoute } from "next";

/* Para instalarla como aplicación (Chrome en Android: menú ⋮ → «Instalar aplicación») */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Multiservicios "El Mitayo"',
    short_name: "El Mitayo",
    description: "Ventas, boletas y facturas",
    start_url: "/protected/vender",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fdf1f5",
    theme_color: "#b8336a",
    lang: "es",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
