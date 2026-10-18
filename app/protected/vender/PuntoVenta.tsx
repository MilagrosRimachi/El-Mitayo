"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { consultarDocumento, enviarSunat } from "../acciones";
import {
  guardarVentaLocal,
  leer,
  nuevoUid,
  productosGuardados,
  tomarNumero,
  type Contexto,
  type Linea,
  type Producto,
  type VentaLocal,
  guardarProducto,
} from "@/lib/local";
import { bajarContexto, haySinConexion, subirVenta, useSinConexion } from "@/lib/sincronizar";
import { d2, imprimir, METODOS, numeroCompleto, type DatosTicket } from "@/lib/ticket";
import EnviarWhatsapp from "../_components/EnviarWhatsapp";
import { createClient } from "@/lib/supabase/client";
import { nombreUnidad, seVendePorMedida, unidadCorta, UNIDADES } from "@/lib/unidades";
import { errorDocumento, limpiarNumero, TOPE_BOLETA_SIN_DOCUMENTO, type ResultadoDocumento, type TipoDocumento } from "@/lib/documento";

type ItemCarrito = {
  clave: string;
  producto_id: number | null;
  codigo: string | null;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precio: string;
};

type Resultado = {
  ticket: DatosTicket;
  comprobanteId?: number | null;
  vuelto: number | null;
  sunat: "SUBIENDO" | "SIN_INTERNET" | "ENVIADO" | "EN_COLA" | "ERROR";
  mensaje?: string;
};

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function num(t: string): number {
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function importeDe(i: ItemCarrito): number {
  return Math.round(num(i.cantidad) * num(i.precio) * 100) / 100;
}

export default function PuntoVenta() {
  const sinConexion = useSinConexion();
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [tipo, setTipo] = useState<"03" | "01">("03");
  const [docTipo, setDocTipo] = useState<TipoDocumento>("DNI");
  const [numDoc, setNumDoc] = useState("");
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [buscandoDoc, setBuscandoDoc] = useState(false);
  const [avisoDoc, setAvisoDoc] = useState<string | null>(null);
  const [metodo, setMetodo] = useState("EFECTIVO");
  const [recibido, setRecibido] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [nuevo, setNuevo] = useState<{ nombre: string; unidad: string; precio: string; guardar: boolean } | null>(null);
  const [guardandoNuevo, setGuardandoNuevo] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const [foco, setFoco] = useState<string | null>(null);
  const buscador = useRef<HTMLInputElement>(null);

  const cargarLocal = useCallback(async () => {
    const [c, p] = await Promise.all([leer<Contexto>("contexto"), productosGuardados()]);
    setCtx(c);
    setProductos(p.sort((a, b) => a.nombre.localeCompare(b.nombre)));
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargarLocal();
    const recargar = () => void cargarLocal();
    window.addEventListener("mitayo:catalogo", recargar);
    window.addEventListener("mitayo:sincronizado", recargar);
    return () => {
      window.removeEventListener("mitayo:catalogo", recargar);
      window.removeEventListener("mitayo:sincronizado", recargar);
    };
  }, [cargarLocal]);

  // Factura: siempre con RUC
  useEffect(() => {
    if (tipo === "01") setDocTipo("RUC");
  }, [tipo]);

  const encontrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return [];
    const palabras = q.split(/\s+/);
    const salida: Producto[] = [];
    for (const p of productos) {
      const texto = normalizar(`${p.nombre} ${p.codigo}`);
      if (palabras.every((w) => texto.includes(w))) {
        salida.push(p);
        if (salida.length >= 40) break;
      }
    }
    return salida;
  }, [busqueda, productos]);

  const total = useMemo(() => Math.round(carrito.reduce((s, i) => s + importeDe(i), 0) * 100) / 100, [carrito]);
  const vuelto = metodo === "EFECTIVO" && num(recibido) > 0 ? Math.round((num(recibido) - total) * 100) / 100 : null;

  function agregar(p: Producto) {
    setResultado(null);
    const existe = carrito.find((i) => i.producto_id === p.id);
    if (existe) {
      setCarrito((c) => c.map((i) => (i.clave === existe.clave ? { ...i, cantidad: String(Math.round((num(i.cantidad) + 1) * 1000) / 1000) } : i)));
      setFoco(existe.clave);
    } else {
      const clave = nuevoUid();
      setCarrito((c) => [...c, { clave, producto_id: p.id, codigo: p.codigo, descripcion: p.nombre, unidad: p.unidad, cantidad: "1", precio: d2(p.precio) }]);
      // Por peso o medida: el cursor va a la cantidad para escribir los kilos o metros
      if (seVendePorMedida(p.unidad)) setFoco(clave);
    }
    setBusqueda("");
    setMarcado(0);
    if (!seVendePorMedida(p.unidad)) buscador.current?.focus();
  }

  useEffect(() => {
    if (!foco) return;
    const ancho = window.matchMedia("(min-width: 640px)").matches;
    const el = document.getElementById(`${ancho ? "cantd" : "cant"}-${foco}`) as HTMLInputElement | null;
    el?.focus();
    el?.select();
    setFoco(null);
  }, [foco, carrito]);

  /* Producto nuevo: se guarda en la lista (si hay internet) y entra a la venta */
  async function agregarNuevo(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevo) return;
    const nombreP = nuevo.nombre.trim().toUpperCase();
    const precioP = Math.round(num(nuevo.precio) * 100) / 100;
    if (nombreP.length < 2 || precioP <= 0) {
      setError("Escribe el nombre y el precio del producto nuevo.");
      return;
    }
    setError(null);
    let p: Producto | null = null;
    if (nuevo.guardar && !haySinConexion()) {
      setGuardandoNuevo(true);
      try {
        const sb = createClient();
        const cod = await sb.rpc("app_producto_codigo_nuevo");
        if (cod.error) throw new Error(cod.error.message);
        const ins = await sb
          .from("productos")
          .insert({ codigo: String(cod.data), nombre: nombreP, precio: precioP, unidad: nuevo.unidad })
          .select("id, codigo, nombre, unidad, precio")
          .single();
        if (ins.error) throw new Error(ins.error.message);
        const fila = ins.data as { id: number; codigo: string };
        p = { id: Number(fila.id), codigo: String(fila.codigo), nombre: nombreP, unidad: nuevo.unidad, precio: precioP };
        await guardarProducto(p).catch(() => {});
        setProductos((lista) => [...lista, p as Producto].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      } catch (er) {
        setError(`No se pudo guardar en la lista (${er instanceof Error ? er.message : "error"}); se agregó solo a esta venta.`);
      } finally {
        setGuardandoNuevo(false);
      }
    }
    const clave = nuevoUid();
    setCarrito((c) => [
      ...c,
      { clave, producto_id: p?.id ?? null, codigo: p?.codigo ?? null, descripcion: nombreP, unidad: nuevo.unidad, cantidad: "1", precio: d2(precioP) },
    ]);
    setFoco(clave);
    setNuevo(null);
    setResultado(null);
  }

  function teclaBuscador(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMarcado((m) => Math.min(m + 1, encontrados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMarcado((m) => Math.max(m - 1, 0));
    } else if (e.key === "Enter" && encontrados[marcado]) {
      e.preventDefault();
      agregar(encontrados[marcado]);
    }
  }

  function cambiar(clave: string, cambios: Partial<ItemCarrito>) {
    setCarrito((c) => c.map((i) => (i.clave === clave ? { ...i, ...cambios } : i)));
  }

  function sumar(clave: string, delta: number) {
    setCarrito((c) =>
      c.map((i) => (i.clave === clave ? { ...i, cantidad: String(Math.max(1, Math.round((num(i.cantidad) + delta) * 1000) / 1000)) } : i))
    );
  }

  async function buscarDocumento() {
    setAvisoDoc(null);
    const n = limpiarNumero(docTipo, numDoc);
    const problema = errorDocumento(docTipo, n);
    if (problema) {
      setAvisoDoc(problema);
      return;
    }
    if (haySinConexion()) {
      setAvisoDoc("Sin internet no se puede consultar: escribe el nombre a mano.");
      return;
    }
    setBuscandoDoc(true);
    const r: ResultadoDocumento = await consultarDocumento(docTipo, n).catch(() => ({ ok: false, error: "No se pudo consultar. Escribe el nombre a mano." }));
    setBuscandoDoc(false);
    if (r.ok) {
      setNombre(r.nombre ?? "");
      if (r.direccion) setDireccion(r.direccion);
      setAvisoDoc(r.aviso ?? null);
    } else {
      setAvisoDoc(r.error ?? "No se encontró.");
    }
  }

  function limpiarCliente() {
    setNumDoc("");
    setNombre("");
    setDireccion("");
    setAvisoDoc(null);
  }

  async function cobrar() {
    setError(null);
    let contexto = ctx;

    if (!contexto) contexto = await bajarContexto().catch(() => null);
    if (!contexto) {
      setError("Este equipo todavía no tiene los datos del negocio. Ábrelo una vez con internet.");
      return;
    }
    if (!contexto.emisor.ruc) {
      setError("Falta completar los datos del negocio (RUC, dirección) en Ajustes.");
      return;
    }
    if (carrito.length === 0) {
      setError("Agrega al menos un producto.");
      return;
    }
    if (carrito.some((i) => num(i.cantidad) <= 0 || num(i.precio) < 0)) {
      setError("Revisa las cantidades y los precios.");
      return;
    }
    if (total <= 0) {
      setError("El total debe ser mayor que cero.");
      return;
    }

    const n = limpiarNumero(docTipo, numDoc);
    const conDoc = n.length > 0;

    if (tipo === "01") {
      const p = errorDocumento("RUC", n);
      if (p) return setError(`Factura: ${p}`);
      if (nombre.trim().length < 3) return setError("Factura: escribe la razón social del cliente.");
    } else if (conDoc) {
      const p = errorDocumento(docTipo, n);
      if (p) return setError(p);
      if (nombre.trim().length < 3) return setError("Escribe el nombre del cliente (o borra el documento).");
    } else if (total > TOPE_BOLETA_SIN_DOCUMENTO) {
      return setError(`Las boletas de más de S/ ${TOPE_BOLETA_SIN_DOCUMENTO} necesitan el DNI del cliente.`);
    }

    if (metodo === "EFECTIVO" && num(recibido) > 0 && num(recibido) < total) {
      return setError("El monto recibido es menor que el total.");
    }

    setCobrando(true);

    try {
      const serie = contexto.series[tipo];
      const numero = await tomarNumero(serie, contexto.ambiente, contexto.ultimos[tipo]);
      const lineas: Linea[] = carrito.map((i) => ({
        producto_id: i.producto_id,
        codigo: i.codigo,
        descripcion: i.descripcion,
        unidad: i.unidad,
        cantidad: num(i.cantidad),
        precio: num(i.precio),
        importe: importeDe(i),
      }));

      const venta: VentaLocal = {
        uid: nuevoUid(),
        fecha: new Date().toISOString(),
        tipo,
        serie,
        numero,
        metodo_pago: metodo,
        cliente: conDoc
          ? { tipo_doc: docTipo === "RUC" ? "6" : "1", numero: n, nombre: nombre.trim().toUpperCase(), direccion: direccion.trim().toUpperCase() || null }
          : { tipo_doc: "0", numero: "00000000", nombre: "CLIENTES VARIOS" },
        lineas,
        total,
        sin_conexion: haySinConexion(),
        estado: "PENDIENTE",
        intentos: 0,
      };

      // 1) Queda guardada en el celular (no se pierde aunque se vaya el internet)
      await guardarVentaLocal(venta);

      // 2) El ticket sale al instante
      const ticket: DatosTicket = {
        emisor: contexto.emisor,
        ambiente: contexto.ambiente,
        tipo,
        serie,
        numero,
        fecha: venta.fecha,
        cliente: venta.cliente,
        lineas,
        total,
        metodo_pago: metodo,
        sin_conexion: venta.sin_conexion,
      };
      imprimir(ticket);

      setResultado({ ticket, vuelto, sunat: venta.sin_conexion ? "SIN_INTERNET" : "SUBIENDO" });
      setCarrito([]);
      setRecibido("");
      setMetodo("EFECTIVO");
      setTipo("03");
      setDocTipo("DNI");
      limpiarCliente();

      // 3) Por detrás: se sube a la nube y se envía a SUNAT
      if (!venta.sin_conexion) {
        void (async () => {
          const r = await subirVenta(venta);
          if (!r.ok) {
            setResultado((x) => (x && x.ticket.numero === numero ? { ...x, sunat: r.red ? "SIN_INTERNET" : "ERROR", mensaje: r.red ? undefined : r.error } : x));
            return;
          }
          setResultado((x) => (x && x.ticket.numero === numero ? { ...x, comprobanteId: r.comprobanteId } : x));
          if (r.renumerado) {
            setResultado((x) =>
              x && x.ticket.numero === numero
                ? { ...x, comprobanteId: r.comprobanteId, ticket: { ...x.ticket, numero: r.numero }, mensaje: `Ese número ya estaba usado: quedó como ${numeroCompleto(r.serie, r.numero)}. Vuelve a imprimirlo.` }
                : x
            );
          }
          const e = await enviarSunat(r.comprobanteId).catch(() => null);
          setResultado((x) =>
            x && (x.ticket.numero === numero || x.ticket.numero === r.numero)
              ? {
                  ...x,
                  sunat: e && e.ok && (e.estado === "ACEPTADO" || e.estado === "OBSERVADO") ? "ENVIADO" : e && e.ok && e.estado === "EN_COLA" ? "EN_COLA" : "ERROR",
                  mensaje: x.mensaje ?? (e && e.ok && e.estado !== "ACEPTADO" ? e.mensaje : e && !e.ok ? e.error : undefined),
                }
              : x
          );
        })();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la venta.");
    } finally {
      setCobrando(false);
    }
  }

  const sinCatalogo = !cargando && productos.length === 0;
  const etiquetaPagar = cobrando ? "Registrando…" : `Pagar ${tipo === "01" ? "factura" : "boleta"}`;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      {sinConexion && (
        <p className="rounded-xl border-2 border-[#b8336a] bg-[#fbe0ea] px-4 py-3 text-sm text-[#6e1f42]">
          <b>Sin internet.</b> Puedes seguir vendiendo: las ventas se guardan en este equipo y se envían solas a SUNAT al volver la señal.
        </p>
      )}

      {ctx && !ctx.emisor.ruc && (
        <p className="rounded-xl border-2 border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Antes de vender, completa los datos del negocio y de SUNAT en{" "}
          <Link href="/protected/configuracion" className="font-semibold underline">
            Ajustes
          </Link>
          .
        </p>
      )}

      {ctx?.ambiente === "BETA" && ctx.emisor.ruc && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-900">
          Modo <b>pruebas</b>: los comprobantes no tienen valor. Pásalo a producción en Ajustes cuando esté todo listo.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        {/* ================= IZQUIERDA: buscar productos ================= */}
        <section className="min-w-0 space-y-3 rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:col-span-5">
          <h1 className="text-xl font-extrabold">Vender</h1>
          <div>
            <label htmlFor="buscar" className="mb-1 block text-sm font-semibold">
              Buscar producto
            </label>
            <input
              id="buscar"
              ref={buscador}
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setMarcado(0);
              }}
              onKeyDown={teclaBuscador}
              placeholder="Nombre o código, ej. clavo 2"
              autoComplete="off"
              inputMode="search"
              autoFocus
              className="h-12 w-full rounded-xl px-4 text-base"
            />
          </div>

          {cargando && <p className="text-sm text-gray-500">Cargando productos…</p>}
          {sinCatalogo && <p className="text-sm text-gray-600">Todavía no hay productos en este equipo. Si es la primera vez, espera unos segundos con internet.</p>}

          {encontrados.length > 0 && (
            <ul className="max-h-[55vh] divide-y divide-[#f6d5e1] overflow-y-auto rounded-xl border-2 border-[#f0bfd1]">
              {encontrados.map((p, k) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => agregar(p)}
                    onMouseEnter={() => setMarcado(k)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left ${k === marcado ? "bg-[#fde6ef]" : "bg-white"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.nombre}</span>
                      <span className="text-xs text-gray-500">
                        {p.codigo} · por {nombreUnidad(p.unidad).toLowerCase()}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold text-[#5c1a37]">
                      S/ {d2(p.precio)}
                      <span className="text-xs font-normal text-gray-500">/{unidadCorta(p.unidad)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {busqueda.trim() && encontrados.length === 0 && !cargando && <p className="text-sm text-gray-500">No se encontró «{busqueda}».</p>}
          {!busqueda && productos.length > 0 && (
            <p className="text-xs text-gray-500">
              {productos.length} productos. Escribe parte del nombre; con las flechas ↑ ↓ eliges y con Enter lo agregas.
            </p>
          )}

          {nuevo ? (
            <form onSubmit={agregarNuevo} className="space-y-2 rounded-xl border-2 border-[#b8336a] bg-[#fdf1f5] p-3">
              <p className="text-sm font-bold text-[#5c1a37]">Producto nuevo</p>
              <input
                aria-label="Nombre del producto nuevo"
                placeholder="Nombre, ej. CLAVO DE 3 PULGADAS"
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                className="h-10 w-full rounded-lg px-3"
                autoFocus
              />
              <div className="flex gap-2">
                <select aria-label="Se vende por" value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} className="h-10 flex-1 rounded-lg px-2">
                  {UNIDADES.map(([c, t]) => (
                    <option key={c} value={c}>
                      Por {t.toLowerCase()}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Precio"
                  inputMode="decimal"
                  placeholder={`S/ por ${unidadCorta(nuevo.unidad)}`}
                  value={nuevo.precio}
                  onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })}
                  className="h-10 w-32 rounded-lg px-3"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[#b8336a]" checked={nuevo.guardar} onChange={(e) => setNuevo({ ...nuevo, guardar: e.target.checked })} />
                Guardarlo en la lista de productos
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={guardandoNuevo} className="h-10 flex-1 rounded-lg bg-[#b8336a] px-4 text-sm font-bold text-white disabled:opacity-60">
                  {guardandoNuevo ? "Guardando…" : "Agregar a la venta"}
                </button>
                <button type="button" onClick={() => setNuevo(null)} className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold">
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setNuevo({ nombre: busqueda.trim(), unidad: "NIU", precio: "", guardar: true })}
              className="w-full rounded-xl border border-dashed bg-white px-3 py-2.5 text-sm font-bold"
            >
              + Producto nuevo (no está en la lista)
            </button>
          )}
        </section>

        {/* ================= DERECHA: comprobante ================= */}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          {resultado && (
            <section className="space-y-3 rounded-2xl border-2 border-[#b8336a] bg-white p-4 shadow">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#2e7d4a]">✔ Venta registrada</p>
                  <p className="text-xl font-extrabold text-[#5c1a37]">
                    {numeroCompleto(resultado.ticket.serie, resultado.ticket.numero)} · S/ {d2(resultado.ticket.total)}
                  </p>
                  <p className="text-sm text-gray-700">
                    {resultado.sunat === "SUBIENDO" && "Enviando a SUNAT…"}
                    {resultado.sunat === "ENVIADO" && "✔ Aceptado por SUNAT"}
                    {resultado.sunat === "EN_COLA" && "⏳ En cola para SUNAT (se envía solo)"}
                    {resultado.sunat === "SIN_INTERNET" && "📴 Guardado en este equipo: se envía al volver el internet"}
                    {resultado.sunat === "ERROR" && "⏳ Pendiente de envío a SUNAT (se reintenta solo)"}
                  </p>
                  {resultado.mensaje && <p className="mt-1 text-xs text-gray-600">{resultado.mensaje}</p>}
                </div>
                {resultado.vuelto !== null && resultado.vuelto > 0 && (
                  <p className="rounded-xl border-2 border-[#b8336a] bg-[#fdf1f5] px-4 py-2 text-2xl font-extrabold text-[#5c1a37]">Vuelto: S/ {d2(resultado.vuelto)}</p>
                )}
              </div>
              <EnviarWhatsapp datos={resultado.ticket} alError={setError} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => imprimir(resultado.ticket, true)} className="h-11 rounded-xl border bg-white px-4 text-sm font-bold">
                  🖨 Imprimir
                </button>
                <button type="button" onClick={() => setResultado(null)} className="h-11 flex-1 rounded-xl bg-[#b8336a] px-4 text-sm font-bold text-white">
                  Nueva venta
                </button>
              </div>
            </section>
          )}

          <section className="rounded-2xl border-2 border-[#f0bfd1] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b-2 border-[#f0bfd1] px-4 py-3">
              <h2 className="font-extrabold">Productos de la venta</h2>
              {carrito.length > 0 && (
                <button type="button" onClick={() => setCarrito([])} className="text-xs font-semibold text-red-700 hover:underline">
                  Vaciar
                </button>
              )}
            </div>

            {carrito.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-gray-500">Busca un producto a la izquierda y tócalo para agregarlo aquí.</p>
            ) : (
              <>
              {/* Celular: una tarjeta por producto */}
              <ul className="divide-y divide-[#f6d5e1] sm:hidden">
                {carrito.map((i) => (
                  <li key={i.clave} className="space-y-2 px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{i.descripcion}</p>
                      <button type="button" onClick={() => setCarrito((c) => c.filter((x) => x.clave !== i.clave))} className="h-8 w-8 shrink-0 rounded-lg text-lg text-red-700" aria-label={`Quitar ${i.descripcion}`}>
                        ×
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id={`cant-${i.clave}`}
                        aria-label={`Cantidad de ${i.descripcion}`}
                        inputMode="decimal"
                        value={i.cantidad}
                        onChange={(e) => cambiar(i.clave, { cantidad: e.target.value })}
                        className="h-10 w-20 rounded-lg px-1 text-center font-bold"
                      />
                      <span className="text-xs text-gray-500">{unidadCorta(i.unidad)} ×</span>
                      <input
                        aria-label={`Precio de ${i.descripcion}`}
                        inputMode="decimal"
                        value={i.precio}
                        onChange={(e) => cambiar(i.clave, { precio: e.target.value })}
                        className="h-10 w-20 rounded-lg px-2 text-right"
                      />
                      <span className="ml-auto whitespace-nowrap font-extrabold text-[#5c1a37]">S/ {d2(importeDe(i))}</span>
                    </div>
                  </li>
                ))}
                <li className="flex items-center justify-between border-t-2 border-[#b8336a] bg-[#fdf1f5] px-3 py-3">
                  <span className="font-bold text-[#5c1a37]">TOTAL</span>
                  <span className="text-xl font-extrabold text-[#5c1a37]">S/ {d2(total)}</span>
                </li>
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide">
                      <th className="px-3 py-2 font-bold">Cantidad</th>
                      <th className="px-3 py-2 font-bold">Producto</th>
                      <th className="px-3 py-2 text-right font-bold">Precio</th>
                      <th className="px-3 py-2 text-right font-bold">Total</th>
                      <th className="w-8 px-1 py-2">
                        <span className="sr-only">Quitar</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f6d5e1]">
                    {carrito.map((i) => (
                      <tr key={i.clave} className="align-middle">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => sumar(i.clave, -1)} className="hidden h-8 w-8 rounded-lg border bg-white text-base sm:block" aria-label="Uno menos">
                              −
                            </button>
                            <input
                              id={`cantd-${i.clave}`}
                              aria-label={`Cantidad de ${i.descripcion}`}
                              inputMode="decimal"
                              value={i.cantidad}
                              onChange={(e) => cambiar(i.clave, { cantidad: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") buscador.current?.focus();
                              }}
                              className="h-9 w-[4.5rem] rounded-lg px-1 text-center font-bold"
                            />
                            <button type="button" onClick={() => sumar(i.clave, 1)} className="hidden h-8 w-8 rounded-lg border bg-white text-base sm:block" aria-label="Uno más">
                              +
                            </button>
                            <span className="w-8 text-xs text-gray-500">{unidadCorta(i.unidad)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-semibold">{i.descripcion}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            aria-label={`Precio de ${i.descripcion}`}
                            inputMode="decimal"
                            value={i.precio}
                            onChange={(e) => cambiar(i.clave, { precio: e.target.value })}
                            className="h-9 w-20 rounded-lg px-2 text-right"
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-extrabold text-[#5c1a37]">S/ {d2(importeDe(i))}</td>
                        <td className="px-1 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => setCarrito((c) => c.filter((x) => x.clave !== i.clave))}
                            className="h-8 w-8 rounded-lg text-lg text-red-700 hover:bg-red-50"
                            aria-label={`Quitar ${i.descripcion}`}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#b8336a] bg-[#fdf1f5]">
                      <td colSpan={3} className="px-3 py-3 text-right text-base font-bold text-[#5c1a37]">
                        TOTAL
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right text-xl font-extrabold text-[#5c1a37]">S/ {d2(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              </>
            )}
          </section>

          {/* ---------- Comprobante y pago ---------- */}
          {carrito.length > 0 && (
            <section className="space-y-4 rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm">
              <div className="grid grid-cols-2 gap-2">
                {(["03", "01"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={`h-11 rounded-xl border-2 text-sm font-bold ${tipo === t ? "border-[#b8336a] bg-[#b8336a] text-white" : "border-[#b8336a] bg-white text-[#5c1a37]"}`}
                  >
                    {t === "03" ? "Boleta" : "Factura"}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  {tipo === "03" && (
                    <select aria-label="Tipo de documento" value={docTipo} onChange={(e) => setDocTipo(e.target.value as TipoDocumento)} className="h-11 rounded-xl px-2">
                      <option value="DNI">DNI</option>
                      <option value="RUC">RUC</option>
                    </select>
                  )}
                  <input
                    aria-label={docTipo === "RUC" ? "RUC del cliente" : "DNI del cliente"}
                    value={numDoc}
                    onChange={(e) => setNumDoc(limpiarNumero(docTipo, e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void buscarDocumento();
                      }
                    }}
                    placeholder={tipo === "01" ? "RUC del cliente" : "DNI (opcional)"}
                    inputMode="numeric"
                    className="h-11 min-w-0 flex-1 rounded-xl px-3"
                  />
                  <button type="button" onClick={buscarDocumento} disabled={buscandoDoc || !numDoc} className="h-11 rounded-xl border bg-white px-4 text-sm font-bold disabled:opacity-40">
                    {buscandoDoc ? "…" : "Buscar"}
                  </button>
                </div>
                {(numDoc || tipo === "01") && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input aria-label="Nombre del cliente" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={tipo === "01" ? "Razón social" : "Nombre"} className="h-11 w-full rounded-xl px-3" />
                    {tipo === "01" && (
                      <input aria-label="Dirección del cliente" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección (opcional)" className="h-11 w-full rounded-xl px-3" />
                    )}
                  </div>
                )}
                {avisoDoc && <p className="text-xs text-orange-800">{avisoDoc}</p>}
              </div>

              <div>
                <p className="mb-1 text-sm font-semibold">Pago</p>
                <div className="flex flex-wrap gap-2">
                  {METODOS.map(([codigo, texto]) => (
                    <button
                      key={codigo}
                      type="button"
                      onClick={() => setMetodo(codigo)}
                      className={`h-10 rounded-full border-2 px-4 text-sm font-bold ${metodo === codigo ? "border-[#b8336a] bg-[#b8336a] text-white" : "border-[#e9a9c1] bg-white text-[#5c1a37]"}`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                {metodo === "EFECTIVO" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label htmlFor="recibido" className="text-sm">
                      Recibido S/
                    </label>
                    <input id="recibido" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="opcional" className="h-10 w-28 rounded-lg px-2" />
                    {vuelto !== null && vuelto >= 0 && <span className="text-base font-extrabold text-[#5c1a37]">Vuelto: S/ {d2(vuelto)}</span>}
                  </div>
                )}
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              {/* Computadora: botón aquí mismo */}
              <button
                type="button"
                onClick={cobrar}
                disabled={cobrando}
                className="hidden h-14 w-full items-center justify-between rounded-2xl bg-[#b8336a] px-6 text-lg font-extrabold text-white disabled:opacity-60 lg:flex"
              >
                <span>{etiquetaPagar}</span>
                <span>S/ {d2(total)}</span>
              </button>
            </section>
          )}

          {error && carrito.length === 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </div>

      {/* Celular: botón de pagar siempre a la vista */}
      {carrito.length > 0 && (
        <div className="fixed inset-x-0 bottom-[62px] z-20 px-3 lg:hidden">
          <button
            type="button"
            onClick={cobrar}
            disabled={cobrando}
            className="flex h-14 w-full items-center justify-between rounded-2xl border-2 border-[#7d1f47] bg-[#b8336a] px-5 text-lg font-extrabold text-white shadow-lg disabled:opacity-60"
          >
            <span>{etiquetaPagar}</span>
            <span>S/ {d2(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
