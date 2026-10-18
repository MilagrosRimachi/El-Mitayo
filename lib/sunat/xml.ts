/* ============================================================
   SUNAT: XML del comprobante (UBL 2.1, boleta y factura)
   El XML se escribe ya "canonizado" (sin espacios entre etiquetas,
   sin etiquetas vacías abreviadas y con los atributos en orden),
   así la firma digital se calcula sobre exactamente este texto.
   ============================================================ */

export const NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  nc: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
};

/* Declaraciones de espacios de nombres en el orden que exige la canonización */
export function declaraciones(raiz: string): string {
  return `xmlns="${raiz}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}"`;
}

export const DECLARACIONES = declaraciones(NS.inv);

export const ID_FIRMA = "SignatureSP";

export type Emisor = {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  urbanizacion: string;
  codigoLocal: string;
};

export type LineaComprobante = {
  codigo: string; // código interno del producto
  descripcion: string;
  unidad?: string; // catálogo 03: NIU unidad, KGM kilo, MTR metro, LTR litro
  cantidad: number;
  importe: number; // total de la línea (precio final, ya con descuento)
};

export type ReferenciaNota = {
  tipo: string; // 01 o 03: comprobante que se anula
  serie: string;
  numero: number;
  motivoCodigo: string; // catálogo 09: 01 anulación, 06 devolución total
  motivoTexto: string;
};

export type DatosComprobante = {
  tipo: "01" | "03" | "07"; // 01 factura, 03 boleta, 07 nota de crédito
  referencia?: ReferenciaNota | null;
  serie: string;
  numero: number;
  fecha: string; // AAAA-MM-DD (hora de Lima)
  hora: string; // HH:MM:SS
  emisor: Emisor;
  cliente: { tipoDoc: string; numero: string; nombre: string; direccion?: string | null };
  lineas: LineaComprobante[];
  total: number;
  afectacion: string; // catálogo 07: 20 = exonerado
  leyendaAmazonia: boolean;
};

/* ---------- texto seguro para XML ---------- */

