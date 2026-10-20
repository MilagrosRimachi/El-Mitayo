"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guardarImpresion, leerImpresion, type Impresion } from "@/lib/local";
import { imprimir, type DatosTicket } from "@/lib/ticket";
import {
  cambiarAmbiente,
  guardarClaveSol,
  guardarNegocio,
  leerConfiguracion,
  subirCertificado,
  type ConfigVista,
  type DatosNegocio,
} from "../acciones";

const caja = "rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm space-y-3";
const campo = "h-11 w-full rounded-lg border bg-white px-3";
const boton = "h-11 rounded-xl bg-[#b8336a] px-5 font-bold text-white disabled:opacity-50";

function Mensaje({ r }: { r: { ok: boolean; texto: string } | null }) {
  if (!r) return null;
  return <p className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{r.texto}</p>;
}

function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{etiqueta}</span>
      {children}
      {ayuda && <span className="block text-xs text-gray-500">{ayuda}</span>}
    </label>
  );
}

export default function Ajustes() {
  const [config, setConfig] = useState<ConfigVista | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  async function recargar() {
    const r = await leerConfiguracion().catch(() => ({ ok: false, error: "Sin internet. Conéctate para ver los ajustes del negocio." }));
    if (r.ok && "config" in r && r.config) setConfig(r.config);
    else setErrorCarga(r.error ?? "No se pudo cargar.");
  }

  useEffect(() => {
    void recargar();
  }, []);

  function avisarCambio() {
    window.dispatchEvent(new Event("mitayo:sincronizar"));
    void recargar();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Ajustes</h1>
      {errorCarga && <p className="rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">{errorCarga}</p>}
      {config && (
        <>
          <Estado config={config} />
          <Negocio config={config} alGuardar={avisarCambio} />
          <Certificado config={config} alGuardar={avisarCambio} />
          <ClaveSol config={config} alGuardar={avisarCambio} />
          <Ambiente config={config} alGuardar={avisarCambio} />
        </>
      )}
      <Impresora />
      <Sesion />
    </div>
  );
}

