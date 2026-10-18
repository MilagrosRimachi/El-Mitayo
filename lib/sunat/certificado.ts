/* ============================================================
   SUNAT: lectura del certificado digital (.pfx / .p12)
   ============================================================ */

import forge from "node-forge";

export type Certificado = {
  llavePem: string;
  certificadoB64: string; // DER en base64, para la firma
  titular: string;
  ruc: string | null;
  venceEn: string; // ISO
};

export function leerCertificado(pfxBase64: string, clave: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;

  try {
    const der = forge.util.decode64(pfxBase64);
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, clave);
  } catch {
    throw new Error("No se pudo abrir el certificado: revisa que sea el archivo .pfx/.p12 y que la contraseña sea correcta.");
  }

  const oids = forge.pki.oids;
  const llaves = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ];
  const certs = p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? [];

  const llave = llaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;

  if (!llave) throw new Error("El certificado no trae la llave privada.");

  // El certificado del titular es el que corresponde a la llave (no los de la entidad certificadora)
  const propio =
    certs.find((b) => {
      const pub = b.cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
      return pub && pub.n && pub.n.equals(llave.n);
    })?.cert ?? certs[0]?.cert;

  if (!propio) throw new Error("El archivo no trae el certificado.");

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(propio)).getBytes();
  const campo = (corto: string) => propio.subject.getField(corto)?.value as string | undefined;
  const titular = campo("CN") ?? campo("O") ?? "—";
  const textoSujeto = propio.subject.attributes.map((a) => String(a.value ?? "")).join(" ");
  const ruc = textoSujeto.match(/\b(10|15|16|17|20)\d{9}\b/)?.[0] ?? null;

  return {
    llavePem: forge.pki.privateKeyToPem(llave),
    certificadoB64: forge.util.encode64(der),
    titular,
    ruc,
    venceEn: propio.validity.notAfter.toISOString(),
  };
}
