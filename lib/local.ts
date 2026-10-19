/* ============================================================
   DATOS GUARDADOS EN EL CELULAR (IndexedDB)
   - productos: el catálogo, para buscar y vender sin internet
   - cola: ventas cobradas que todavía no subieron a la nube
   - kv: datos del negocio, último número de boleta/factura, etc.
   ============================================================ */

export type Producto = { id: number; codigo: string; nombre: string; unidad: string; precio: number; categoria?: string };

export type Cliente = { tipo_doc: "0" | "1" | "6" | "4"; numero: string; nombre: string; direccion?: string | null };

export type Linea = {
  producto_id: number | null;
  codigo: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precio: number;
  importe: number;
};

export type Contexto = {
  emisor: {
    ruc: string;
    razon_social: string;
    nombre_comercial: string;
    direccion: string;
    lugar: string;
    telefono: string;
    leyenda_amazonia: boolean;
    afectacion: string;
  };
  ambiente: "BETA" | "PRODUCCION";
  series: { "03": string; "01": string };
  ultimos: { "03": number; "01": number };
  whatsapp: string;
};

export type VentaLocal = {
  uid: string;
  fecha: string; // ISO
  tipo: "03" | "01";
  serie: string;
  numero: number;
  metodo_pago: string;
  cliente: Cliente;
  lineas: Linea[];
  total: number;
  sin_conexion: boolean;
  estado: "PENDIENTE" | "ERROR";
  error?: string;
  intentos: number;
};

const NOMBRE_BD = "mitayo";
const VERSION_BD = 1;

let abriendo: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (abriendo) return abriendo;

  abriendo = new Promise<IDBDatabase>((resolver, rechazar) => {
    if (typeof indexedDB === "undefined") {
      rechazar(new Error("Este navegador no permite guardar datos en el equipo."));
      return;
    }

    const p = indexedDB.open(NOMBRE_BD, VERSION_BD);

    p.onupgradeneeded = () => {
      const bd = p.result;
      if (!bd.objectStoreNames.contains("kv")) bd.createObjectStore("kv");
      if (!bd.objectStoreNames.contains("cola")) bd.createObjectStore("cola", { keyPath: "uid" });
      if (!bd.objectStoreNames.contains("productos")) bd.createObjectStore("productos", { keyPath: "id" });
    };

    p.onsuccess = () => {
      const bd = p.result;
      bd.onversionchange = () => {
        bd.close();
        abriendo = null;
      };
      resolver(bd);
    };

    p.onerror = () => {
      abriendo = null;
      rechazar(p.error ?? new Error("No se pudo abrir el almacenamiento del equipo."));
    };
  });

  return abriendo;
}

function pedido<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    r.onsuccess = () => resolver(r.result);
    r.onerror = () => rechazar(r.error);
  });
}

function terminar(tx: IDBTransaction): Promise<void> {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error ?? new Error("Operación cancelada."));
  });
}

/* ---------- clave → valor ---------- */

export async function leer<T>(clave: string): Promise<T | null> {
  const bd = await abrir();
  const v = await pedido(bd.transaction("kv", "readonly").objectStore("kv").get(clave));
  return (v ?? null) as T | null;
}

export async function guardar(clave: string, valor: unknown): Promise<void> {
  const bd = await abrir();
  const tx = bd.transaction("kv", "readwrite");
  tx.objectStore("kv").put(valor, clave);
  await terminar(tx);
}

/* ---------- catálogo ---------- */

export async function productosGuardados(): Promise<Producto[]> {
  const bd = await abrir();
  return (await pedido(bd.transaction("productos", "readonly").objectStore("productos").getAll())) as Producto[];
}

export async function reemplazarProductos(lista: Producto[]): Promise<void> {
  const bd = await abrir();
  const tx = bd.transaction("productos", "readwrite");
  const st = tx.objectStore("productos");
  st.clear();
  for (const p of lista) st.put(p);
  await terminar(tx);
}

export async function guardarProducto(p: Producto): Promise<void> {
  const bd = await abrir();
  const tx = bd.transaction("productos", "readwrite");
  tx.objectStore("productos").put(p);
  await terminar(tx);
}

export async function quitarProducto(id: number): Promise<void> {
  const bd = await abrir();
  const tx = bd.transaction("productos", "readwrite");
  tx.objectStore("productos").delete(id);
  await terminar(tx);
}

/* ---------- ventas por subir ---------- */

export async function ventasPorSubir(): Promise<VentaLocal[]> {
  const bd = await abrir();
  const lista = (await pedido(bd.transaction("cola", "readonly").objectStore("cola").getAll())) as VentaLocal[];
  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export async function guardarVentaLocal(v: VentaLocal): Promise<void> {
  const bd = await abrir();
  const tx = bd.transaction("cola", "readwrite");
  tx.objectStore("cola").put(v);
  await terminar(tx);
}

export async function quitarVentaLocal(uid: string): Promise<void> {
  const bd = await abrir();
  const tx = bd.transaction("cola", "readwrite");
  tx.objectStore("cola").delete(uid);
  await terminar(tx);
}

/* ---------- numeración en el celular ---------- */

/* Siguiente número de la serie: el mayor entre el que dice la nube y el último usado aquí */
export async function tomarNumero(serie: string, ambiente: string, ultimoNube: number): Promise<number> {
  const clave = `numero:${ambiente}:${serie}`;
  const local = (await leer<number>(clave)) ?? 0;
  const siguiente = Math.max(local, ultimoNube) + 1;
  await guardar(clave, siguiente);
  return siguiente;
}

export async function subirContador(serie: string, ambiente: string, numero: number): Promise<void> {
  const clave = `numero:${ambiente}:${serie}`;
  const local = (await leer<number>(clave)) ?? 0;
  if (numero > local) await guardar(clave, numero);
}

export function nuevoUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------- preferencias de este equipo (localStorage) ---------- */

export type Impresion = { modo: "RAWBT" | "NAVEGADOR" | "NINGUNA"; columnas: 48 | 32 };

export function leerImpresion(): Impresion {
  try {
    const v = JSON.parse(localStorage.getItem("mitayo_impresion") ?? "null") as Impresion | null;
    if (v && (v.modo === "RAWBT" || v.modo === "NAVEGADOR" || v.modo === "NINGUNA")) {
      return { modo: v.modo, columnas: v.columnas === 32 ? 32 : 48 };
    }
  } catch {
    // nada
  }

  /* Computadora: imprime directo en la ticketera de 80 mm.
     Celular: no imprime, el comprobante se envía por WhatsApp. */
  const celular = typeof navigator !== "undefined" && /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  return { modo: celular ? "NINGUNA" : "NAVEGADOR", columnas: 48 };
}

export function guardarImpresion(v: Impresion) {
  try {
    localStorage.setItem("mitayo_impresion", JSON.stringify(v));
  } catch {
    // nada
  }
}
