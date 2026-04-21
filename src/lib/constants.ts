// src/lib/constants.ts
// Constantes globales de la aplicación

import type { OrderStatus, OpStatus, UserRole } from '@/types/database'

// ── FLUJO DE ESTADOS DEL PEDIDO ───────────────────────────────
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'borrador',
  'confirmado',
  'en_bodega',
  'en_produccion',
  'listo_entrega',
  'entregado',
]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  borrador:       'Borrador',
  confirmado:     'Confirmado',
  en_bodega:      'En Bodega',
  en_produccion:  'En Producción',
  listo_entrega:  'Listo para Entrega',
  entregado:      'Entregado',
  anulado:        'Anulado',
}

export const ORDER_STATUS_ICONS: Record<OrderStatus, string> = {
  borrador:       '📝',
  confirmado:     '✓',
  en_bodega:      '📦',
  en_produccion:  '⚙️',
  listo_entrega:  '🚚',
  entregado:      '✅',
  anulado:        '✕',
}

// ── FLUJO DE ESTADOS DE OP ────────────────────────────────────
export const OP_STATUS_LABELS: Record<OpStatus, string> = {
  pendiente:        'Pendiente',
  en_proceso:       'En Proceso',
  finalizada:       'Finalizada',
  entregada_bodega: 'Entregada a Bodega',
  anulada:          'Anulada',
}

// ── ROLES ─────────────────────────────────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  master:   'Admin Master',
  admin:    'Administrador',
  vendedor: 'Vendedor',
  bodega:   'Bodega',
  operario: 'Operario',
}

// ── MÓDULOS POR ROL ───────────────────────────────────────────
export const MODULE_ACCESS: Record<string, UserRole[]> = {
  '/dashboard':   ['master','admin','vendedor','bodega','operario'],
  '/clientes':    ['master','admin','vendedor'],
  '/pedidos':     ['master','admin','vendedor','bodega'],
  '/bodega':      ['master','admin','bodega'],
  '/produccion':  ['master','admin','operario','bodega'],
  '/formulas':    ['master','admin'],
  '/reportes':    ['master','admin'],
  '/config':      ['master','admin'],
  '/admin-master':['master'],
}

// ── TIPOS DE CLIENTE ──────────────────────────────────────────
export const TIPOS_CLIENTE = ['Nacional', 'Exportador', 'Industrial', 'Distribuidor'] as const
export type TipoCliente = typeof TIPOS_CLIENTE[number]

// ── TIPOS DE MOVIMIENTO ───────────────────────────────────────
export const MOVEMENT_TYPE_LABELS = {
  ENTRADA:         'Entrada',
  SALIDA_OP:       'Salida por OP',
  SALIDA_DESPACHO: 'Salida por Despacho',
  AJUSTE_ENTRADA:  'Ajuste de Entrada',
  AJUSTE_SALIDA:   'Ajuste de Salida',
}

// ── STORAGE BUCKETS ───────────────────────────────────────────
export const STORAGE_BUCKETS = {
  LOGOS:            'logos',
  OC_CLIENTES:      'oc_clientes',
  PDFS_PEDIDOS:     'pdfs_pedidos',
  PDFS_OPS:         'pdfs_ops',
  EXCEL_INVENTARIO: 'excel_inventario',
}

// ── LÍMITES ───────────────────────────────────────────────────
export const LIMITS = {
  LOGO_MAX_BYTES:    2 * 1024 * 1024,  // 2 MB
  EXCEL_MAX_BYTES:   5 * 1024 * 1024,  // 5 MB
  SEARCH_MIN_CHARS:  2,
  AUTOCOMPLETE_MAX:  6,
}

// ── COLORES DE MERMA ──────────────────────────────────────────
export function mermaColor(pct: number, limite: number): string {
  if (pct > limite * 2) return 'text-red-500'
  if (pct > limite)     return 'text-amber-500'
  return 'text-emerald-600'
}
