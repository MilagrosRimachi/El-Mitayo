/* Unidades de medida (catálogo 03 de SUNAT) */
export const UNIDADES: Array<[string, string]> = [
  ["NIU", "Unidad"],
  ["KGM", "Kilo"],
  ["MTR", "Metro"],
  ["LTR", "Litro"],
  ["BX", "Caja"],
  ["PK", "Paquete"],
];

const CORTA: Record<string, string> = { NIU: "und", KGM: "kg", MTR: "m", LTR: "L", BX: "caja", PK: "paq" };

export function unidadCorta(u: string): string {
  return CORTA[u] ?? u.toLowerCase();
}

export function nombreUnidad(u: string): string {
  return UNIDADES.find(([c]) => c === u)?.[1] ?? u;
}

/* Kilo, metro y litro se venden con decimales (ej. 0.250 kg) */
export function seVendePorMedida(u: string): boolean {
  return u === "KGM" || u === "MTR" || u === "LTR";
}
