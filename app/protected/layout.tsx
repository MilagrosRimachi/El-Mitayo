import Menu from "./_components/Menu";
import Sincronizador from "./_components/Sincronizador";
import AvisoContadora from "./_components/AvisoContadora";
import Guardia from "./_components/Guardia";

/* Sin datos del servidor aquí: así la pantalla abre también sin internet */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh pb-24 lg:pb-0 lg:pl-60">
      <Guardia />
      <Menu />
      <Sincronizador />
      <AvisoContadora />
      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 lg:px-8 lg:py-6">{children}</main>
    </div>
  );
}
