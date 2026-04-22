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
  loading: boolean
  isMaster: boolean
  isAdmin: boolean
  canManageUsers: boolean
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [tenant, setTenant]   = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const { data: u } = await supabase
        .from('users')
        .select('*')
        .eq('id', uid)
        .single()

      if (u) {
        setUser(u as User)
        const { data: t } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', u.tenant_id)
          .single()
        if (t) setTenant(t as Tenant)
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
    window.location.href = '/auth/login'
  }

  const role           = user?.rol ?? null
  const isMaster       = role === 'master'
  const isAdmin        = role === 'admin' || isMaster
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
