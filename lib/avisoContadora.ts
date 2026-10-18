/* Aviso de fin de mes para enviar las ventas a la contadora.
   - Último día del mes, desde las 5 pm: ventas del mes que termina.
   - Del 1 al 5 del mes siguiente, si todavía no se envió: el mes anterior. */

const CLAVE = "mitayo_contadora_enviado";

function partesLima(d = new Date()) {
  const [a, m, dia, h] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .split(/[-, ]+/)
    .map(Number);
  return { a, m, dia, h };
}

function ym(a: number, m: number): string {
  return `${a}-${String(m).padStart(2, "0")}`;
}

export function mesYaEnviado(mes: string): boolean {
  try {
    return (localStorage.getItem(CLAVE) ?? "") >= mes;
  } catch {
    return false;
  }
}

export function marcarEnviado(mes: string) {
  try {
    if ((localStorage.getItem(CLAVE) ?? "") < mes) localStorage.setItem(CLAVE, mes);
    window.dispatchEvent(new Event("mitayo:contadora"));
  } catch {
    // nada
  }
}

/* Devuelve el mes (AAAA-MM) que toca enviar ahora, o null */
export function mesPorEnviar(ahora = new Date()): string | null {
  const { a, m, dia, h } = partesLima(ahora);
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  let mes: string | null = null;
  if (dia === ultimoDia && h >= 17) mes = ym(a, m);
  else if (dia <= 5) mes = m === 1 ? ym(a - 1, 12) : ym(a, m - 1);
  return mes && !mesYaEnviado(mes) ? mes : null;
}