/* ---------- Resumen de lo que falta ---------- */
function Estado({ config }: { config: ConfigVista }) {
  const faltas: string[] = [];
  if (!config.hay_admin) faltas.push("Falta la clave SUPABASE_SERVICE_ROLE_KEY en Netlify.");
  if (!config.hay_llave) faltas.push("Falta la clave SUNAT_LLAVE en Netlify.");
  if (!/^\d{11}$/.test(config.ruc)) faltas.push("Falta el RUC y los datos del negocio.");
  if (!config.certificado_titular) faltas.push("Falta subir el certificado digital (.pfx).");
  if (!config.usuario_sol || !config.tiene_clave_sol) faltas.push("Falta el usuario secundario SOL y su clave.");
  if (!config.whatsapp_contadora) faltas.push("Falta el WhatsApp de la contadora (opcional).");

  return (
    <section className={caja}>
      <h2 className="font-bold">Estado</h2>
      <p className="text-sm">
        Envío a SUNAT:{" "}
        <b className={config.ambiente === "PRODUCCION" ? "text-green-700" : "text-orange-700"}>
          {config.ambiente === "PRODUCCION" ? "REAL (producción)" : "PRUEBAS (beta)"}
        </b>
      </p>
      {faltas.length === 0 ? (
        <p className="text-sm text-green-700">✅ Todo listo para emitir boletas y facturas.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm text-orange-800">
          {faltas.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Datos del negocio ---------- */
function Negocio({ config, alGuardar }: { config: ConfigVista; alGuardar: () => void }) {
  const [d, setD] = useState<DatosNegocio>({
    ruc: config.ruc,
    razon_social: config.razon_social,
    nombre_comercial: config.nombre_comercial,
    direccion: config.direccion,
    ubigeo: config.ubigeo || "160101",
    departamento: config.departamento || "LORETO",
    provincia: config.provincia || "MAYNAS",
    distrito: config.distrito || "IQUITOS",
    urbanizacion: config.urbanizacion,
    codigo_local: config.codigo_local || "0000",
    telefono: config.telefono,
    afectacion: config.afectacion || "20",
    leyenda_amazonia: config.leyenda_amazonia,
    serie_boleta: config.serie_boleta || "B001",
    serie_factura: config.serie_factura || "F001",
    whatsapp_contadora: config.whatsapp_contadora,
  });
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cambiar = (k: keyof DatosNegocio) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const res = await guardarNegocio(d).catch(() => ({ ok: false, error: "Sin internet." }) as { ok: boolean; error?: string; aviso?: string });
    setR(res.ok ? { ok: true, texto: res.aviso ?? "Guardado." } : { ok: false, texto: res.error ?? "No se pudo guardar." });
    setGuardando(false);
    if (res.ok) alGuardar();
  }

  return (
    <form onSubmit={guardar} className={caja}>
      <h2 className="font-bold">Datos del negocio</h2>
      <p className="text-xs text-gray-500">Salen en cada boleta y factura. Deben ser iguales a tu ficha RUC.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="RUC">
          <input className={campo} inputMode="numeric" maxLength={11} value={d.ruc} onChange={cambiar("ruc")} required />
        </Campo>
        <Campo etiqueta="Razón social">
          <input className={campo} value={d.razon_social} onChange={cambiar("razon_social")} required />
        </Campo>
        <Campo etiqueta="Nombre comercial">
          <input className={campo} value={d.nombre_comercial} onChange={cambiar("nombre_comercial")} placeholder='MULTISERVICIOS "EL MITAYO"' />
        </Campo>
        <Campo etiqueta="Teléfono (sale en el ticket)">
          <input className={campo} inputMode="tel" value={d.telefono} onChange={cambiar("telefono")} />
        </Campo>
        <Campo etiqueta="Dirección fiscal">
          <input className={campo} value={d.direccion} onChange={cambiar("direccion")} required />
        </Campo>
        <Campo etiqueta="Urbanización / sector (opcional)">
          <input className={campo} value={d.urbanizacion} onChange={cambiar("urbanizacion")} />
        </Campo>
        <Campo etiqueta="Distrito">
          <input className={campo} value={d.distrito} onChange={cambiar("distrito")} />
        </Campo>
        <Campo etiqueta="Provincia">
          <input className={campo} value={d.provincia} onChange={cambiar("provincia")} />
        </Campo>
        <Campo etiqueta="Departamento">
          <input className={campo} value={d.departamento} onChange={cambiar("departamento")} />
        </Campo>
        <Campo etiqueta="Ubigeo" ayuda="Iquitos 160101 · Punchana 160108 · Belén 160112 · San Juan 160113">
          <input className={campo} inputMode="numeric" maxLength={6} value={d.ubigeo} onChange={cambiar("ubigeo")} />
        </Campo>
        <Campo etiqueta="Código de establecimiento" ayuda="0000 si es el domicilio fiscal">
          <input className={campo} inputMode="numeric" maxLength={4} value={d.codigo_local} onChange={cambiar("codigo_local")} />
        </Campo>
        <Campo etiqueta="IGV">
          <select className={campo} value={d.afectacion} onChange={cambiar("afectacion")}>
            <option value="20">Exonerado (Amazonía)</option>
            <option value="10">Gravado (precios con IGV incluido)</option>
          </select>
        </Campo>
        <Campo etiqueta="Serie de boletas">
          <input className={campo} maxLength={4} value={d.serie_boleta} onChange={cambiar("serie_boleta")} />
        </Campo>
        <Campo etiqueta="Serie de facturas">
          <input className={campo} maxLength={4} value={d.serie_factura} onChange={cambiar("serie_factura")} />
        </Campo>
        <Campo etiqueta="WhatsApp de la contadora" ayuda="9 dígitos, sin +51">
          <input className={campo} inputMode="numeric" maxLength={9} value={d.whatsapp_contadora} onChange={cambiar("whatsapp_contadora")} />
        </Campo>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={d.leyenda_amazonia} onChange={cambiar("leyenda_amazonia")} />
        Poner la leyenda «Bienes transferidos en la Amazonía para ser consumidos en la misma»
      </label>
      <Mensaje r={r} />
      <button className={boton} disabled={guardando}>{guardando ? "Guardando…" : "Guardar datos"}</button>
    </form>
  );
}

/* ---------- Certificado digital ---------- */
function Certificado({ config, alGuardar }: { config: ConfigVista; alGuardar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState("");
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    if (!archivo) return;
    setSubiendo(true);
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await subirCertificado(btoa(bin), clave).catch(() => ({ ok: false, error: "Sin internet." }) as { ok: boolean; error?: string; aviso?: string });
    setR(res.ok ? { ok: true, texto: res.aviso ?? "Certificado guardado." } : { ok: false, texto: res.error ?? "No se pudo subir." });
    setSubiendo(false);
    if (res.ok) {
      setClave("");
      setArchivo(null);
      alGuardar();
    }
  }

  return (
    <form onSubmit={subir} className={caja}>
      <h2 className="font-bold">Certificado digital</h2>
      {config.certificado_titular ? (
        <p className="text-sm">
          ✅ {config.certificado_titular}
          {config.certificado_vence && <> · vence el {new Date(config.certificado_vence).toLocaleDateString("es-PE")}</>}
        </p>
      ) : (
        <p className="text-sm text-orange-800">Aún no hay certificado.</p>
      )}
      <input type="file" accept=".pfx,.p12" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
      <input className={campo} type="password" placeholder="Contraseña del certificado" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
      <Mensaje r={r} />
      <button className={boton} disabled={!archivo || !clave || subiendo}>{subiendo ? "Subiendo…" : "Subir certificado"}</button>
    </form>
  );
}

/* ---------- Usuario secundario SOL ---------- */
function ClaveSol({ config, alGuardar }: { config: ConfigVista; alGuardar: () => void }) {
  const [usuario, setUsuario] = useState(config.usuario_sol);
  const [clave, setClave] = useState("");
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const res = await guardarClaveSol(usuario, clave).catch(() => ({ ok: false, error: "Sin internet." }) as { ok: boolean; error?: string; aviso?: string });
    setR(res.ok ? { ok: true, texto: res.aviso ?? "Guardado." } : { ok: false, texto: res.error ?? "No se pudo guardar." });
    setGuardando(false);
    if (res.ok) {
      setClave("");
      alGuardar();
    }
  }

  return (
    <form onSubmit={guardar} className={caja}>
      <h2 className="font-bold">Usuario secundario SOL</h2>
      <p className="text-xs text-gray-500">
        El usuario que creas en SUNAT Operaciones en Línea con permiso de «Emisión electrónica». Solo el usuario (ej. MITAYO01), sin el RUC delante.
        {config.tiene_clave_sol && " Ya hay una clave guardada."}
      </p>
      <input className={campo} placeholder="Usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off" />
      <input className={campo} type="password" placeholder="Clave" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" />
      <Mensaje r={r} />
      <button className={boton} disabled={!usuario || !clave || guardando}>{guardando ? "Guardando…" : "Guardar usuario SOL"}</button>
    </form>
  );
}

/* ---------- Pruebas o real ---------- */
function Ambiente({ config, alGuardar }: { config: ConfigVista; alGuardar: () => void }) {
  const [r, setR] = useState<{ ok: boolean; texto: string } | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const destino = config.ambiente === "PRODUCCION" ? "BETA" : "PRODUCCION";

  async function cambiar() {
    const pregunta =
      destino === "PRODUCCION"
        ? "¿Empezar a enviar a SUNAT de verdad? Desde ahora cada boleta y factura vale ante SUNAT."
        : "¿Volver a modo pruebas? Las ventas NO se enviarán de verdad a SUNAT.";
    if (!window.confirm(pregunta)) return;
    setCambiando(true);
    const res = await cambiarAmbiente(destino).catch(() => ({ ok: false, error: "Sin internet." }) as { ok: boolean; error?: string; aviso?: string });
    setR(res.ok ? { ok: true, texto: res.aviso ?? "Cambiado." } : { ok: false, texto: res.error ?? "No se pudo cambiar." });
    setCambiando(false);
    if (res.ok) alGuardar();
  }

  return (
    <section className={caja}>
      <h2 className="font-bold">Modo de envío a SUNAT</h2>
      <p className="text-sm">
        Ahora: <b>{config.ambiente === "PRODUCCION" ? "REAL" : "PRUEBAS"}</b>.{" "}
        {config.ambiente === "BETA" && "Haz unas ventas de prueba y, cuando salgan bien, pásate a REAL."}
      </p>
      <Mensaje r={r} />
      <button type="button" onClick={cambiar} disabled={cambiando} className={destino === "PRODUCCION" ? boton : "h-11 rounded-xl border px-5 font-semibold"}>
        {destino === "PRODUCCION" ? "Pasar a REAL" : "Volver a PRUEBAS"}
      </button>
    </section>
  );
}

/* ---------- Impresora de este celular ---------- */
const PRUEBA: DatosTicket = {
  emisor: {
    ruc: "00000000000",
    razon_social: 'MULTISERVICIOS "EL MITAYO"',
    nombre_comercial: "",
    direccion: "Iquitos",
    lugar: "IQUITOS - MAYNAS - LORETO",
    telefono: "",
    leyenda_amazonia: true,
    afectacion: "20",
  },
  ambiente: "BETA",
  tipo: "03",
  serie: "B000",
  numero: 0,
  fecha: new Date().toISOString(),
  cliente: { tipo_doc: "0", numero: "-", nombre: "CLIENTES VARIOS" },
  lineas: [
    { producto_id: null, codigo: null, descripcion: "PRUEBA DE IMPRESIÓN - ÑANDÚ ÁÉÍÓÚ", unidad: "NIU", cantidad: 2, precio: 1.5, importe: 3 },
    { producto_id: null, codigo: null, descripcion: "CLAVO DE 2 PULGADAS", unidad: "KGM", cantidad: 0.5, precio: 8, importe: 4 },
  ],
  total: 7,
  metodo_pago: "EFECTIVO",
};

function Impresora() {
  const [p, setP] = useState<Impresion>({ modo: "NAVEGADOR", columnas: 48 });
  useEffect(() => setP(leerImpresion()), []);

  function cambiar(v: Impresion) {
    setP(v);
    guardarImpresion(v);
  }

  const opcion = (activa: boolean) => `min-h-11 rounded-xl border px-2 py-1 text-xs font-semibold sm:text-sm ${activa ? "border-[#b8336a] bg-[#b8336a] text-white" : "bg-white"}`;

  return (
    <details className="rounded-2xl border-2 border-[#f0bfd1] bg-white p-4 shadow-sm [&[open]>summary]:mb-3">
      <summary className="cursor-pointer font-bold">
        Ticketera (opcional) <span className="font-normal text-gray-500">· {p.modo === "NINGUNA" ? "no se imprime" : p.modo === "RAWBT" ? "Bluetooth" : "computadora"}</span>
      </summary>
      <div className="space-y-3">
      <p className="text-xs text-gray-500">Los comprobantes se envían por WhatsApp. Solo actívala si algún día conectas una ticketera.</p>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className={opcion(p.modo === "RAWBT")} onClick={() => cambiar({ ...p, modo: "RAWBT" })}>Bluetooth (RawBT)</button>
        <button type="button" className={opcion(p.modo === "NAVEGADOR")} onClick={() => cambiar({ ...p, modo: "NAVEGADOR" })}>Computadora</button>
        <button type="button" className={opcion(p.modo === "NINGUNA")} onClick={() => cambiar({ ...p, modo: "NINGUNA" })}>No imprimir</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={opcion(p.columnas === 48)} onClick={() => cambiar({ ...p, columnas: 48 })}>Papel 80 mm</button>
        <button type="button" className={opcion(p.columnas === 32)} onClick={() => cambiar({ ...p, columnas: 32 })}>Papel 58 mm</button>
      </div>
      {p.modo === "RAWBT" && (
        <div className="rounded-xl bg-[#fdf1f5] p-3 text-xs leading-relaxed">
          <b>Primera vez en el celular:</b> 1) Instala «RawBT» de Play Store. 2) Prende la ticketera y emparéjala por Bluetooth. 3) Abre RawBT → Ajustes →
          Impresora: elige tu ticketera; Ancho: {p.columnas === 48 ? "80 mm (48 caracteres)" : "58 mm (32 caracteres)"}. 4) Toca «Imprimir prueba» aquí abajo y marca
          «Recordar» para que no pregunte más.
        </div>
      )}
      <button type="button" disabled={p.modo === "NINGUNA"} onClick={() => imprimir({ ...PRUEBA, fecha: new Date().toISOString() })} className="h-11 rounded-xl border px-5 font-semibold disabled:opacity-50">
        Imprimir prueba
      </button>
      </div>
    </details>
  );
}

/* ---------- Salir ---------- */
function Sesion() {
  const [correo, setCorreo] = useState<string | null>(null);
  useEffect(() => {
    void createClient()
      .auth.getSession()
      .then(({ data }) => setCorreo(data.session?.user.email ?? null));
  }, []);

  async function salir() {
    if (!window.confirm("¿Cerrar sesión en este equipo?")) return;
    await createClient().auth.signOut();
    window.location.assign("/auth/login");
  }

  return (
    <section className={caja}>
      <h2 className="font-bold">Cuenta</h2>
      {correo && <p className="text-sm text-gray-600">{correo}</p>}
      <button type="button" onClick={salir} className="h-11 rounded-xl border border-red-300 px-5 font-semibold text-red-700">Cerrar sesión</button>
    </section>
  );
}
