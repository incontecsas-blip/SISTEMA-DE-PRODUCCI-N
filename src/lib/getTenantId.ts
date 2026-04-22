// src/lib/getTenantId.ts
// Helper para obtener tenant_id del usuario actual desde cualquier componente cliente

import { createClient } from '@/lib/supabase/client'

export async function getTenantId(): Promise<string | null> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  return data?.tenant_id ?? null
}

export async function getUserAndTenant(): Promise<{ userId: string; tenantId: string } | null> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!data?.tenant_id) return null

  return { userId: user.id, tenantId: data.tenant_id }
}
