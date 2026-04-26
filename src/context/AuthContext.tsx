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
import { createClient } from '@/lib/supabase/client'
import type { User, Tenant, UserRole } from '@/types/database'

interface AuthContextValue {
  user: User | null
  tenant: Tenant | null
  role: UserRole | null
  tenantId: string | null
  userId: string | null
  loading: boolean
  isMaster: boolean
  isAdmin: boolean
  canManageUsers: boolean
  modulosHabilitados: Record<string, boolean>  // permisos por módulo
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [tenant, setTenant]   = useState<Tenant | null>(null)
  const [userId, setUserId]   = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [modulosHabilitados, setModulos] = useState<Record<string, boolean>>({})
  const supabase = createClient()

  const loadProfile = useCallback(async (authUserId: string) => {
    setUserId(authUserId)
    try {
      const { data: u, error: uErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUserId)
        .single()

      if (uErr || !u) {
        console.error('Error loading user profile:', uErr?.message)
        setLoading(false)
        return
      }

      setUser(u as User)

      // Cargar permisos por módulo
      const { data: permisos } = await supabase
        .from('permisos_modulos')
        .select('modulo, habilitado')
        .eq('user_id', authUserId)
      const permisosMap: Record<string, boolean> = {}
      for (const p of (permisos ?? [])) {
        permisosMap[p.modulo] = p.habilitado
      }
      setModulos(permisosMap)

      const { data: t, error: tErr } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', u.tenant_id)
        .single()

      if (tErr || !t) {
        console.error('Error loading tenant:', tErr?.message)
      } else {
        setTenant(t as Tenant)
      }
    } catch (e) {
      console.error('loadProfile error:', e)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  const refreshUser = useCallback(async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (au) await loadProfile(au.id)
  }, [supabase, loadProfile])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: au } }) => {
      if (au) loadProfile(au.id)
      else setLoading(false)
    })
  }, [supabase, loadProfile])

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setTenant(null)
    setUserId(null)
    window.location.href = '/auth/login'
  }

  const role           = user?.rol ?? null
  const tenantId       = user?.tenant_id ?? null
  const isMaster       = role === 'master'
  const isAdmin        = role === 'admin' || isMaster
  const canManageUsers = isMaster

  return (
    <AuthContext.Provider value={{
      user, tenant, role, tenantId, userId,
      loading, isMaster, isAdmin, canManageUsers,
      modulosHabilitados,
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