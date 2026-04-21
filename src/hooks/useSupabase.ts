// src/hooks/useSupabase.ts
// Hook que expone el cliente de Supabase ya tipado
// y helpers para las queries más comunes

import { useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function useSupabase() {
  const supabase = useMemo(() => {
    if (!_client) _client = createClient()
    return _client
  }, [])

  return supabase
}
