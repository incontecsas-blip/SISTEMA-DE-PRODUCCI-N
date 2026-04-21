// src/lib/utils.ts
// Funciones utilitarias compartidas en toda la app

import { clsx, type ClassValue } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

// ── CLASSNAMES ────────────────────────────────────────────────
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// ── FECHAS ────────────────────────────────────────────────────
export function formatDate(date: string | Date, pattern = 'dd/MM/yyyy') {
  return format(new Date(date), pattern, { locale: es })
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), "dd/MM/yy HH:mm", { locale: es })
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: es })
}

export function diasHasta(fecha: string | null): number | null {
  if (!fecha) return null
  return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)
}

// ── NÚMEROS ───────────────────────────────────────────────────
export function formatMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export function formatQty(value: number, decimals = 3) {
  return value.toFixed(decimals)
}

export function pct(value: number, total: number): number {
  if (total === 0) return 0
  return Math.round((value / total) * 100)
}

// ── STRINGS ───────────────────────────────────────────────────
export function initials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function truncate(str: string, max = 40): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

// ── VALIDACIONES ──────────────────────────────────────────────
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isValidRUC(ruc: string): boolean {
  // RUC Ecuador: 13 dígitos, cédula Ecuador: 10 dígitos
  return /^\d{10,13}$/.test(ruc)
}

// ── COLORES DE ESTADO ─────────────────────────────────────────
export const ORDER_STATUS_COLORS = {
  borrador:       { bg: 'bg-slate-100',  text: 'text-slate-500',  border: 'border-slate-200' },
  confirmado:     { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200' },
  en_bodega:      { bg: 'bg-violet-50',  text: 'text-violet-700', border: 'border-violet-200' },
  en_produccion:  { bg: 'bg-sky-50',     text: 'text-sky-700',    border: 'border-sky-200' },
  listo_entrega:  { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200' },
  entregado:      { bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200' },
  anulado:        { bg: 'bg-red-50',     text: 'text-red-600',    border: 'border-red-200' },
}

export const OP_STATUS_COLORS = {
  pendiente:        { bg: 'bg-red-50',     text: 'text-red-600',    border: 'border-red-200' },
  en_proceso:       { bg: 'bg-sky-50',     text: 'text-sky-700',    border: 'border-sky-200' },
  finalizada:       { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200' },
  entregada_bodega: { bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200' },
  anulada:          { bg: 'bg-slate-100',  text: 'text-slate-500',  border: 'border-slate-200' },
}

// ── AVATAR COLOR por ROL ──────────────────────────────────────
export const ROLE_AVATAR_GRADIENT: Record<string, string> = {
  master:   'from-amber-400 to-amber-600',
  admin:    'from-sky-400 to-sky-700',
  vendedor: 'from-emerald-400 to-emerald-700',
  bodega:   'from-violet-400 to-violet-700',
  operario: 'from-red-400 to-red-700',
}

// ── STOCK STATUS ──────────────────────────────────────────────
export function stockStatus(actual: number, minimo: number): 'critico' | 'bajo' | 'ok' {
  if (actual < minimo * 0.3) return 'critico'
  if (actual < minimo) return 'bajo'
  return 'ok'
}

export const STOCK_STATUS_STYLES = {
  critico: { pill: 'bg-red-50 text-red-600 border-red-200',    bar: 'bg-red-400',    label: 'Crítico' },
  bajo:    { pill: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400', label: 'Bajo mínimo' },
  ok:      { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-400', label: 'OK' },
}

// Re-export role helpers needed by components
export const ROLE_LABELS: Record<string, string> = {
  master:   'Admin Master',
  admin:    'Administrador',
  vendedor: 'Vendedor',
  bodega:   'Bodega',
  operario: 'Operario',
}

export const ROLE_AVATAR_GRADIENT: Record<string, string> = {
  master:   'from-amber-400 to-amber-600',
  admin:    'from-sky-400 to-sky-700',
  vendedor: 'from-emerald-400 to-emerald-700',
  bodega:   'from-violet-400 to-violet-700',
  operario: 'from-red-400 to-red-700',
}
