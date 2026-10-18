"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/* Mensajes en español para los errores más comunes al iniciar sesión */
function mensajeDeError(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error ?? "");

  if (/invalid login credentials/i.test(texto)) return "El correo o la contraseña no son correctos.";
  if (/email not confirmed/i.test(texto)) return "Tu correo todavía no está confirmado.";
  if (/too many requests|rate limit/i.test(texto)) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  if (/failed to fetch|network/i.test(texto)) return "No hay conexión a internet. Revisa tu señal y vuelve a probar.";

  return texto ? `No se pudo iniciar sesión: ${texto}` : "No se pudo iniciar sesión.";
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function entrar(e: React.FormEvent) {
    e.preventDefault();

    const supabase = createClient();

    setCargando(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (error) throw error;

      window.location.assign("/protected/vender");
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={entrar} className="rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="text-xl font-bold text-[#b8336a]">Ingresar</h2>

      <p className="mb-5 mt-1 text-sm text-gray-500">Escribe tu correo y tu contraseña.</p>

      <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
        Correo
      </label>

      <input
        id="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tucorreo@gmail.com"
        className="mb-4 h-12 w-full rounded-xl border border-gray-300 px-4 text-base outline-none focus:border-[#b8336a] focus:ring-2 focus:ring-[#b8336a]/20"
      />

      <div className="mb-1 flex items-center justify-between">
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Contraseña
        </label>

        <Link
          href="/auth/forgot-password"
          className="text-xs font-medium text-[#b8336a] underline-offset-4 hover:underline"
        >
          ¿La olvidaste?
        </Link>
      </div>

      <div className="relative mb-4">
        <input
          id="password"
          type={verClave ? "text" : "password"}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 w-full rounded-xl border border-gray-300 px-4 pr-14 text-base outline-none focus:border-[#b8336a] focus:ring-2 focus:ring-[#b8336a]/20"
        />

        <button
          type="button"
          onClick={() => setVerClave((v) => !v)}
          aria-label={verClave ? "Ocultar la contraseña" : "Ver la contraseña"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-medium text-gray-500 hover:text-[#b8336a]"
        >
          {verClave ? "Ocultar" : "Ver"}
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={cargando}
        className="h-12 w-full rounded-xl bg-[#b8336a] text-base font-bold text-white shadow transition hover:opacity-95 disabled:opacity-60"
      >
        {cargando ? "Entrando..." : "Ingresar"}
      </button>

      <p className="mt-4 text-center text-xs text-gray-500">
        Un solo usuario: el que creaste en Supabase.
      </p>
    </form>
  );
}
