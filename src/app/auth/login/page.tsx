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
    if (loading) return
    setLoading(true)
    setError('')
 
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
 
    if (authError) {
      setError(
        authError.message.includes('Invalid login credentials')
          ? 'Email o contraseña incorrectos'
          : authError.message
      )
      setLoading(false)
      return
    }
 
    if (!data.session) {
      setError('No se pudo crear la sesión. Intenta de nuevo.')
      setLoading(false)
      return
    }
 
    // Verificar perfil
    const { data: perfil, error: perfilError } = await supabase
      .from('users')
      .select('id, rol, activo')
      .eq('id', data.user.id)
      .single()
 
    if (perfilError || !perfil) {
      setError('No tienes perfil en el sistema. Contacta al administrador.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
 
    if (!perfil.activo) {
      setError('Tu cuenta está desactivada.')
      await supabase.auth.signOut()
      setLoading(false)
      return
    }
 
    // Redirigir — pequeño delay para que las cookies se escriban
    setTimeout(() => {
      window.location.replace('/dashboard')
    }, 300)
  }
 
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #94a3b8 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />
 
      <div className="relative w-full max-w-sm">
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
                disabled={loading}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg
                           text-white text-sm px-3 py-2.5 outline-none
                           placeholder:text-slate-600 disabled:opacity-50
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
                disabled={loading}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg
                           text-white text-sm px-3 py-2.5 outline-none
                           placeholder:text-slate-600 disabled:opacity-50
                           focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20
                           transition-all"
              />
            </div>
 
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                <p className="text-red-400 text-xs font-medium">⚠ {error}</p>
              </div>
            )}
 
            <button
              type="submit"
              disabled={loading}
              className="w-full font-bold text-sm py-2.5 rounded-lg transition-all
                         duration-150 disabled:opacity-60 disabled:cursor-not-allowed
                         bg-sky-500 hover:bg-sky-600 text-white"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verificando...
                </span>
              ) : 'Ingresar'}
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
