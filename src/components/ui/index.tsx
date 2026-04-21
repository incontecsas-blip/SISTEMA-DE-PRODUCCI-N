// src/components/ui/index.tsx
'use client'

import { cn, ORDER_STATUS_COLORS, OP_STATUS_COLORS } from '@/lib/utils'
import { ORDER_STATUS_LABELS, OP_STATUS_LABELS } from '@/lib/constants'
import type { OrderStatus, OpStatus } from '@/types/database'
import { useEffect, useRef } from 'react'

// ── STATUS PILLS ──────────────────────────────────────────────
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const c = ORDER_STATUS_COLORS[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border whitespace-nowrap', c.bg, c.text, c.border)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
      {ORDER_STATUS_LABELS[status]}
    </span>
  )
}

export function OpStatusPill({ status }: { status: OpStatus }) {
  const c = OP_STATUS_COLORS[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border whitespace-nowrap', c.bg, c.text, c.border)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
      {OP_STATUS_LABELS[status]}
    </span>
  )
}

// ── KPI CARD ──────────────────────────────────────────────────
const KPI_STYLES = {
  sky:    { bar:'from-sky-400 to-sky-600',     icon:'bg-sky-100',    trend:'bg-emerald-50 text-emerald-700' },
  green:  { bar:'from-emerald-400 to-emerald-600', icon:'bg-emerald-50', trend:'bg-emerald-50 text-emerald-700' },
  red:    { bar:'from-red-400 to-red-600',     icon:'bg-red-50',     trend:'bg-red-50 text-red-700' },
  amber:  { bar:'from-amber-400 to-amber-600', icon:'bg-amber-50',   trend:'bg-amber-50 text-amber-700' },
  purple: { bar:'from-violet-400 to-violet-600', icon:'bg-violet-50', trend:'bg-violet-50 text-violet-700' },
}

export function KpiCard({ label, value, icon, color, trend, trendUp, onClick }: {
  label: string; value: string | number; icon: string
  color: 'sky'|'green'|'red'|'amber'|'purple'
  trend?: string; trendUp?: boolean; onClick?: () => void
}) {
  const c = KPI_STYLES[color]
  return (
    <div onClick={onClick} className={cn('bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-150', onClick && 'cursor-pointer')}>
      <div className={cn('absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl bg-gradient-to-r', c.bar)} />
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-3', c.icon)}>{icon}</div>
      <div className="font-mono text-[32px] font-bold text-slate-800 leading-none mb-1 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 font-medium mb-2.5">{label}</div>
      {trend && <span className={cn('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full', c.trend)}>{trendUp !== undefined ? (trendUp ? '↑' : '↓') : ''} {trend}</span>}
    </div>
  )
}

// ── MODAL ─────────────────────────────────────────────────────
export function Modal({ open, onClose, title, subtitle, icon, children, footer, wide, extraWide }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string
  icon?: string; children: React.ReactNode; footer?: React.ReactNode
  wide?: boolean; extraWide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease]"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes slideUp{from{transform:translateY(16px) scale(0.97);opacity:0}to{transform:none;opacity:1}}`}</style>
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto animate-[slideUp_0.22s_cubic-bezier(0.34,1.4,0.64,1)]', extraWide ? 'max-w-3xl' : wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3 sticky top-0 bg-white z-10 rounded-t-2xl">
          {icon && <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center text-xl flex-shrink-0">{icon}</div>}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-[15px] text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors flex-shrink-0">✕</button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end sticky bottom-0 bg-white rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

// ── FIELD ─────────────────────────────────────────────────────
export function Field({ label, required, hint, error, children }: {
  label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-700">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-slate-400">{hint}</p>}
      {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  )
}

export function FormRow2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

export function FormRow3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>
}

