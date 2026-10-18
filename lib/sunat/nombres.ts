/* Nombres de los comprobantes (sin código de servidor: se usa también en el navegador) */

export function nombresDoc(tipo: string): { titulo: string; impreso: string } {
  if (tipo === "01") return { titulo: "FACTURA ELECTRÓNICA", impreso: "Factura Electrónica" };
  if (tipo === "07") return { titulo: "NOTA DE CRÉDITO ELECTRÓNICA", impreso: "Nota de Crédito Electrónica" };
  return { titulo: "BOLETA DE VENTA ELECTRÓNICA", impreso: "Boleta de Venta Electrónica" };
}

export const NOMBRE_DOC: Record<string, string> = { "0": "", "1": "DNI", "4": "C.E.", "6": "RUC" };
