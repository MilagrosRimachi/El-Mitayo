import { Suspense } from "react";
import PuntoVenta from "./PuntoVenta";

export default function VenderPage() {
  return (
    <Suspense fallback={null}>
      <PuntoVenta />
    </Suspense>
  );
}
