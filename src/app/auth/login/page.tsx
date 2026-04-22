// src/app/auth/login/page.tsx
// Página de login — autentica contra Supabase Auth

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const router  = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
  e.preventDefault()

  try {
    setLoading(true)

    console.log("ANTES DEL LOGIN")

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    console.log("DESPUÉS DEL LOGIN")
    console.log("DATA:", data)
    console.log("ERROR:", error)

    if (error) throw error

    toast.success('Sesión iniciada')
    router.push('/dashboard')

  } catch (err) {
    console.error("ERROR LOGIN:", err)
  } finally {
    setLoading(false)
  }
}

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      {/* Background pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #94a3b8 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo / título */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-sky-400 to-sky-700 rounded-2xl
                          flex items-center justify-center text-3xl mx-auto mb-4
                          shadow-lg shadow-sky-500/30">
            🏭
          </div>
          <h1 className="text-white font-extrabold text-2xl tracking-tight">
            SISTEMA DE PRODUCCIÓN
          </h1>
          <p className="text-slate-500 text-sm mt-1">Inicia sesión para continuar</p>
        </div>

        {/* Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8
                        shadow-2xl shadow-black/40">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="tu@empresa.com"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg
                           text-white text-sm px-3 py-2.5 outline-none
                           placeholder:text-slate-600
                           focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20
                           transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg
                           text-white text-sm px-3 py-2.5 outline-none
                           placeholder:text-slate-600
                           focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20
                           transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50
                         text-white font-bold text-sm py-2.5 rounded-lg
                         transition-all duration-150 mt-2"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Sistema de gestión industrial v1.0
        </p>
      </div>
    </div>
  )
}
