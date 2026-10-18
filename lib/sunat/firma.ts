/* ============================================================
   SUNAT: firma digital del XML (XMLDSig, firma "enveloped")
   Usa solo el módulo crypto de Node. Como el XML ya está escrito en
   forma canónica, el resumen (digest) se calcula sobre el mismo texto.
   ============================================================ */

import { createHash, createSign } from "crypto";
import { ID_FIRMA } from "./xml";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

const HUECO = "<ext:ExtensionContent></ext:ExtensionContent>";

function contenidoSignedInfo(digest: string): string {
  return (
    `<ds:CanonicalizationMethod Algorithm="${C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA1}"></ds:SignatureMethod>` +
    `<ds:Reference URI="">` +
    `<ds:Transforms><ds:Transform Algorithm="${ENVELOPED}"></ds:Transform></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA1}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digest}</ds:DigestValue>` +
    `</ds:Reference>`
  );
}

export type XmlFirmado = { xml: string; hash: string };

/*
 * xml: el XML sin firma (de xmlSinFirma), sin cabecera.
 * llavePem: llave privada en PEM. certificadoB64: certificado (DER en base64).
 */
export function firmarXml(xml: string, llavePem: string, certificadoB64: string): XmlFirmado {
  if (xml.split(HUECO).length !== 2) {
    throw new Error("El XML no tiene el lugar para la firma.");
  }

  // 1) Resumen del documento (la firma "enveloped" se calcula sin la firma)
  const digest = createHash("sha1").update(xml, "utf8").digest("base64");

  // 2) SignedInfo canonizado: hereda los espacios de nombres del documento (los de la raíz)
  const declaraciones = xml.match(/^<[A-Za-z]+ ([^>]*)>/)?.[1];

  if (!declaraciones) throw new Error("El XML no tiene la raíz esperada.");

  const interior = contenidoSignedInfo(digest);
  const signedInfoCanonico = `<ds:SignedInfo ${declaraciones}>${interior}</ds:SignedInfo>`;

  const firmador = createSign("RSA-SHA1");
  firmador.update(signedInfoCanonico, "utf8");
  const valor = firmador.sign(llavePem, "base64");

  // 3) Se inserta la firma dentro de ExtensionContent
  const firma =
    `<ds:Signature Id="${ID_FIRMA}">` +
    `<ds:SignedInfo>${interior}</ds:SignedInfo>` +
    `<ds:SignatureValue>${valor}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificadoB64.replace(/\s+/g, "")}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `</ds:Signature>`;

  const firmado = xml.replace(HUECO, `<ext:ExtensionContent>${firma}</ext:ExtensionContent>`);

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${firmado}`, hash: digest };
}
