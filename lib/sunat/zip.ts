/* ============================================================
   SUNAT: zip mínimo (SUNAT recibe el XML dentro de un .zip
   y responde la constancia CDR también en .zip)
   ============================================================ */

import { deflateRawSync, inflateRawSync } from "zlib";

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Un zip con un solo archivo, comprimido */
export function crearZip(nombre: string, contenido: string): Buffer {
  const datos = Buffer.from(contenido, "utf8");
  const comprimido = deflateRawSync(datos);
  const nombreB = Buffer.from(nombre, "utf8");
  const crc = crc32(datos);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt32LE(datos.length, 22);
  local.writeUInt16LE(nombreB.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0x21, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comprimido.length, 20);
  central.writeUInt32LE(datos.length, 24);
  central.writeUInt16LE(nombreB.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // posición del encabezado local

  const tamCentral = central.length + nombreB.length;
  const inicioCentral = local.length + nombreB.length + comprimido.length;

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(inicioCentral, 16);
  fin.writeUInt16LE(0, 20);

  return Buffer.concat([local, nombreB, comprimido, central, nombreB, fin]);
}

/* Lee los archivos de un zip usando el directorio central */
export function leerZip(zip: Buffer): Array<{ nombre: string; contenido: Buffer }> {
  let fin = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("La respuesta de SUNAT no es un zip válido.");

  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const archivos: Array<{ nombre: string; contenido: Buffer }> = [];

  for (let n = 0; n < total; n++) {
    const metodo = zip.readUInt16LE(p + 10);
    const tamComp = zip.readUInt32LE(p + 20);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComent = zip.readUInt16LE(p + 32);
    const posLocal = zip.readUInt32LE(p + 42);
    const nombre = zip.subarray(p + 46, p + 46 + largoNombre).toString("utf8");

    const lNombre = zip.readUInt16LE(posLocal + 26);
    const lExtra = zip.readUInt16LE(posLocal + 28);
    const inicio = posLocal + 30 + lNombre + lExtra;
    const crudo = zip.subarray(inicio, inicio + tamComp);

    archivos.push({ nombre, contenido: metodo === 8 ? inflateRawSync(crudo) : Buffer.from(crudo) });

    p += 46 + largoNombre + largoExtra + largoComent;
  }

  return archivos;
}
