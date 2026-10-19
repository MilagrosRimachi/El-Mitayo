/* Categorías de productos (el nombre se guarda tal cual en la base de datos) */
export const CATEGORIAS: Array<{ nombre: string; icono: string }> = [
  { nombre: "FERRETERÍA", icono: "🔩" },
  { nombre: "HERRAMIENTAS", icono: "🔨" },
  { nombre: "ELECTRICIDAD", icono: "💡" },
  { nombre: "GASFITERÍA", icono: "🚰" },
  { nombre: "CONSTRUCCIÓN", icono: "🧱" },
  { nombre: "PINTURAS", icono: "🎨" },
  { nombre: "BAZAR", icono: "🍽️" },
  { nombre: "ABARROTES", icono: "🛒" },
  { nombre: "BEBIDAS Y LICORES", icono: "🥤" },
  { nombre: "GOLOSINAS Y SNACKS", icono: "🍬" },
  { nombre: "LIMPIEZA", icono: "🧽" },
  { nombre: "CUIDADO PERSONAL", icono: "🧴" },
  { nombre: "BOTICA", icono: "💊" },
  { nombre: "MOTOS Y AUTOS", icono: "🏍️" },
  { nombre: "MASCOTAS Y CAMPO", icono: "🐾" },
  { nombre: "OTROS", icono: "📦" },
];

export function iconoCategoria(c: string | null | undefined): string {
  return CATEGORIAS.find((x) => x.nombre === c)?.icono ?? "📦";
}

/* «FERRETERÍA» → «Ferretería» */
export function nombreCategoria(c: string | null | undefined): string {
  const t = (c || "OTROS").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* Para el Excel: acepta «ferreteria», «Ferretería», etc. */
export function categoriaValida(t: string): string | null {
  const limpio = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  if (!limpio) return null;
  const encontrada = CATEGORIAS.find((c) => c.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "") === limpio);
  return encontrada ? encontrada.nombre : t.toUpperCase().trim();
}
