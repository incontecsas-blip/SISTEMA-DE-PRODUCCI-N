// src/context/AuthContext.tsx
// Contexto global de autenticación
// Provee: usuario actual, tenant, rol y función de logout

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
  loading: boolean
  isMaster: boolean
  isAdmin: boolean
  canManageUsers: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadUserProfile = useCallback(async (authUserId: string) => {
    const { data: userProfile } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .single()

    if (!userProfile) return

    setUser(userProfile)

    const { data: tenantData } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', userProfile.tenant_id)
      .single()

    if (tenantData) setTenant(tenantData)
  }, [supabase])

  const refreshUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser) await loadUserProfile(authUser.id)
  }, [supabase, loadUserProfile])

  useEffect(() => {
    const init = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) await loadUserProfile(authUser.id)
      setLoading(false)
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          await loadUserProfile(session.user.id)
        } else {
          setUser(null)
          setTenant(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase, loadUserProfile])

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setTenant(null)
    window.location.href = '/auth/login'
  }

  const role = user?.rol ?? null
  const isMaster = role === 'master'
  const isAdmin = role === 'admin' || isMaster
  const canManageUsers = isMaster  // SOLO master puede gestionar usuarios

  return (
    <AuthContext.Provider
      value={{ user, tenant, role, loading, isMaster, isAdmin, canManageUsers, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
