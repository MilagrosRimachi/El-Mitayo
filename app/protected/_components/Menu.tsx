"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSinConexion } from "@/lib/sincronizar";

/* [ruta, texto largo, texto corto (celular), icono] */
const OPCIONES: Array<[string, string, string, string]> = [
  ["/protected/vender", "Vender", "Vender", "M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"],
  ["/protected/ventas", "Venta del día", "Del día", "M4 5h16v15H4V5Zm0 5h16M9 3v4M15 3v4M8 14h3M8 17h6"],
  ["/protected/comprobantes", "Comprobantes", "Boletas", "M7 3h10l2 3v15l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V6l2-3Zm2 6h6M9 12h6M9 15h4"],
  ["/protected/productos", "Productos", "Productos", "M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10"],
  ["/protected/reporte", "Reporte del mes", "Contadora", "M5 21V9M12 21V3M19 21v-7"],
  ["/protected/configuracion", "Ajustes", "Ajustes", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"],
];

function Icono({ d, className = "h-[22px] w-[22px]" }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* El menú lee «?vista=» para marcar «Por categoría» o «Todos» */
export function MenuConVista() {
  const vista = useSearchParams().get("vista");
  return <Menu vista={vista === "todos" ? "todos" : "categorias"} />;
}

export default function Menu({ vista = null }: { vista?: "categorias" | "todos" | null }) {
  const ruta = usePathname();
  const sinConexion = useSinConexion();

  return (
    <>
      {/* ---------- Computadora: menú a la izquierda ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r-2 border-[#b8336a] bg-[#f8d3e0] lg:flex">
        <div className="flex flex-col items-center gap-2 border-b-2 border-[#e79bb8] px-4 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-emblema.png" alt="" className="h-24 w-24 rounded-2xl border-2 border-[#b8336a] bg-[#f5eedd] object-cover" />
          <div className="text-center leading-tight">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8a2550]">Multiservicio</p>
            <p className="text-xl font-extrabold text-[#5c1a37]">&quot;El Mitayo&quot;</p>
          </div>
          {sinConexion && <span className="rounded-full bg-[#b8336a] px-3 py-1 text-xs font-bold text-white">Sin internet</span>}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Menú">
          {OPCIONES.map(([href, texto, , icono]) => {
            const activa = ruta.startsWith(href);
            const esVender = href === "/protected/vender";
            return (
              <div key={href}>
                <Link
                  href={esVender ? "/protected/vender?vista=categorias" : href}
                  className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-[15px] font-bold transition ${
                    activa
                      ? "border-[#b8336a] bg-[#b8336a] text-white shadow"
                      : "border-transparent text-[#5c1a37] hover:border-[#b8336a] hover:bg-white/70"
                  }`}
                >
                  <Icono d={icono} />
                  {texto}
                </Link>
                {esVender && (
                  <div className="ml-6 mt-1 space-y-1 border-l-2 border-[#e79bb8] pl-2">
                    {(
                      [
                        ["categorias", "🗂 Por categoría"],
                        ["todos", "📋 Todos los productos"],
                      ] as const
                    ).map(([v, t]) => {
                      const marcada = activa && vista === v;
                      return (
                        <Link
                          key={v}
                          href={`/protected/vender?vista=${v}`}
                          className={`block rounded-lg border-2 px-2.5 py-1.5 text-[13px] font-bold ${
                            marcada ? "border-[#b8336a] bg-white text-[#b8336a]" : "border-transparent text-[#5c1a37] hover:border-[#b8336a] hover:bg-white/70"
                          }`}
                        >
                          {t}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="border-t-2 border-[#e79bb8] p-3">
          <Link
            href="/protected/reporte"
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#1d6b34] bg-[#25a244] px-3 py-3 text-center text-sm font-extrabold leading-tight text-white shadow hover:bg-[#1f8f3c]"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
            </svg>
            Enviar ventas a contadora
          </Link>
        </div>
      </aside>

      {/* ---------- Celular y tablet: barra de arriba ---------- */}
      <header className="sticky top-0 z-30 border-b-2 border-[#b8336a] bg-[#f8d3e0] lg:hidden">
        <div className="flex items-center gap-3 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-emblema.png" alt="" className="h-11 w-11 rounded-xl border-2 border-[#b8336a] bg-[#f5eedd] object-cover" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.15em] text-[#8a2550]">Multiservicio</p>
            <p className="truncate font-extrabold text-[#5c1a37]">&quot;El Mitayo&quot;</p>
          </div>
          {sinConexion && <span className="rounded-full bg-[#b8336a] px-3 py-1 text-xs font-bold text-white">Sin internet</span>}
          <Link
            href="/protected/configuracion"
            aria-label="Ajustes"
            className={`rounded-xl border-2 p-2 ${ruta.startsWith("/protected/configuracion") ? "border-[#b8336a] bg-[#b8336a] text-white" : "border-[#b8336a] text-[#b8336a]"}`}
          >
            <Icono d={OPCIONES[5][3]} className="h-5 w-5" />
          </Link>
        </div>
      </header>

      {/* ---------- Celular: menú de abajo ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t-2 border-[#b8336a] bg-[#f8d3e0] lg:hidden" aria-label="Menú">
        {OPCIONES.slice(0, 5).map(([href, , corto, icono]) => {
          const activa = ruta.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${activa ? "bg-[#b8336a] text-white" : "text-[#5c1a37]"}`}
            >
              <Icono d={icono} />
              {corto}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
