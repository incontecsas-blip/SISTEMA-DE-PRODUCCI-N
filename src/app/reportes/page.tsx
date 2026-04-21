// src/app/reportes/page.tsx
'use client'

import { useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { OrderStatusPill } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

type ReporteId = 'pedidos' | 'produccion' | 'trazabilidad' | 'inventario'

export default function ReportesPage() {
  const supabase = createClient()
  const [reporte, setReporte] = useState<ReporteId>('pedidos')
  const [desde, setDesde]     = useState(() => new Date(new Date().setDate(1)).toISOString().split('T')[0])
  const [hasta, setHasta]     = useState(() => new Date().toISOString().split('T')[0])
  const [datos, setDatos]     = useState<unknown[]>([])
  const [cargando, setCargando] = useState(false)
  const [busqLote, setBusqLote] = useState('')
  const [trazaDatos, setTrazaDatos] = useState<unknown[] | null>(null)

  async function generarReporte() {
    setCargando(true)
    setDatos([])
    try {
      if (reporte === 'pedidos') {
        const { data } = await supabase
          .from('pedidos')
          .select('*, cliente:clientes(nombre), vendedor:users(nombre)')
          .gte('fecha_pedido', desde)
          .lte('fecha_pedido', hasta)
          .neq('estado', 'anulado')
          .order('fecha_pedido', { ascending: false })
        setDatos(data ?? [])

      } else if (reporte === 'produccion') {
        const { data } = await supabase
          .from('ordenes_produccion')
          .select('*, formula:formulas(version, producto:productos(nombre)), responsable:users(nombre), consumos:op_consumos(cantidad_teorica, cantidad_real, merma_pct, mp:productos(nombre))')
          .gte('created_at', desde)
          .lte('created_at', hasta + 'T23:59:59')
          .in('estado', ['finalizada', 'entregada_bodega'])
          .order('created_at', { ascending: false })
        setDatos(data ?? [])

      } else if (reporte === 'inventario') {
        const { data } = await supabase
          .from('productos')
          .select('*, unidad:unidades_medida(simbolo)')
          .eq('activo', true)
          .order('tipo').order('nombre')
        setDatos(data ?? [])
      }
    } catch {
      toast.error('Error al generar reporte')
    } finally {
      setCargando(false)
    }
  }

  async function buscarTrazabilidad() {
    if (!busqLote.trim()) { toast.error('Ingresa un lote o número de pedido'); return }
    setCargando(true)
    try {
      // Buscar por número de pedido o lote de OP
      const { data: pedidos } = await supabase
        .from('pedidos')
        .select('*, cliente:clientes(nombre,contacto_nombre), vendedor:users(nombre), lineas:pedidos_lineas(cantidad, producto:productos(nombre)), historial:pedidos_historial(estado_nuevo, created_at, usuario:users(nombre))')
        .or(`numero_pedido.eq.${busqLote},numero_pedido.ilike.%${busqLote}%`)
        .limit(1)

      const { data: ops } = await supabase
        .from('ordenes_produccion')
        .select('*, formula:formulas(version, producto:productos(nombre)), responsable:users(nombre), consumos:op_consumos(*, mp:productos(nombre), lote:lotes(numero_lote))')
        .or(`numero_op.eq.${busqLote},lote_pt.eq.${busqLote}`)
        .limit(1)

      setTrazaDatos([...(pedidos ?? []), ...(ops ?? [])])
      if (!pedidos?.length && !ops?.length) toast.error('No se encontró información para ese lote/pedido')
    } finally {
      setCargando(false)
    }
  }

  const REPORTES = [
    { id: 'pedidos' as const,       icon: '📋', label: 'Pedidos',       desc: 'Por fecha, cliente, estado' },
    { id: 'produccion' as const,    icon: '⚙️', label: 'Producción',    desc: 'Teórico vs real vs merma' },
    { id: 'trazabilidad' as const,  icon: '🔍', label: 'Trazabilidad',  desc: 'Por lote o pedido' },
    { id: 'inventario' as const,    icon: '📦', label: 'Inventario',    desc: 'Stock valorizado' },
  ]

  const COLORS = ['sky', 'green', 'amber', 'purple'] as const
  const CARD_TOPS = ['from-sky-400 to-sky-600', 'from-emerald-400 to-emerald-600', 'from-amber-400 to-amber-600', 'from-violet-400 to-violet-600']

  return (
    <AppLayout title="Reportes" breadcrumb="MÓDULOS / REPORTES">
      {/* Selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {REPORTES.map((r, i) => (
          <button
            key={r.id}
            onClick={() => { setReporte(r.id); setDatos([]); setTrazaDatos(null) }}
            className={clsx(
              'text-left p-4 rounded-2xl border-2 transition-all hover:shadow-md',
              reporte === r.id ? 'border-sky-400 bg-sky-50 shadow-md' : 'card border-transparent hover:-translate-y-0.5'
            )}
          >
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3 bg-gradient-to-br', CARD_TOPS[i])}>
              <span>{r.icon}</span>
            </div>
            <p className="font-bold text-sm">{r.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{r.desc}</p>
          </button>
        ))}
      </div>

      {/* Filtros + acción */}
      {reporte !== 'trazabilidad' && (
        <div className="flex gap-2 items-center flex-wrap mb-4">
          <input className="input w-36" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
          <span className="text-slate-400 text-xs">al</span>
          <input className="input w-36" type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
          <button className="btn-primary" onClick={generarReporte} disabled={cargando}>
            {cargando ? 'Generando...' : 'Generar'}
          </button>
          {datos.length > 0 && (
            <>
              <button className="btn text-xs" onClick={() => toast.success('Excel generado')}>⬇ Excel</button>
              <button className="btn text-xs" onClick={() => toast.success('PDF generado')}>⬇ PDF</button>
              <span className="text-xs text-slate-400 ml-2">{datos.length} registros</span>
            </>
          )}
        </div>
      )}

      {reporte === 'trazabilidad' && (
        <div className="flex gap-2 items-center mb-4">
          <input className="input w-64" placeholder="Lote o N° de Pedido (ej: #1042, OP-001, B-205)" value={busqLote} onChange={e => setBusqLote(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarTrazabilidad()} />
          <button className="btn-primary" onClick={buscarTrazabilidad} disabled={cargando}>🔍 Buscar</button>
        </div>
      )}

      {/* ── RESULTADOS ─────────────────────────── */}

      {/* Pedidos */}
      {reporte === 'pedidos' && datos.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="font-bold text-[14px]">Reporte de Pedidos</span></div>
          <table className="data-table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>F. Pedido</th><th>F. Entrega</th><th>Total</th><th>Estado</th></tr></thead>
            <tbody>
              {(datos as {
                id: string; numero_pedido: string; fecha_pedido: string
                fecha_entrega_solicitada: string; total: number; estado: string
                cliente: { nombre?: string } | null
                vendedor: { nombre?: string } | null
              }[]).map(p => (
                <tr key={p.id}>
                  <td className="font-mono font-bold text-sky-600">{p.numero_pedido}</td>
                  <td className="font-semibold">{p.cliente?.nombre ?? '—'}</td>
                  <td className="text-slate-500 text-xs">{p.vendedor?.nombre ?? '—'}</td>
                  <td className="font-mono text-xs">{format(new Date(p.fecha_pedido), 'dd/MM/yy')}</td>
                  <td className="font-mono text-xs">{format(new Date(p.fecha_entrega_solicitada), 'dd/MM/yy')}</td>
                  <td className="font-mono font-semibold">${Number(p.total).toFixed(2)}</td>
                  <td><OrderStatusPill status={p.estado as never} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Producción */}
      {reporte === 'produccion' && datos.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="font-bold text-[14px]">Reporte Producción – Teórico vs Real</span></div>
          <table className="data-table">
            <thead><tr><th>OP #</th><th>Producto</th><th>Cant. PT</th><th>Responsable</th><th>Merma máx.</th></tr></thead>
            <tbody>
              {(datos as {
                id: string; numero_op: string; cantidad_a_producir: number
                formula: { version?: number; producto?: { nombre?: string } } | null
                responsable: { nombre?: string } | null
                consumos: { merma_pct?: number }[]
              }[]).map(op => {
                const maxMerma = Math.max(...(op.consumos ?? []).map(c => c.merma_pct ?? 0))
                return (
                  <tr key={op.id}>
                    <td className="font-mono font-bold text-sky-600">{op.numero_op}</td>
                    <td className="font-semibold">{op.formula?.producto?.nombre ?? '—'}</td>
                    <td className="font-mono">{op.cantidad_a_producir} kg</td>
                    <td className="text-slate-500 text-xs">{op.responsable?.nombre ?? '—'}</td>
                    <td className={clsx('font-mono font-bold text-sm', maxMerma > 5 ? 'text-red-500' : maxMerma > 2 ? 'text-amber-500' : 'text-emerald-600')}>
                      {maxMerma.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Inventario */}
      {reporte === 'inventario' && datos.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Inventario Valorizado</span>
            <span className="text-xs text-slate-500 ml-2 font-mono">
              Total: ${(datos as { stock_actual: number; costo_unitario: number }[]).reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0).toFixed(2)}
            </span>
          </div>
          <table className="data-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Stock</th><th>Unidad</th><th>Costo unit.</th><th>Valor total</th></tr></thead>
            <tbody>
              {(datos as {
                id: string; codigo: string; nombre: string; tipo: string
                stock_actual: number; costo_unitario: number
                unidad: { simbolo?: string } | null
              }[]).map(p => (
                <tr key={p.id}>
                  <td className="font-mono text-xs font-semibold">{p.codigo}</td>
                  <td className="font-semibold">{p.nombre}</td>
                  <td><span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border',
                    p.tipo === 'PT' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                  )}>{p.tipo}</span></td>
                  <td className="font-mono font-bold">{p.stock_actual}</td>
                  <td className="font-mono text-xs text-slate-500">{p.unidad?.simbolo}</td>
                  <td className="font-mono text-slate-500">${p.costo_unitario.toFixed(4)}</td>
                  <td className="font-mono font-bold text-sky-600">${(p.stock_actual * p.costo_unitario).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trazabilidad */}
      {reporte === 'trazabilidad' && trazaDatos !== null && (
        <div className="card">
          <div className="card-header"><span className="font-bold text-[14px]">Trazabilidad: {busqLote}</span></div>
          {trazaDatos.length === 0
            ? <div className="p-10 text-center text-slate-400 text-sm">No se encontró información para ese lote o pedido</div>
            : (
            <div className="p-5 flex flex-col gap-3">
              {(trazaDatos as {
                numero_pedido?: string; numero_op?: string
                cliente?: { nombre?: string; contacto_nombre?: string } | null
                vendedor?: { nombre?: string } | null
                formula?: { version?: number; producto?: { nombre?: string } } | null
                responsable?: { nombre?: string } | null
                historial?: { estado_nuevo: string; created_at: string; usuario?: { nombre?: string } }[]
                consumos?: { cantidad_real?: number; cantidad_teorica: number; mp?: { nombre?: string }; lote?: { numero_lote?: string } }[]
              }[]).map((item, i) => (
                <div key={i} className="space-y-2">
                  {item.numero_pedido && (
                    <>
                      <TrazeItem icon="📋" color="success" title={`Pedido ${item.numero_pedido}`} sub={`Cliente: ${item.cliente?.nombre} · Contacto: ${item.cliente?.contacto_nombre}`} />
                      {item.historial?.map((h, j) => (
                        <TrazeItem key={j} icon="📍" color="info" title={h.estado_nuevo} sub={`${h.usuario?.nombre ?? 'Sistema'} · ${format(new Date(h.created_at), 'dd/MM/yy HH:mm')}`} />
                      ))}
                    </>
                  )}
                  {item.numero_op && (
                    <>
                      <TrazeItem icon="⚙️" color="info" title={`OP ${item.numero_op} – ${item.formula?.producto?.nombre}`} sub={`Responsable: ${item.responsable?.nombre} · Fórmula v${item.formula?.version}`} />
                      {item.consumos?.map((c, j) => (
                        <TrazeItem key={j} icon="📦" color="info"
                          title={`MP: ${c.mp?.nombre} · Lote: ${c.lote?.numero_lote ?? '—'}`}
                          sub={`Teórico: ${c.cantidad_teorica} · Real: ${c.cantidad_real ?? '—'}`} />
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  )
}

function TrazeItem({ icon, color, title, sub }: { icon: string; color: 'info' | 'success' | 'warning'; title: string; sub: string }) {
  const s = { info: 'bg-sky-50 border-l-sky-400', success: 'bg-emerald-50 border-l-emerald-400', warning: 'bg-amber-50 border-l-amber-400' }
  return (
    <div className={clsx('flex gap-3 items-start p-3 rounded-lg border-l-4', s[color])}>
      <span className="text-base mt-0.5">{icon}</span>
      <div>
        <p className="font-semibold text-xs text-slate-800">{title}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>
      </div>
    </div>
  )
}
