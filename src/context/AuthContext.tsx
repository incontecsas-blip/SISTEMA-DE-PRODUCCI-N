// src/context/AuthContext.tsx
'use client'

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User, Tenant, UserRole } from '@/types/database'

interface AuthContextValue {
  user: User | null
  tenant: Tenant | null
  role: UserRole | null
  loading: boolean
  isMaster: boolean
  isAdmin: boolean
  canManageUsers: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]     = useState<User | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const router  = useRouter()
  const supabase = createClient()

  const loadUserProfile = useCallback(async (authUserId: string) => {
    try {
      // Cargar perfil del usuario
      const { data: userProfile, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUserId)
        .single()

      if (userError) {
        console.error('Error cargando perfil de usuario:', userError.message)
        // Si no existe el perfil, cerrar sesión y mostrar error claro
        await supabase.auth.signOut()
        setUser(null)
        setTenant(null)
        setLoading(false)
        return
      }

      if (!userProfile) {
        console.error('No se encontró perfil para user_id:', authUserId)
        await supabase.auth.signOut()
        setLoading(false)
        return
      }

      setUser(userProfile as User)

      // Cargar datos del tenant
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', userProfile.tenant_id)
        .single()

      if (tenantError) {
        console.error('Error cargando tenant:', tenantError.message)
      } else {
        setTenant(tenantData as Tenant)
      }

    } catch (err) {
      console.error('Error inesperado en loadUserProfile:', err)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  const refreshUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) await loadUserProfile(authUser.id)
  }, [supabase, loadUserProfile])

  useEffect(() => {
    let mounted = true

    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!mounted) return
      if (authUser) {
        await loadUserProfile(authUser.id)
      } else {
        setLoading(false)
      }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        if (event === 'SIGNED_IN' && session?.user) {
          await loadUserProfile(session.user.id)
          router.push('/dashboard')
          router.refresh()
        }

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setTenant(null)
          setLoading(false)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, loadUserProfile, router])

  const logout = async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setUser(null)
    setTenant(null)
    router.push('/auth/login')
    setLoading(false)
  }

  const role         = user?.rol ?? null
  const isMaster     = role === 'master'
  const isAdmin      = role === 'admin' || isMaster
  const canManageUsers = isMaster

  return (
    <AuthContext.Provider value={{
      user, tenant, role, loading,
      isMaster, isAdmin, canManageUsers,
      logout, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