export function limpio(texto: string | null | undefined, max = 250): string {
  return String(texto ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function esc(texto: string | null | undefined, max = 250): string {
  return limpio(texto, max).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escAttr(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function m(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

function cant(n: number): string {
  // hasta 3 decimales, sin ceros sobrantes
  return String(Math.round(n * 1000) / 1000);
}

function precio(n: number): string {
  // precio unitario con hasta 6 decimales (para que cantidad x precio = importe)
  return String(Math.round(n * 1e6) / 1e6);
}

/* ---------- monto en letras ---------- */

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ",
  "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE",
  "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS",
  "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function menorMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";

  const c = Math.floor(n / 100);
  const r = n % 100;
  let t = "";

  if (r < 30) t = UNIDADES[r];
  else t = DECENAS[Math.floor(r / 10)] + (r % 10 ? " Y " + UNIDADES[r % 10] : "");

  return [CENTENAS[c], t].filter(Boolean).join(" ");
}

export function enteroEnLetras(n: number): string {
  if (n === 0) return "CERO";

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${menorMil(millones).replace(/UNO$/, "UN")} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${menorMil(miles).replace(/UNO$/, "UN")} MIL`);
  if (resto) partes.push(menorMil(resto));

  return partes.join(" ");
}

export function montoEnLetras(total: number): string {
  const centimos = Math.round(total * 100);
  const entero = Math.floor(centimos / 100);
  const dec = String(centimos % 100).padStart(2, "0");

  return `${enteroEnLetras(entero)} CON ${dec}/100 SOLES`;
}

/* ---------- XML ---------- */

const PEN = ' currencyID="PEN"';

function esquemaImpuesto(afectacion: string): { id: string; nombre: string; tipo: string } {
  if (afectacion.startsWith("1")) return { id: "1000", nombre: "IGV", tipo: "VAT" };
  if (afectacion.startsWith("3")) return { id: "9998", nombre: "INA", tipo: "FRE" };
  return { id: "9997", nombre: "EXO", tipo: "VAT" }; // 20 exonerado (Amazonía)
}

export function nombreArchivo(d: Pick<DatosComprobante, "emisor" | "tipo" | "serie" | "numero">): string {
  return `${d.emisor.ruc}-${d.tipo}-${d.serie}-${d.numero}`;
}

/*
 * Devuelve el XML SIN firma, con <ext:ExtensionContent></ext:ExtensionContent>
 * vacío donde luego va la firma. No incluye la cabecera <?xml ...?>.
 */
export function xmlSinFirma(d: DatosComprobante): string {
  const e = d.emisor;
  const imp = esquemaImpuesto(d.afectacion);

  if (imp.id === "1000") {
    throw new Error("Por ahora solo se emiten comprobantes exonerados o inafectos (sin IGV).");
  }

  const notas =
    `<cbc:Note languageLocaleID="1000">${esc(montoEnLetras(d.total))}</cbc:Note>` +
    (d.leyendaAmazonia && d.tipo !== "07"
      ? `<cbc:Note languageLocaleID="2001">BIENES TRANSFERIDOS EN LA AMAZONÍA REGIÓN SELVA PARA SER CONSUMIDOS EN LA MISMA</cbc:Note>`
      : "");

  const firma =
    `<cac:Signature><cbc:ID>${ID_FIRMA}</cbc:ID>` +
    `<cac:SignatoryParty><cac:PartyIdentification><cbc:ID>${esc(e.ruc)}</cbc:ID></cac:PartyIdentification>` +
    `<cac:PartyName><cbc:Name>${esc(e.razonSocial)}</cbc:Name></cac:PartyName></cac:SignatoryParty>` +
    `<cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#${ID_FIRMA}</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>` +
    `</cac:Signature>`;

  const emisor =
    `<cac:AccountingSupplierParty><cac:Party>` +
    `<cac:PartyIdentification><cbc:ID schemeID="6">${esc(e.ruc)}</cbc:ID></cac:PartyIdentification>` +
    (e.nombreComercial ? `<cac:PartyName><cbc:Name>${esc(e.nombreComercial)}</cbc:Name></cac:PartyName>` : "") +
    `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(e.razonSocial)}</cbc:RegistrationName>` +
    `<cac:RegistrationAddress>` +
    `<cbc:ID>${esc(e.ubigeo)}</cbc:ID>` +
    `<cbc:AddressTypeCode>${esc(e.codigoLocal || "0000")}</cbc:AddressTypeCode>` +
    `<cbc:CitySubdivisionName>${esc(e.urbanizacion || "-")}</cbc:CitySubdivisionName>` +
    `<cbc:CityName>${esc(e.provincia)}</cbc:CityName>` +
    `<cbc:CountrySubentity>${esc(e.departamento)}</cbc:CountrySubentity>` +
    `<cbc:District>${esc(e.distrito)}</cbc:District>` +
    `<cac:AddressLine><cbc:Line>${esc(e.direccion)}</cbc:Line></cac:AddressLine>` +
    `<cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>` +
    `</cac:RegistrationAddress></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>`;

  const c = d.cliente;
  const cliente =
    `<cac:AccountingCustomerParty><cac:Party>` +
    `<cac:PartyIdentification><cbc:ID schemeID="${escAttr(c.tipoDoc)}">${esc(c.numero)}</cbc:ID></cac:PartyIdentification>` +
    `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(c.nombre)}</cbc:RegistrationName>` +
    (c.direccion && limpio(c.direccion)
      ? `<cac:RegistrationAddress><cac:AddressLine><cbc:Line>${esc(c.direccion)}</cbc:Line></cac:AddressLine></cac:RegistrationAddress>`
      : "") +
    `</cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>`;

  const formaPago =
    d.tipo === "01"
      ? `<cac:PaymentTerms><cbc:ID>FormaPago</cbc:ID><cbc:PaymentMeansID>Contado</cbc:PaymentMeansID></cac:PaymentTerms>`
      : "";

  const esquema =
    `<cac:TaxScheme><cbc:ID>${imp.id}</cbc:ID><cbc:Name>${imp.nombre}</cbc:Name><cbc:TaxTypeCode>${imp.tipo}</cbc:TaxTypeCode></cac:TaxScheme>`;

  const total = m(d.total);

  const impuestos =
    `<cac:TaxTotal><cbc:TaxAmount${PEN}>0.00</cbc:TaxAmount>` +
    `<cac:TaxSubtotal><cbc:TaxableAmount${PEN}>${total}</cbc:TaxableAmount><cbc:TaxAmount${PEN}>0.00</cbc:TaxAmount>` +
    `<cac:TaxCategory>${esquema}</cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`;

  const totales =
    `<cac:LegalMonetaryTotal>` +
    `<cbc:LineExtensionAmount${PEN}>${total}</cbc:LineExtensionAmount>` +
    `<cbc:TaxInclusiveAmount${PEN}>${total}</cbc:TaxInclusiveAmount>` +
    `<cbc:PayableAmount${PEN}>${total}</cbc:PayableAmount>` +
    `</cac:LegalMonetaryTotal>`;

  const esNota = d.tipo === "07";
  const etiquetaLinea = esNota ? "CreditNoteLine" : "InvoiceLine";
  const etiquetaCantidad = esNota ? "CreditedQuantity" : "InvoicedQuantity";

  const lineas = d.lineas
    .map((l, i) => {
      const unit = l.cantidad > 0 ? l.importe / l.cantidad : 0;
      const imp2 = m(l.importe);

      return (
        `<cac:${etiquetaLinea}>` +
        `<cbc:ID>${i + 1}</cbc:ID>` +
        `<cbc:${etiquetaCantidad} unitCode="${/^[A-Z0-9]{2,3}$/.test(l.unidad ?? "") ? l.unidad : "NIU"}">${cant(l.cantidad)}</cbc:${etiquetaCantidad}>` +
        `<cbc:LineExtensionAmount${PEN}>${imp2}</cbc:LineExtensionAmount>` +
        `<cac:PricingReference><cac:AlternativeConditionPrice>` +
        `<cbc:PriceAmount${PEN}>${precio(unit)}</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode>` +
        `</cac:AlternativeConditionPrice></cac:PricingReference>` +
        `<cac:TaxTotal><cbc:TaxAmount${PEN}>0.00</cbc:TaxAmount>` +
        `<cac:TaxSubtotal><cbc:TaxableAmount${PEN}>${imp2}</cbc:TaxableAmount><cbc:TaxAmount${PEN}>0.00</cbc:TaxAmount>` +
        `<cac:TaxCategory><cbc:Percent>18</cbc:Percent><cbc:TaxExemptionReasonCode>${escAttr(d.afectacion)}</cbc:TaxExemptionReasonCode>${esquema}</cac:TaxCategory>` +
        `</cac:TaxSubtotal></cac:TaxTotal>` +
        `<cac:Item><cbc:Description>${esc(l.descripcion, 500)}</cbc:Description>` +
        (l.codigo ? `<cac:SellersItemIdentification><cbc:ID>${esc(l.codigo, 30)}</cbc:ID></cac:SellersItemIdentification>` : "") +
        `</cac:Item>` +
        `<cac:Price><cbc:PriceAmount${PEN}>${precio(unit)}</cbc:PriceAmount></cac:Price>` +
        `</cac:${etiquetaLinea}>`
      );
    })
    .join("");

  const ref = d.referencia;

  if (esNota && !ref) throw new Error("La nota de crédito necesita el comprobante que anula.");

  const referencia =
    esNota && ref
      ? `<cac:DiscrepancyResponse><cbc:ReferenceID>${esc(ref.serie)}-${ref.numero}</cbc:ReferenceID>` +
        `<cbc:ResponseCode>${esc(ref.motivoCodigo)}</cbc:ResponseCode>` +
        `<cbc:Description>${esc(ref.motivoTexto, 250)}</cbc:Description></cac:DiscrepancyResponse>` +
        `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(ref.serie)}-${ref.numero}</cbc:ID>` +
        `<cbc:DocumentTypeCode>${esc(ref.tipo)}</cbc:DocumentTypeCode></cac:InvoiceDocumentReference></cac:BillingReference>`
      : "";

  const raiz = esNota ? "CreditNote" : "Invoice";

  return (
    `<${raiz} ${declaraciones(esNota ? NS.nc : NS.inv)}>` +
    `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>` +
    `<cbc:UBLVersionID>2.1</cbc:UBLVersionID>` +
    `<cbc:CustomizationID>2.0</cbc:CustomizationID>` +
    `<cbc:ID>${esc(d.serie)}-${d.numero}</cbc:ID>` +
    `<cbc:IssueDate>${d.fecha}</cbc:IssueDate>` +
    `<cbc:IssueTime>${d.hora}</cbc:IssueTime>` +
    (esNota ? "" : `<cbc:InvoiceTypeCode listID="0101">${d.tipo}</cbc:InvoiceTypeCode>`) +
    notas +
    `<cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>` +
    referencia +
    firma +
    emisor +
    cliente +
    (esNota ? "" : formaPago) +
    impuestos +
    totales +
    lineas +
    `</${raiz}>`
  );
}
