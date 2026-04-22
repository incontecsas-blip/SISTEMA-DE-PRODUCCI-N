// src/app/auth/login/page.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // 1. Autenticar
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(authError.message === 'Invalid login credentials'
          ? 'Email o contraseña incorrectos'
          : authError.message)
        setLoading(false)
        return
      }

      if (!authData.user) {
        setError('No se pudo obtener el usuario')
        setLoading(false)
        return
      }

      // 2. Verificar que existe perfil en la tabla users
      const { data: perfil, error: perfilError } = await supabase
        .from('users')
        .select('id, rol, activo, tenant_id')
        .eq('id', authData.user.id)
        .single()

      if (perfilError || !perfil) {
        setError('Tu usuario no tiene perfil en el sistema. Contacta al administrador.')
        await supabase.auth.signOut()
        setLoading(false)
        return
      }

      if (!perfil.activo) {
        setError('Tu cuenta está desactivada. Contacta al administrador.')
        await supabase.auth.signOut()
        setLoading(false)
        return
      }

      // 3. Redirigir directamente — sin router, sin context, forzado
      window.location.href = '/dashboard'

    } catch (err) {
      console.error('Error en login:', err)
      setError('Error inesperado. Intenta de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #94a3b8 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4"
            style={{
              background: 'linear-gradient(135deg, #38bdf8, #0369a1)',
              boxShadow: '0 4px 24px rgba(14,165,233,0.4)',
            }}
          >
            🏭
          </div>
          <h1 className="text-white font-extrabold text-2xl tracking-tight">
            SISTEMA DE PRODUCCIÓN
          </h1>
          <p className="text-slate-500 text-sm mt-1">Inicia sesión para continuar</p>
        </div>

        {/* Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
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
                autoComplete="email"
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
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg
                           text-white text-sm px-3 py-2.5 outline-none
                           placeholder:text-slate-600
                           focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20
                           transition-all"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                <p className="text-red-400 text-xs font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full font-bold text-sm py-2.5 rounded-lg transition-all duration-150
                         disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: loading ? '#0369a1' : '#0ea5e9', color: 'white' }}
            >
              {loading ? 'Verificando...' : 'Ingresar'}
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
