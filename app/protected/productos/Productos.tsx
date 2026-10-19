"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guardarProducto, quitarProducto } from "@/lib/local";
import { d2 } from "@/lib/ticket";
import { UNIDADES } from "@/lib/unidades";
import { CATEGORIAS, categoriaValida, iconoCategoria, nombreCategoria } from "@/lib/categorias";

type Fila = { id: number; codigo: string; nombre: string; unidad: string; precio: number; activo: boolean; categoria: string };


function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function num(t: string): number {
  const n = parseFloat(String(t).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export default function Productos() {
  const [todos, setTodos] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [editando, setEditando] = useState<Fila | null>(null);
  const [nuevo, setNuevo] = useState<{ nombre: string; precio: string; unidad: string; categoria: string } | null>(null);
  const [categoria, setCategoria] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [importando, setImportando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const sb = createClient();
    const lista: Fila[] = [];
    for (let desde = 0; desde < 50_000; desde += 1000) {
      const { data, error: e } = await sb
        .from("productos")
        .select("id, codigo, nombre, unidad, precio, activo, categoria")
        .order("nombre")
        .range(desde, desde + 999);
      if (e) {
        setError(`No se pudo cargar: ${e.message}`);
        break;
      }
      const filas = (data ?? []) as Fila[];
      lista.push(...filas.map((f) => ({ ...f, precio: Number(f.precio) })));
      if (filas.length < 1000) break;
    }
    setTodos(lista);
    setCargando(false);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const palabras = q ? q.split(/\s+/) : [];
    return todos
      .filter((p) => (verInactivos ? !p.activo : p.activo))
      .filter((p) => !categoria || (p.categoria || "OTROS") === categoria)
      .filter((p) => palabras.every((w) => normalizar(`${p.nombre} ${p.codigo}`).includes(w)))
      .slice(0, 200);
  }, [todos, busqueda, verInactivos, categoria]);

  const activos = todos.filter((p) => p.activo).length;

  async function guardarEdicion() {
    if (!editando) return;
    const precio = num(String(editando.precio));
    if (!editando.nombre.trim() || !Number.isFinite(precio) || precio < 0) {
      setMensaje("Revisa el nombre y el precio.");
      return;
    }
    setGuardando(true);
    const sb = createClient();
    const { error: e } = await sb
      .from("productos")
      .update({ nombre: editando.nombre.trim().toUpperCase(), precio: Math.round(precio * 100) / 100, unidad: editando.unidad, activo: editando.activo, categoria: editando.categoria || "OTROS", actualizado_en: new Date().toISOString() })
      .eq("id", editando.id);
    setGuardando(false);
    if (e) return setMensaje(e.message);

    const p = { ...editando, nombre: editando.nombre.trim().toUpperCase(), precio: Math.round(precio * 100) / 100 };
    setTodos((t) => t.map((x) => (x.id === p.id ? p : x)));
    if (p.activo) await guardarProducto({ id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, precio: p.precio, categoria: p.categoria }).catch(() => {});
    else await quitarProducto(p.id).catch(() => {});
    window.dispatchEvent(new Event("mitayo:catalogo"));
    setEditando(null);
    setMensaje("✔ Producto guardado.");
  }

  async function crear() {
    if (!nuevo) return;
    const precio = num(nuevo.precio);
    if (nuevo.nombre.trim().length < 2 || !Number.isFinite(precio) || precio < 0) {
      setMensaje("Escribe el nombre y el precio del producto nuevo.");
      return;
    }
    setGuardando(true);
    const sb = createClient();
    const cod = await sb.rpc("app_producto_codigo_nuevo");
    if (cod.error) {
      setGuardando(false);
      return setMensaje(cod.error.message);
    }
    const { data, error: e } = await sb
      .from("productos")
      .insert({ codigo: String(cod.data), nombre: nuevo.nombre.trim().toUpperCase(), precio: Math.round(precio * 100) / 100, unidad: nuevo.unidad, categoria: nuevo.categoria || "OTROS" })
      .select("id, codigo, nombre, unidad, precio, activo, categoria")
      .single();
    setGuardando(false);
    if (e) return setMensaje(e.message);

    const p = { ...(data as Fila), precio: Number((data as Fila).precio) };
    setTodos((t) => [p, ...t]);
    await guardarProducto({ id: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, precio: p.precio, categoria: p.categoria }).catch(() => {});
    window.dispatchEvent(new Event("mitayo:catalogo"));
    setNuevo(null);
    setMensaje(`✔ Producto creado con el código ${p.codigo}. Ya se puede vender.`);
  }

  /* Excel con las columnas del reporte (Código interno, Descripción, Unidad de medida, Precio) o Código, Nombre, Precio */
  async function importar(archivo: File) {
    setImportando(true);
    setMensaje(null);
    try {
      const XLSX = await import("xlsx");
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" }) as unknown[][];

      const clave = (v: unknown) => normalizar(String(v ?? "")).replace(/[^A-Z]/g, "");
      const filaTitulos = matriz.findIndex((r) => r.some((c) => ["DESCRIPCION", "NOMBRE"].includes(clave(c))) && r.some((c) => clave(c) === "PRECIO"));
      if (filaTitulos < 0) throw new Error("No encontré las columnas «Descripción» (o «Nombre») y «Precio».");

      const titulos = matriz[filaTitulos].map(clave);
      const col = (...nombres: string[]) => titulos.findIndex((t) => nombres.includes(t));
      const cCod = col("CODIGOINTERNO", "CODIGO");
      const cDesc = col("DESCRIPCION") >= 0 ? col("DESCRIPCION") : col("NOMBRE");
      const cNom = col("NOMBRE");
      const cUni = col("UNIDADDEMEDIDA", "UNIDAD");
      const cPre = col("PRECIO");
      const cCat = col("CATEGORIA");

      const filas = matriz
        .slice(filaTitulos + 1)
        .map((r) => ({
          codigo: cCod >= 0 ? String(r[cCod] ?? "").trim() : "",
          nombre: String((r[cDesc] as string) || (cNom >= 0 ? (r[cNom] as string) : "") || "").replace(/\s+/g, " ").trim(),
          unidad: cUni >= 0 ? String(r[cUni] ?? "").trim().toUpperCase() || "NIU" : "NIU",
          precio: num(String(r[cPre] ?? "")),
          categoria: cCat >= 0 ? categoriaValida(String(r[cCat] ?? "")) : null,
        }))
        .filter((f) => f.nombre && Number.isFinite(f.precio));

      if (filas.length === 0) throw new Error("El Excel no tiene productos con nombre y precio.");
      if (!window.confirm(`Se van a cargar ${filas.length} producto(s). Los que tienen un código que ya existe se actualizan (nombre y precio); los demás se crean. ¿Continuar?`)) return;

      const sb = createClient();
      let creados = 0;
      let actualizados = 0;
      let omitidos = 0;
      for (let i = 0; i < filas.length; i += 500) {
        const { data, error: e } = await sb.rpc("app_productos_importar", { p_filas: filas.slice(i, i + 500) });
        if (e) throw new Error(e.message);
        const r = data as { creados: number; actualizados: number; omitidos: number };
        creados += r.creados;
        actualizados += r.actualizados;
        omitidos += r.omitidos;
      }

      setMensaje(`✔ Listo: ${creados} nuevo(s), ${actualizados} actualizado(s)${omitidos ? `, ${omitidos} omitido(s) sin nombre o precio` : ""}.`);
      await cargar();
      window.dispatchEvent(new Event("mitayo:sincronizar"));
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo leer el Excel.");
    } finally {
      setImportando(false);
    }
  }

  async function descargar() {
    const XLSX = await import("xlsx");
    const hoja = XLSX.utils.aoa_to_sheet([
      ["Código", "Nombre", "Categoría", "Unidad", "Precio", "Activo"],
      ...todos.map((p) => [p.codigo, p.nombre, p.categoria || "OTROS", p.unidad, p.precio, p.activo ? "Sí" : "No"]),
    ]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Productos");
    XLSX.writeFile(libro, "productos-el-mitayo.xlsx");
  }

  const campo = "h-11 w-full rounded-xl border px-3";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Productos</h1>
          <p className="text-sm text-gray-600">{activos} productos a la venta</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setNuevo({ nombre: "", precio: "", unidad: "NIU", categoria: categoria || "FERRETERÍA" })} className="h-10 rounded-lg bg-[#b8336a] px-4 text-sm font-bold text-white">
            + Producto nuevo
          </button>
          <label className="flex h-10 cursor-pointer items-center rounded-lg border-2 border-[#b8336a] bg-white px-3 text-sm font-semibold text-[#5c1a37]">
            {importando ? "Cargando…" : "Subir Excel"}
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importando} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importar(f); }} />
          </label>
          <button type="button" onClick={descargar} className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold">
            Descargar Excel
          </button>
        </div>
      </div>

      {mensaje && <p className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm">{mensaje}</p>}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {nuevo && (
        <section className="space-y-3 rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Producto nuevo</h2>
          <div>
            <label htmlFor="n-nombre" className="mb-1 block text-sm">Nombre</label>
            <input id="n-nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className={campo} placeholder="Ej. MARTILLO DE UÑA 16 OZ" />
          </div>
          <div>
            <label htmlFor="n-cat" className="mb-1 block text-sm">Categoría</label>
            <select id="n-cat" value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} className={`${campo} bg-white`}>
              {CATEGORIAS.map((c) => <option key={c.nombre} value={c.nombre}>{c.icono} {nombreCategoria(c.nombre)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="n-precio" className="mb-1 block text-sm">Precio S/</label>
              <input id="n-precio" inputMode="decimal" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} className={campo} />
            </div>
            <div>
              <label htmlFor="n-unidad" className="mb-1 block text-sm">Se vende por</label>
              <select id="n-unidad" value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} className={`${campo} bg-white`}>
                {UNIDADES.map(([c, t]) => <option key={c} value={c}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={guardando} onClick={crear} className="h-11 rounded-xl bg-[#b8336a] px-5 font-semibold text-white disabled:opacity-50">
              {guardando ? "Guardando…" : "Crear producto"}
            </button>
            <button type="button" onClick={() => setNuevo(null)} className="h-11 rounded-xl border bg-white px-4">Cancelar</button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Buscar producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o código" className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-4" />
        <select aria-label="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-11 rounded-xl px-2">
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c.nombre} value={c.nombre}>{c.icono} {nombreCategoria(c.nombre)}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Ver los quitados de la venta
        </label>
      </div>

      <section className="rounded-2xl border-2 border-[#f0bfd1] bg-white shadow-sm">
        {cargando && <p className="p-6 text-center text-sm text-gray-500">Cargando…</p>}
        <ul className="divide-y">
          {visibles.map((p) =>
            editando && editando.id === p.id ? (
              <li key={p.id} className="space-y-2 p-3">
                <input aria-label="Nombre" value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} className={campo} />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-sm">
                    S/
                    <input aria-label="Precio" inputMode="decimal" value={String(editando.precio)} onChange={(e) => setEditando({ ...editando, precio: e.target.value as unknown as number })} className="h-10 w-24 rounded-lg border px-2" />
                  </label>
                  <select aria-label="Unidad" value={editando.unidad} onChange={(e) => setEditando({ ...editando, unidad: e.target.value })} className="h-10 rounded-lg border bg-white px-2">
                    {UNIDADES.map(([c, t]) => <option key={c} value={c}>{t}</option>)}
                  </select>
                  <select aria-label="Categoría" value={editando.categoria || "OTROS"} onChange={(e) => setEditando({ ...editando, categoria: e.target.value })} className="h-10 rounded-lg border bg-white px-2">
                    {CATEGORIAS.map((c) => <option key={c.nombre} value={c.nombre}>{c.icono} {nombreCategoria(c.nombre)}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editando.activo} onChange={(e) => setEditando({ ...editando, activo: e.target.checked })} />
                    A la venta
                  </label>
                  <button type="button" disabled={guardando} onClick={guardarEdicion} className="ml-auto h-10 rounded-lg bg-[#b8336a] px-4 text-sm font-semibold text-white">Guardar</button>
                  <button type="button" onClick={() => setEditando(null)} className="h-10 rounded-lg border px-3 text-sm">Cancelar</button>
                </div>
              </li>
            ) : (
              <li key={p.id}>
                <button type="button" onClick={() => setEditando({ ...p })} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[#fdf1f5]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.nombre}</span>
                    <span className="text-xs text-gray-500">
                      {p.codigo} · {UNIDADES.find(([c]) => c === p.unidad)?.[1] ?? p.unidad} · {iconoCategoria(p.categoria)} {nombreCategoria(p.categoria)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-bold text-[#5c1a37]">S/ {d2(p.precio)}</span>
                    <span className="rounded-lg border-2 border-[#b8336a] px-2 py-1 text-xs font-bold text-[#b8336a]">✏ Editar</span>
                  </span>
                </button>
              </li>
            )
          )}
        </ul>
        {!cargando && visibles.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay productos con esa búsqueda.</p>}
        {visibles.length === 200 && <p className="p-3 text-center text-xs text-gray-500">Se muestran los primeros 200: escribe más para encontrar el que buscas.</p>}
      </section>
    </div>
  );
}
