import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <main className="min-h-svh bg-[#fdf1f5]">
      <section className="rounded-b-[2.5rem] border-b-4 border-[#b8336a] bg-[#f8d3e0] px-4 pb-20 pt-8 text-center shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mitayo.jpg" alt='Multiservicio "El Mitayo"' className="mx-auto w-full max-w-md rounded-2xl border-2 border-[#b8336a]" />
        <p className="mt-3 text-sm font-semibold text-[#5c1a37]">Ventas, boletas y facturas</p>
      </section>

      <section className="mx-auto -mt-12 w-full max-w-sm px-4 pb-10">
        <LoginForm />
      </section>
    </main>
  );
}
