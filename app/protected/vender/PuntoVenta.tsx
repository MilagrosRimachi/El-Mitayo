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
import { seVendePorMedida, unidadCorta, UNIDADES } from "@/lib/unidades";
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

/* Cuántas veces se vendió cada producto en este equipo: para mostrar primero los más usados */
function leerUso(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem("mitayo_uso") ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function sumarUso(id: number) {
  try {
    const u = leerUso();
    u[id] = (u[id] ?? 0) + 1;
    localStorage.setItem("mitayo_uso", JSON.stringify(u));
  } catch {
    // nada
  }
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
  const [editProd, setEditProd] = useState<{ id: number; nombre: string; precio: string } | null>(null);
  const [guardandoProd, setGuardandoProd] = useState(false);
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

  // El texto de búsqueda de cada producto se prepara una sola vez (más rápido en el celular)
  const indice = useMemo(() => productos.map((p) => normalizar(`${p.nombre} ${p.codigo}`)), [productos]);

  const [uso, setUso] = useState<Record<string, number>>({});
  useEffect(() => setUso(leerUso()), [resultado]);

  const encontrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) {
      // Sin búsqueda: los más vendidos en este equipo (o los primeros de la lista)
      const usados = productos.filter((p) => uso[p.id]).sort((a, b) => (uso[b.id] ?? 0) - (uso[a.id] ?? 0));
      return (usados.length ? usados : productos).slice(0, 24);
    }
    const palabras = q.split(/\s+/);
    const salida: Producto[] = [];
    for (let k = 0; k < productos.length; k++) {
      const p = productos[k];
      const texto = indice[k];
      if (palabras.every((w) => texto.includes(w))) {
        salida.push(p);
        if (salida.length >= 60) break;
      }
    }
    return salida;
  }, [busqueda, productos, indice, uso]);

  const total = useMemo(() => Math.round(carrito.reduce((s, i) => s + importeDe(i), 0) * 100) / 100, [carrito]);
  const vuelto = metodo === "EFECTIVO" && num(recibido) > 0 ? Math.round((num(recibido) - total) * 100) / 100 : null;

  function agregar(p: Producto) {
    setResultado(null);
    sumarUso(p.id);
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
    const el = document.getElementById(`cant-${foco}`) as HTMLInputElement | null;
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

  /* ✏ en la tarjeta: cambia el nombre y el precio del producto para siempre */
  async function guardarEdicionProducto(e: React.FormEvent) {
    e.preventDefault();
    if (!editProd) return;
    const nombreP = editProd.nombre.trim().replace(/\s+/g, " ").toUpperCase();
    const precioP = Math.round(num(editProd.precio) * 100) / 100;
    if (nombreP.length < 2 || !(precioP >= 0)) {
      setError("Escribe el nombre y el precio.");
      return;
    }
    if (haySinConexion()) {
      setError("Para cambiar un producto se necesita internet. Mientras tanto puedes cambiar el precio solo en esta venta, en el cuadro de la derecha.");
      return;
    }
    setGuardandoProd(true);
    const { error: er } = await createClient()
      .from("productos")
      .update({ nombre: nombreP, precio: precioP, actualizado_en: new Date().toISOString() })
      .eq("id", editProd.id);
    setGuardandoProd(false);
    if (er) {
      setError(`No se pudo guardar: ${er.message}`);
      return;
    }
    const anterior = productos.find((x) => x.id === editProd.id);
    if (anterior) {
      const nuevoP = { ...anterior, nombre: nombreP, precio: precioP };
      await guardarProducto(nuevoP).catch(() => {});
      setProductos((lista) => lista.map((x) => (x.id === nuevoP.id ? nuevoP : x)));
    }
    // Si ya estaba en la venta, se actualiza también ahí
    setCarrito((c) => c.map((i) => (i.producto_id === editProd.id ? { ...i, descripcion: nombreP, precio: d2(precioP) } : i)));
    setError(null);
    setEditProd(null);
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
  const etiquetaPagar = cobrando ? "Registrando…" : "PAGAR";
  const exonerado = ctx?.emisor.afectacion !== "10";
  const baseIgv = exonerado ? { base: total, igv: 0 } : { base: Math.round((total / 1.18) * 100) / 100, igv: Math.round((total - total / 1.18) * 100) / 100 };

  return (
    <div className="space-y-3 pb-24 lg:pb-0">
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
        {/* ================= IZQUIERDA: productos en tarjetas ================= */}
        <section className="min-w-0 space-y-3 lg:col-span-7 xl:col-span-8">
          <div className="flex gap-2">
            <input
              id="buscar"
              ref={buscador}
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setMarcado(0);
              }}
              onKeyDown={teclaBuscador}
              placeholder="🔍 Buscar producto por nombre o código…"
              aria-label="Buscar producto"
              autoComplete="off"
              inputMode="search"
              autoFocus
              className="h-12 min-w-0 flex-1 rounded-xl px-4 text-base"
            />
            <button
              type="button"
              onClick={() => setNuevo({ nombre: busqueda.trim(), unidad: "NIU", precio: "", guardar: true })}
              className="h-12 shrink-0 rounded-xl bg-[#b8336a] px-4 text-sm font-bold text-white"
            >
              + Nuevo
            </button>
          </div>

          {nuevo && (
            <form onSubmit={agregarNuevo} className="space-y-2 rounded-xl border-2 border-[#b8336a] bg-white p-3">
              <p className="text-sm font-bold text-[#5c1a37]">Producto nuevo</p>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_8rem]">
                <input
                  aria-label="Nombre del producto nuevo"
                  placeholder="Nombre, ej. CLAVO DE 3 PULGADAS"
                  value={nuevo.nombre}
                  onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                  className="h-10 w-full rounded-lg px-3"
                  autoFocus
                />
                <select aria-label="Se vende por" value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} className="h-10 rounded-lg px-2">
                  {UNIDADES.map(([c, t]) => (
                    <option key={c} value={c}>
                      Por {t.toLowerCase()}
                    </option>
                  ))}
                </select>
                <input aria-label="Precio" inputMode="decimal" placeholder="Precio S/" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} className="h-10 rounded-lg px-3" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[#b8336a]" checked={nuevo.guardar} onChange={(e) => setNuevo({ ...nuevo, guardar: e.target.checked })} />
                  Guardarlo en la lista de productos
                </label>
                <button type="submit" disabled={guardandoNuevo} className="ml-auto h-10 rounded-lg bg-[#b8336a] px-4 text-sm font-bold text-white disabled:opacity-60">
                  {guardandoNuevo ? "Guardando…" : "Agregar a la venta"}
                </button>
                <button type="button" onClick={() => setNuevo(null)} className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold">
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {cargando && <p className="text-sm text-gray-500">Cargando productos…</p>}
          {sinCatalogo && <p className="text-sm text-gray-600">Todavía no hay productos en este equipo. Si es la primera vez, espera unos segundos con internet.</p>}
          {busqueda.trim() && encontrados.length === 0 && !cargando && (
            <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-gray-500">
              No se encontró «{busqueda}». Toca <b>+ Nuevo</b> para agregarlo.
            </p>
          )}
          {!busqueda.trim() && encontrados.length > 0 && (
            <p className="text-xs font-semibold text-[#6e1f42]">{Object.keys(uso).length ? "Los más vendidos" : "Productos"} · escribe arriba para buscar entre {productos.length}</p>
          )}

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {encontrados.map((p, k) => (
              // En el celular, sin búsqueda, solo 8 tarjetas: así la venta queda a la vista
              <li key={p.id} className={!busqueda.trim() && k >= 8 ? "max-lg:hidden" : ""}>
                {editProd?.id === p.id ? (
                  /* ---- Cambiar nombre y precio del producto (queda guardado) ---- */
                  <form
                    onSubmit={guardarEdicionProducto}
                    className="flex h-full flex-col gap-2 rounded-xl border-2 border-[#b8336a] bg-white p-2 shadow"
                  >
                    <textarea
                      aria-label="Nombre del producto"
                      value={editProd.nombre}
                      onChange={(e) => setEditProd({ ...editProd, nombre: e.target.value })}
                      rows={3}
                      className="w-full resize-none rounded-lg px-2 py-1 text-[13px] font-bold uppercase"
                      autoFocus
                    />
                    <label className="flex items-center gap-1 text-sm font-semibold">
                      S/
                      <input
                        aria-label="Precio del producto"
                        inputMode="decimal"
                        value={editProd.precio}
                        onChange={(e) => setEditProd({ ...editProd, precio: e.target.value })}
                        className="h-9 min-w-0 flex-1 rounded-lg px-2 text-right"
                      />
                    </label>
                    <div className="flex gap-1">
                      <button type="submit" disabled={guardandoProd} className="h-9 flex-1 rounded-lg bg-[#b8336a] text-sm font-bold text-white disabled:opacity-60">
                        {guardandoProd ? "…" : "Guardar"}
                      </button>
                      <button type="button" onClick={() => setEditProd(null)} className="h-9 rounded-lg border bg-white px-2 text-sm font-semibold">
                        ✕
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    className={`flex h-full flex-col overflow-hidden rounded-xl border-2 bg-white shadow-sm ${
                      k === marcado && busqueda.trim() ? "border-[#b8336a]" : "border-[#f0bfd1] hover:border-[#b8336a]"
                    }`}
                    onMouseEnter={() => setMarcado(k)}
                  >
                    <button type="button" onClick={() => agregar(p)} className="flex-1 px-3 pb-2 pt-3 text-left active:bg-[#fde6ef]">
                      <span className="line-clamp-3 text-[13px] font-bold uppercase leading-tight text-[#4a1830]">{p.nombre}</span>
                      <span className="mt-1 block text-[11px] text-gray-500">{p.codigo}</span>
                    </button>
                    <div className="flex items-stretch bg-[#b8336a] text-white">
                      <button
                        type="button"
                        onClick={() => setEditProd({ id: p.id, nombre: p.nombre, precio: d2(p.precio) })}
                        className="flex items-center px-2.5 text-sm hover:bg-[#9c2a5a]"
                        aria-label={`Cambiar nombre o precio de ${p.nombre}`}
                        title="Cambiar nombre o precio"
                      >
                        ✏
                      </button>
                      <button type="button" onClick={() => agregar(p)} className="flex flex-1 items-center justify-between gap-1 py-2 pr-3 hover:bg-[#9c2a5a]">
                        <span className="text-[11px] font-semibold opacity-90">({p.unidad})</span>
                        <span className="text-sm font-extrabold">S/ {d2(p.precio)}</span>
                        <span className="text-base" aria-hidden="true">
                          🛒
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ================= DERECHA: cliente, productos elegidos y PAGAR ================= */}
        <aside className="min-w-0 lg:sticky lg:top-4 lg:col-span-5 xl:col-span-4">
          {resultado ? (
            <section className="space-y-3 rounded-2xl border-2 border-[#b8336a] bg-white p-4 shadow">
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
                <p className="rounded-xl border-2 border-[#b8336a] bg-[#fdf1f5] px-4 py-2 text-center text-2xl font-extrabold text-[#5c1a37]">Vuelto: S/ {d2(resultado.vuelto)}</p>
              )}
              <EnviarWhatsapp datos={resultado.ticket} alError={setError} />
              <div className="flex gap-2">
                <button type="button" onClick={() => imprimir(resultado.ticket, true)} className="h-12 rounded-xl border bg-white px-4 text-sm font-bold">
                  🖨 Imprimir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResultado(null);
                    buscador.current?.focus();
                  }}
                  className="h-12 flex-1 rounded-xl bg-[#b8336a] px-4 font-bold text-white"
                >
                  Nueva venta
                </button>
              </div>
            </section>
          ) : (
            <section className="flex flex-col overflow-hidden rounded-2xl border-2 border-[#b8336a] bg-white shadow lg:max-h-[calc(100svh-2rem)]">
              {/* ---- Arriba: cliente ---- */}
              <div className="space-y-2 border-b-2 border-[#f0bfd1] bg-[#fdf1f5] p-3">
                <div className="grid grid-cols-2 gap-2">
                  {(["03", "01"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTipo(t)}
                      className={`h-9 rounded-lg border-2 text-sm font-bold ${tipo === t ? "border-[#b8336a] bg-[#b8336a] text-white" : "border-[#b8336a] bg-white text-[#5c1a37]"}`}
                    >
                      {t === "03" ? "Boleta" : "Factura"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {tipo === "03" && (
                    <select aria-label="Tipo de documento" value={docTipo} onChange={(e) => setDocTipo(e.target.value as TipoDocumento)} className="h-10 rounded-lg px-1 text-sm">
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
                    className="h-10 min-w-0 flex-1 rounded-lg px-3"
                  />
                  <button type="button" onClick={buscarDocumento} disabled={buscandoDoc || !numDoc} className="h-10 rounded-lg border bg-white px-3 text-sm font-bold disabled:opacity-40">
                    {buscandoDoc ? "…" : "Buscar"}
                  </button>
                </div>
                {numDoc || tipo === "01" ? (
                  <>
                    <input aria-label="Nombre del cliente" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={tipo === "01" ? "Razón social" : "Nombre"} className="h-10 w-full rounded-lg px-3" />
                    {tipo === "01" && (
                      <input aria-label="Dirección del cliente" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección (opcional)" className="h-10 w-full rounded-lg px-3" />
                    )}
                  </>
                ) : (
                  <p className="text-xs font-semibold text-[#6e1f42]">👤 Clientes varios</p>
                )}
                {avisoDoc && <p className="text-xs text-orange-800">{avisoDoc}</p>}
              </div>

              {/* ---- Medio: productos elegidos ---- */}
              <div className="min-h-[8rem] flex-1 overflow-y-auto">
                {carrito.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-gray-500">Toca un producto para agregarlo aquí.</p>
                ) : (
                  <ul className="divide-y divide-[#f6d5e1]">
                    {carrito.map((i) => (
                      <li key={i.clave} className="flex items-center gap-2 px-3 py-2">
                        <div className="flex shrink-0 flex-col items-center">
                          <input
                            id={`cant-${i.clave}`}
                            aria-label={`Cantidad de ${i.descripcion}`}
                            inputMode="decimal"
                            value={i.cantidad}
                            onChange={(e) => cambiar(i.clave, { cantidad: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") buscador.current?.focus();
                            }}
                            className="h-9 w-14 rounded-lg px-1 text-center text-sm font-bold"
                          />
                          <span className="text-[10px] text-gray-500">{unidadCorta(i.unidad)}</span>
                        </div>
                        <p className="min-w-0 flex-1 text-[13px] font-semibold uppercase leading-tight">{i.descripcion}</p>
                        <div className="flex shrink-0 flex-col items-end">
                          <input
                            aria-label={`Precio de ${i.descripcion}`}
                            inputMode="decimal"
                            value={i.precio}
                            onChange={(e) => cambiar(i.clave, { precio: e.target.value })}
                            className="h-8 w-16 rounded-lg px-1 text-right text-xs"
                          />
                          <span className="text-sm font-extrabold text-[#5c1a37]">S/ {d2(importeDe(i))}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCarrito((c) => c.filter((x) => x.clave !== i.clave))}
                          className="h-8 w-8 shrink-0 rounded-lg text-lg text-red-700 hover:bg-red-50"
                          aria-label={`Quitar ${i.descripcion}`}
                        >
                          🗑
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* ---- Abajo: total, pago y PAGAR ---- */}
              <div className="space-y-2 border-t-2 border-[#f0bfd1] p-3">
                <div className="flex flex-wrap gap-1.5">
                  {METODOS.map(([codigo, texto]) => (
                    <button
                      key={codigo}
                      type="button"
                      onClick={() => setMetodo(codigo)}
                      className={`h-8 rounded-full border-2 px-3 text-xs font-bold ${metodo === codigo ? "border-[#b8336a] bg-[#b8336a] text-white" : "border-[#e9a9c1] bg-white text-[#5c1a37]"}`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                {metodo === "EFECTIVO" && (
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="recibido">Recibido S/</label>
                    <input id="recibido" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="opcional" className="h-9 w-24 rounded-lg px-2" />
                    {vuelto !== null && vuelto >= 0 && <span className="font-extrabold text-[#5c1a37]">Vuelto S/ {d2(vuelto)}</span>}
                  </div>
                )}
                <p className="flex justify-between text-xs text-gray-600">
                  <span>{exonerado ? "Op. exonerada" : `Op. gravada S/ ${d2(baseIgv.base)} · IGV`}</span>
                  <span>S/ {d2(exonerado ? baseIgv.base : baseIgv.igv)}</span>
                </p>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <button
                  type="button"
                  onClick={cobrar}
                  disabled={cobrando || carrito.length === 0}
                  className="hidden h-14 w-full items-center justify-between rounded-xl bg-[#b8336a] px-5 text-xl font-extrabold text-white disabled:opacity-50 lg:flex"
                >
                  <span>{etiquetaPagar}</span>
                  <span>S/ {d2(total)}</span>
                </button>
                {carrito.length > 0 && (
                  <button type="button" onClick={() => setCarrito([])} className="w-full text-center text-xs font-semibold text-red-700 hover:underline">
                    Vaciar la venta
                  </button>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Celular: PAGAR siempre a la vista */}
      {carrito.length > 0 && !resultado && (
        <div className="fixed inset-x-0 bottom-[62px] z-20 px-3 lg:hidden">
          <button
            type="button"
            onClick={cobrar}
            disabled={cobrando}
            className="flex h-14 w-full items-center justify-between rounded-2xl border-2 border-[#7d1f47] bg-[#b8336a] px-5 text-lg font-extrabold text-white shadow-lg disabled:opacity-60"
          >
            <span>
              {etiquetaPagar} <span className="text-sm font-semibold">({carrito.length})</span>
            </span>
            <span>S/ {d2(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
