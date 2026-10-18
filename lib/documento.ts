/* Validación de DNI y RUC (sirve sin internet) */

export type TipoDocumento = "DNI" | "RUC";

export const TOPE_BOLETA_SIN_DOCUMENTO = 700;

export function limpiarNumero(tipo: TipoDocumento, texto: string): string {
  return texto.replace(/\D/g, "").slice(0, tipo === "DNI" ? 8 : 11);
}

/* Dígito verificador del RUC (detecta errores de tipeo sin consultar) */
export function rucValido(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  let dv = 11 - (suma % 11);

  if (dv === 10) dv = 0;
  if (dv === 11) dv = 1;

  return dv === Number(ruc[10]);
}

/* null = el número está completo y bien escrito */
export function errorDocumento(tipo: TipoDocumento, numero: string): string | null {
  if (tipo === "DNI") return /^\d{8}$/.test(numero) ? null : "El DNI debe tener 8 dígitos.";
  if (!/^\d{11}$/.test(numero)) return "El RUC debe tener 11 dígitos.";
  return rucValido(numero) ? null : "Ese RUC no es válido. Revisa los números.";
}

export type ResultadoDocumento = {
  ok: boolean;
  error?: string;
  nombre?: string;
  direccion?: string;
  aviso?: string;
};
