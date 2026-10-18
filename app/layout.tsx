import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: 'Multiservicios "El Mitayo"',
  description: "Ventas, boletas y facturas de Multiservicios El Mitayo",
  applicationName: "El Mitayo",
  appleWebApp: { capable: true, title: "El Mitayo", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b8336a",
};

const geist = Geist({ variable: "--font-geist-sans", display: "swap", subsets: ["latin"] });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geist.className} bg-[#fdf1f5] text-[#4a1830] antialiased`}>{children}</body>
    </html>
  );
}
