// src/hooks/useRealtime.ts
// Suscripción a cambios en tiempo real de Supabase
// Usado en Dashboard para actualizar KPIs sin recargar

'use client'

import { useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

type Table = 'pedidos' | 'ordenes_produccion' | 'productos' | 'lotes'
type Event = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeOptions {
  table: Table
  event?: Event
  filter?: string           // ej: 'tenant_id=eq.xxx'
  onData: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
}

export function useRealtime({ table, event = '*', filter, onData }: UseRealtimeOptions) {
  const supabase = createClient()

  useEffect(() => {
    const channelName = `realtime-${table}-${Date.now()}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        },
        onData
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, table, event, filter, onData])
}

// Hook específico para alertas de stock bajo
export function useStockAlerts(onAlert: (productName: string, stock: number, minimo: number) => void) {
  const handleChange = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const newData = payload.new as { nombre?: string; stock_actual?: number; stock_minimo?: number } | null
      const oldData = payload.old as { stock_actual?: number; stock_minimo?: number } | null

      if (!newData) return

      const stockActual  = newData.stock_actual  ?? 0
      const stockMinimo  = newData.stock_minimo  ?? 0
      const stockAnterior = oldData?.stock_actual ?? Infinity

      // Solo alertar cuando CRUZA el umbral (de OK a bajo)
      if (stockActual < stockMinimo && stockAnterior >= stockMinimo) {
        onAlert(newData.nombre ?? 'Producto', stockActual, stockMinimo)
      }
    },
    [onAlert]
  )

  useRealtime({
    table: 'productos',
    event: 'UPDATE',
    onData: handleChange,
  })
}

// Hook para escuchar nuevos pedidos
export function usePedidosLive(onChange: () => void) {
  const handleChange = useCallback(() => onChange(), [onChange])

  useRealtime({
    table: 'pedidos',
    event: '*',
    onData: handleChange,
  })
}

// Hook para escuchar cambios de OP
export function useOPsLive(onChange: () => void) {
  const handleChange = useCallback(() => onChange(), [onChange])

  useRealtime({
    table: 'ordenes_produccion',
    event: '*',
    onData: handleChange,
  })
}