// ── AUTOCOMPLETE ──────────────────────────────────────────────
export function Autocomplete({ value, onChange, onSelect, options, placeholder, loading }: {
  value: string; onChange: (v: string) => void
  onSelect: (o: { id: string; label: string; sublabel?: string }) => void
  options: { id: string; label: string; sublabel?: string }[]
  placeholder?: string; loading?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const show = options.length > 0 && value.length >= 2
  return (
    <div ref={ref} className="relative">
      <input className="input w-full" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
      {loading && <div className="absolute right-3 top-1/2 -translate-y-1/2"><div className="w-3.5 h-3.5 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" /></div>}
      {show && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-sky-200 rounded-xl shadow-xl z-50 max-h-52 overflow-y-auto">
          {options.map(opt => (
            <button key={opt.id} type="button" className="w-full text-left px-4 py-3 hover:bg-sky-50 border-b border-slate-50 last:border-0 transition-colors" onMouseDown={() => onSelect(opt)}>
              <p className="font-semibold text-[13px] text-slate-800">{opt.label}</p>
              {opt.sublabel && <p className="text-[10px] font-mono text-slate-400 mt-0.5">{opt.sublabel}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── TABS ──────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit flex-wrap">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cn('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
            active === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── LOADING / EMPTY ───────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm'|'md'|'lg' }) {
  const s = { sm:'w-4 h-4 border-2', md:'w-6 h-6 border-2', lg:'w-10 h-10 border-[3px]' }
  return <div className={cn('border-slate-200 border-t-sky-500 rounded-full animate-spin', s[size])} />
}

export function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[300px]">
      <div className="text-center"><Spinner size="lg" /><p className="text-slate-400 text-sm mt-3 font-medium">Cargando...</p></div>
    </div>
  )
}

export function EmptyState({ icon, title, subtitle, action }: { icon: string; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="text-5xl mb-4">{icon}</div>
      <p className="text-slate-700 font-bold text-sm">{title}</p>
      {subtitle && <p className="text-slate-400 text-xs mt-1">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// ── ALERT BOXES ───────────────────────────────────────────────
export function InfoBox({ children }: { children: React.ReactNode }) {
  return <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 text-sm text-sky-700 leading-relaxed">{children}</div>
}

export function WarnBox({ children }: { children: React.ReactNode }) {
  return <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 leading-relaxed">{children}</div>
}

export function DangerBox({ children }: { children: React.ReactNode }) {
  return <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 leading-relaxed">{children}</div>
}

export function AlertItem({ icon, title, subtitle, type, time }: {
  icon: string; title: string; subtitle?: string
  type: 'danger'|'warning'|'info'|'success'; time?: string
}) {
  const s = { danger:'bg-red-50 border-l-red-400', warning:'bg-amber-50 border-l-amber-400', info:'bg-sky-50 border-l-sky-400', success:'bg-emerald-50 border-l-emerald-400' }
  return (
    <div className={cn('flex gap-3 items-start p-3 rounded-lg border-l-4', s[type])}>
      <span className="text-lg mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 text-[12px]">{title}</p>
        {subtitle && <p className="text-slate-500 text-[11px] mt-0.5">{subtitle}</p>}
      </div>
      {time && <p className="text-[10px] font-mono text-slate-400 whitespace-nowrap mt-0.5">{time}</p>}
    </div>
  )
}

// ── PROGRESS BAR ──────────────────────────────────────────────
export function ProgressBar({ value, max = 100, color = 'sky', showLabel = false }: {
  value: number; max?: number; color?: 'sky'|'green'|'amber'|'red'; showLabel?: boolean
}) {
  const pct = Math.min(Math.round((value / Math.max(max, 1)) * 100), 100)
  const c = { sky:'bg-sky-500', green:'bg-emerald-500', amber:'bg-amber-400', red:'bg-red-500' }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', c[color])} style={{ width:`${pct}%` }} />
      </div>
      {showLabel && <span className="font-mono text-[10px] text-slate-500 tabular-nums w-8 text-right">{pct}%</span>}
    </div>
  )
}

// ── CARD HELPERS ──────────────────────────────────────────────
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden', className)}>{children}</div>
}

export function CardHeader({ title, count, actions, children }: {
  title: string; count?: number|string; actions?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
      <span className="font-bold text-[14px] text-slate-800">{title}</span>
      {count !== undefined && <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md">{count}</span>}
      {children}
      {actions && <div className="ml-auto flex gap-2 items-center">{actions}</div>}
    </div>
  )
}

// ── BTN ───────────────────────────────────────────────────────
export function Btn({ variant = 'default', size = 'md', loading, children, className, disabled, ...rest }: {
  variant?: 'default'|'primary'|'success'|'danger'|'gold'
  size?: 'sm'|'md'; loading?: boolean; children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex items-center gap-1.5 font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed border rounded-lg'
  const sizes = { sm:'px-3 py-1.5 text-[11px]', md:'px-4 py-2 text-xs' }
  const v = {
    default:'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300',
    primary:'bg-sky-500 text-white border-sky-500 hover:bg-sky-600',
    success:'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600',
    danger:'bg-red-500 text-white border-red-500 hover:bg-red-600',
    gold:'bg-amber-500 text-white border-amber-500 hover:bg-amber-600',
  }
  return (
    <button {...rest} disabled={disabled || loading} className={cn(base, sizes[size], v[variant], className)}>
      {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
      {children}
    </button>
  )
}
