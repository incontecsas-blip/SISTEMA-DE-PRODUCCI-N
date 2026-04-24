// src/app/reportes/page.tsx
'use client'

import { useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { OrderStatusPill, PageLoader } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { downloadCsv, downloadHtmlPdf } from '@/lib/download'

type ReporteId = 'pedidos' | 'produccion' | 'trazabilidad' | 'inventario'

// ── Tipos ──────────────────────────────────────────────────────
interface PedidoRow {
  id: string; numero_pedido: string; fecha_pedido: string
  fecha_entrega_solicitada: string; estado: string; total: number
  descuento_pct: number; subtotal: number
  cliente: { nombre?: string; ruc?: string } | null
  vendedor: { nombre?: string } | null
}
interface ProduccionRow {
  id: string; numero_op: string; created_at: string; estado: string
  cantidad_a_producir: number; cantidad_producida: number | null
  formula: { version?: number; producto?: { nombre?: string } } | null
  responsable: { nombre?: string } | null
  consumos: { cantidad_teorica: number; cantidad_real: number | null; merma_pct: number | null; mp?: { nombre?: string } }[]
}
interface InventarioRow {
  id: string; codigo: string; nombre: string; tipo: string
  stock_actual: number; stock_minimo: number; stock_maximo: number
  costo_unitario: number; caducidad_dias: number | null; activo: boolean
  unidad: { simbolo?: string } | null
}
interface TrazaRow {
  tipo: 'pedido' | 'op'
  numero: string; estado: string; fecha: string
  cliente?: string; producto?: string
  lineas?: { producto: string; cantidad: number }[]
  consumos?: { mp: string; teorico: number; real: number | null }[]
  historial?: { estado: string; fecha: string; usuario: string }[]
}

// ── Helpers locales de formato ────────────────────────────────

// ── Componente principal ───────────────────────────────────────
export default function ReportesPage() {
  const supabase = createClient()

  const [reporte, setReporte]   = useState<ReporteId>('pedidos')
  const [desde, setDesde]       = useState(() => new Date(new Date().setDate(1)).toISOString().split('T')[0])
  const [hasta, setHasta]       = useState(() => new Date().toISOString().split('T')[0])
  const [datos, setDatos]       = useState<unknown[]>([])
  const [cargando, setCargando] = useState(false)
  const [busqLote, setBusqLote] = useState('')
  const [trazaDatos, setTrazaDatos] = useState<TrazaRow[] | null>(null)

  // ── Generar reporte ──────────────────────────────────────────
  const generarReporte = useCallback(async () => {
    setCargando(true)
    setDatos([])
    setTrazaDatos(null)
    try {
      if (reporte === 'pedidos') {
        const { data, error } = await supabase
          .from('pedidos')
          .select('*, cliente:clientes(nombre,ruc), vendedor:users(nombre)')
          .gte('fecha_pedido', desde)
          .lte('fecha_pedido', hasta)
          .neq('estado', 'anulado')
          .order('fecha_pedido', { ascending: false })
        if (error) throw error
        setDatos(data ?? [])

      } else if (reporte === 'produccion') {
        const { data, error } = await supabase
          .from('ordenes_produccion')
          .select(`numero_op, created_at, estado, cantidad_a_producir, cantidad_producida,
            formula:formulas(version, producto:productos(nombre)),
            responsable:users(nombre),
            consumos:op_consumos(cantidad_teorica, cantidad_real, merma_pct, mp:productos(nombre))`)
          .gte('created_at', desde + 'T00:00:00')
          .lte('created_at', hasta + 'T23:59:59')
          .order('created_at', { ascending: false })
        if (error) throw error
        setDatos(data ?? [])

      } else if (reporte === 'inventario') {
        const { data, error } = await supabase
          .from('productos')
          .select('codigo, nombre, tipo, stock_actual, stock_minimo, stock_maximo, costo_unitario, caducidad_dias, activo, unidad:unidades_medida(simbolo)')
          .order('tipo').order('nombre')
        if (error) throw error
        setDatos(data ?? [])
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al generar reporte')
    } finally {
      setCargando(false)
    }
  }, [supabase, reporte, desde, hasta])

  // ── Trazabilidad ─────────────────────────────────────────────
  async function buscarTrazabilidad() {
    if (!busqLote.trim()) { toast.error('Ingresa un lote o número de pedido'); return }
    setCargando(true)
    setTrazaDatos(null)
    try {
      const term = busqLote.trim()
      const rows: TrazaRow[] = []

      const { data: pedidos } = await supabase
        .from('pedidos')
        .select(`numero_pedido, estado, fecha_pedido, fecha_entrega_solicitada,
          cliente:clientes(nombre),
          lineas:pedidos_lineas(cantidad, producto:productos(nombre)),
          historial:pedidos_historial(estado_nuevo, created_at, usuario:users(nombre))`)
        .or(`numero_pedido.ilike.%${term}%`)
        .limit(3)

      for (const p of (pedidos ?? []) as unknown as {
        numero_pedido: string; estado: string; fecha_pedido: string; fecha_entrega_solicitada: string
        cliente: {nombre?:string}|null
        lineas: {cantidad:number;producto:{nombre?:string}|null}[]
        historial: {estado_nuevo:string;created_at:string;usuario:{nombre?:string}|null}[]
      }[]) {
        rows.push({
          tipo: 'pedido', numero: p.numero_pedido, estado: p.estado,
          fecha: p.fecha_pedido,
          cliente: (p.cliente as {nombre?:string}|null)?.nombre ?? '—',
          lineas: (p.lineas ?? []).map(l => ({
            producto: (l.producto as {nombre?:string}|null)?.nombre ?? '—',
            cantidad: l.cantidad,
          })),
          historial: (p.historial ?? []).map(h => ({
            estado: h.estado_nuevo,
            fecha: format(new Date(h.created_at), 'dd/MM/yy HH:mm'),
            usuario: (h.usuario as {nombre?:string}|null)?.nombre ?? 'Sistema',
          })),
        })
      }

      const { data: ops } = await supabase
        .from('ordenes_produccion')
        .select(`numero_op, estado, created_at,
          formula:formulas(producto:productos(nombre)),
          consumos:op_consumos(cantidad_teorica, cantidad_real, mp:productos(nombre), lote:lotes(numero_lote))`)
        .or(`numero_op.ilike.%${term}%`)
        .limit(3)

      for (const op of (ops ?? []) as unknown as {
        numero_op: string; estado: string; created_at: string
        formula: {producto:{nombre?:string}|null}|null
        consumos: {cantidad_teorica:number;cantidad_real:number|null;mp:{nombre?:string}|null}[]
      }[]) {
        const formulaObj = Array.isArray(op.formula) ? op.formula[0] : op.formula
        const prodObj = Array.isArray(formulaObj?.producto) ? formulaObj?.producto[0] : formulaObj?.producto
        rows.push({
          tipo: 'op', numero: op.numero_op, estado: op.estado,
          fecha: op.created_at,
          producto: prodObj?.nombre ?? '—',
          consumos: (op.consumos ?? []).map((c: {cantidad_teorica:number;cantidad_real:number|null;mp:{nombre?:string}|{nombre?:string}[]|null}) => {
            const mpObj = Array.isArray(c.mp) ? c.mp[0] : c.mp
            return { mp: mpObj?.nombre ?? '—', teorico: c.cantidad_teorica, real: c.cantidad_real }
          }),
        })
      }

      setTrazaDatos(rows)
      if (!rows.length) toast.error('No se encontró información para: ' + term)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error en trazabilidad')
    } finally {
      setCargando(false)
    }
  }

  // ── Exportar Excel (CSV real) ─────────────────────────────────
  function exportarExcel() {
    if (!datos.length && !trazaDatos?.length) { toast.error('Genera el reporte primero'); return }
    const slug = `${reporte}_${desde}_${hasta}`

    if (reporte === 'pedidos') {
      const rows = (datos as PedidoRow[]).map(p => [
        p.numero_pedido,
        format(new Date(p.fecha_pedido), 'dd/MM/yyyy'),
        format(new Date(p.fecha_entrega_solicitada), 'dd/MM/yyyy'),
        (p.cliente as {nombre?:string}|null)?.nombre ?? '—',
        (p.cliente as {ruc?:string}|null)?.ruc ?? '—',
        (p.vendedor as {nombre?:string}|null)?.nombre ?? '—',
        p.estado,
        p.descuento_pct,
        Number(p.subtotal).toFixed(2),
        Number(p.total).toFixed(2),
      ])
      downloadCsv(
        ['Pedido','F. Pedido','F. Entrega','Cliente','RUC','Vendedor','Estado','Desc. %','Subtotal','Total'],
        rows, `pedidos_${slug}.csv`
      )

    } else if (reporte === 'produccion') {
      const rows = (datos as ProduccionRow[]).map(op => {
        const f = op.formula as {version?:number;producto?:{nombre?:string}}|null
        const prodNombre = Array.isArray(f?.producto) ? (f?.producto as {nombre?:string}[])[0]?.nombre : f?.producto?.nombre
        const maxMerma = Math.max(...(op.consumos ?? []).map(c => c.merma_pct ?? 0))
        return [
          op.numero_op,
          format(new Date(op.created_at), 'dd/MM/yyyy'),
          prodNombre ?? '—',
          `v${f?.version ?? '—'}`,
          (op.responsable as {nombre?:string}|null)?.nombre ?? '—',
          op.estado,
          op.cantidad_a_producir,
          op.cantidad_producida ?? '—',
          maxMerma.toFixed(1) + '%',
        ]
      })
      downloadCsv(
        ['OP #','Fecha','Producto','Fórmula','Responsable','Estado','Cant. Programada','Cant. Producida','Merma máx.'],
        rows, `produccion_${slug}.csv`
      )

    } else if (reporte === 'inventario') {
      const rows = (datos as InventarioRow[]).map(p => {
        const unid = Array.isArray(p.unidad) ? (p.unidad as {simbolo?:string}[])[0]?.simbolo : (p.unidad as {simbolo?:string}|null)?.simbolo
        const valor = p.stock_actual * p.costo_unitario
        return [
          p.codigo, p.nombre, p.tipo, unid ?? '—',
          p.stock_actual, p.stock_minimo, p.stock_maximo,
          Number(p.costo_unitario).toFixed(4),
          valor.toFixed(2),
          p.caducidad_dias ?? 'N/A',
          p.activo ? 'Activo' : 'Inactivo',
        ]
      })
      const totalValor = (datos as InventarioRow[]).reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0)
      rows.push(['', 'TOTAL VALORIZADO', '', '', '', '', '', '', totalValor.toFixed(2), '', ''])
      downloadCsv(
        ['Código','Nombre','Tipo','Unidad','Stock Actual','Stock Mín.','Stock Máx.','Costo Unit.','Valor Total','Caducidad días','Estado'],
        rows, `inventario_${slug}.csv`
      )

    } else if (reporte === 'trazabilidad' && trazaDatos) {
      const rows = trazaDatos.map(r => [
        r.tipo.toUpperCase(), r.numero, r.estado, format(new Date(r.fecha), 'dd/MM/yyyy'),
        r.cliente ?? r.producto ?? '—',
        r.lineas?.map(l => `${l.cantidad} ${l.producto}`).join(' | ') ?? '—',
      ])
      downloadCsv(['Tipo','Número','Estado','Fecha','Cliente/Producto','Líneas'], rows,
        `trazabilidad_${term}.csv`.replace(/\s/g, '_'))
    }

    toast.success('✅ Excel descargado')
  }

  // ── Exportar PDF (HTML imprimible) ────────────────────────────
  function exportarPdf() {
    if (!datos.length && !trazaDatos?.length) { toast.error('Genera el reporte primero'); return }
    const slug = `${reporte}_${desde}_${hasta}`
    const fechaStr = `Del ${format(new Date(desde), 'dd/MM/yyyy')} al ${format(new Date(hasta), 'dd/MM/yyyy')}`

    if (reporte === 'pedidos') {
      const rows = (datos as PedidoRow[]).map(p => [
        p.numero_pedido,
        format(new Date(p.fecha_pedido), 'dd/MM/yy'),
        (p.cliente as {nombre?:string}|null)?.nombre ?? '—',
        (p.vendedor as {nombre?:string}|null)?.nombre ?? '—',
        p.estado,
        '$' + Number(p.total).toFixed(2),
      ])
      downloadHtmlPdf('Reporte de Pedidos', fechaStr,
        ['Pedido','Fecha','Cliente','Vendedor','Estado','Total'], rows,
        `pedidos_${slug}.html`,
        `Total: $${(datos as PedidoRow[]).reduce((s, p) => s + Number(p.total), 0).toFixed(2)}`)

    } else if (reporte === 'produccion') {
      const rows = (datos as ProduccionRow[]).map(op => {
        const f = op.formula as {version?:number;producto?:{nombre?:string}|{nombre?:string}[]}|null
        const prodNombre = Array.isArray(f?.producto)
          ? (f?.producto as {nombre?:string}[])[0]?.nombre
          : (f?.producto as {nombre?:string}|null)?.nombre
        const maxMerma = Math.max(0, ...(op.consumos ?? []).map(c => c.merma_pct ?? 0))
        return [
          op.numero_op,
          format(new Date(op.created_at), 'dd/MM/yy'),
          prodNombre ?? '—',
          (op.responsable as {nombre?:string}|null)?.nombre ?? '—',
          op.estado,
          op.cantidad_a_producir + ' kg',
          (op.cantidad_producida ?? '—') + (op.cantidad_producida ? ' kg' : ''),
          maxMerma.toFixed(1) + '%',
        ]
      })
      downloadHtmlPdf('Reporte de Producción', fechaStr,
        ['OP #','Fecha','Producto','Responsable','Estado','Programado','Producido','Merma máx.'], rows,
        `produccion_${slug}.html`)

    } else if (reporte === 'inventario') {
      const rows = (datos as InventarioRow[]).map(p => {
        const unid = Array.isArray(p.unidad)
          ? (p.unidad as {simbolo?:string}[])[0]?.simbolo
          : (p.unidad as {simbolo?:string}|null)?.simbolo
        return [
          p.codigo, p.nombre, p.tipo, unid ?? '—',
          p.stock_actual,
          p.stock_minimo,
          '$' + Number(p.costo_unitario).toFixed(4),
          '$' + (p.stock_actual * p.costo_unitario).toFixed(2),
        ]
      })
      const total = (datos as InventarioRow[]).reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0)
      rows.push(['', 'TOTAL', '', '', '', '', '', '$' + total.toFixed(2)])
      const totalInv = (datos as InventarioRow[]).reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0)
      downloadHtmlPdf('Inventario Valorizado', format(new Date(), 'dd/MM/yyyy'),
        ['Código','Nombre','Tipo','Unidad','Stock','Mín.','Costo Unit.','Valor Total'], rows,
        `inventario_${slug}.html`,
        `Valor total: $${totalInv.toFixed(2)}`)

    } else if (reporte === 'trazabilidad' && trazaDatos) {
      const rows = trazaDatos.map(r => [
        r.tipo.toUpperCase(), r.numero, r.estado,
        format(new Date(r.fecha), 'dd/MM/yyyy'),
        r.cliente ?? r.producto ?? '—',
      ])
      downloadHtmlPdf(`Trazabilidad: ${busqLote}`, format(new Date(), 'dd/MM/yyyy'),
        ['Tipo','Número','Estado','Fecha','Cliente/Producto'], rows,
        `trazabilidad_${busqLote.replace(/\s/g, '_')}.html`)
    }

    toast.success('✅ PDF abierto en nueva pestaña — usa Ctrl+P para guardar como PDF')
  }

  // ── RENDER ────────────────────────────────────────────────────
  const REPORTES = [
    { id: 'pedidos'      as const, icon: '📋', label: 'Pedidos',      desc: 'Por fecha, cliente, estado' },
    { id: 'produccion'   as const, icon: '⚙️', label: 'Producción',   desc: 'OPs, merma real vs teórico' },
    { id: 'trazabilidad' as const, icon: '🔍', label: 'Trazabilidad', desc: 'Por lote o número de pedido' },
    { id: 'inventario'   as const, icon: '📦', label: 'Inventario',   desc: 'Stock valorizado actual' },
  ]
  const CARD_TOPS = ['from-sky-400 to-sky-600','from-emerald-400 to-emerald-600','from-amber-400 to-amber-600','from-violet-400 to-violet-600']
  const hayDatos = datos.length > 0 || (trazaDatos?.length ?? 0) > 0
  const term = busqLote

  return (
    <AppLayout title="Reportes" breadcrumb="MÓDULOS / REPORTES">
      {/* Selector de reporte */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {REPORTES.map((r, i) => (
          <button key={r.id} onClick={() => { setReporte(r.id); setDatos([]); setTrazaDatos(null) }}
            className={clsx('text-left p-4 rounded-2xl border-2 transition-all hover:shadow-md',
              reporte === r.id ? 'border-sky-400 bg-sky-50 shadow-md' : 'bg-white border-transparent shadow-sm hover:-translate-y-0.5')}>
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3 bg-gradient-to-br', CARD_TOPS[i])}>
              {r.icon}
            </div>
            <p className="font-bold text-sm">{r.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{r.desc}</p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-wrap gap-3 items-center">
        {reporte !== 'trazabilidad' ? (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">Desde</label>
              <input className="input w-36" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600">Hasta</label>
              <input className="input w-36" type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
            <button className="btn-primary" onClick={generarReporte} disabled={cargando}>
              {cargando ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generando...
                </span>
              ) : '🔎 Generar'}
            </button>
          </>
        ) : (
          <>
            <input className="input w-72" placeholder="N° de Pedido o N° de OP (ej: PED-001, OP-003)"
              value={busqLote} onChange={e => setBusqLote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscarTrazabilidad()} />
            <button className="btn-primary" onClick={buscarTrazabilidad} disabled={cargando}>
              {cargando ? '...' : '🔍 Buscar'}
            </button>
          </>
        )}

        {/* Botones de exportación — siempre visibles cuando hay datos */}
        {hayDatos && (
          <div className="ml-auto flex gap-2">
            <button className="btn text-xs flex items-center gap-1.5" onClick={exportarExcel}>
              📊 Descargar Excel
            </button>
            <button className="btn text-xs flex items-center gap-1.5" onClick={exportarPdf}>
              📄 Descargar PDF
            </button>
            <span className="text-xs text-slate-400 self-center">
              {datos.length || trazaDatos?.length} registros
            </span>
          </div>
        )}
      </div>

      {/* ── RESULTADOS PEDIDOS ─────────────────────────────── */}
      {reporte === 'pedidos' && datos.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Pedidos</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md ml-2">{datos.length}</span>
            <div className="ml-auto text-right">
              <span className="font-mono font-bold text-sky-600 text-[15px]">
                Total: ${(datos as PedidoRow[]).reduce((s, p) => s + Number(p.total), 0).toFixed(2)}
              </span>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Pedido</th><th>F. Pedido</th><th>Cliente</th><th>RUC</th><th>Vendedor</th><th>F. Entrega</th><th>Desc.</th><th>Subtotal</th><th>Total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {(datos as PedidoRow[]).map(p => (
                <tr key={p.id}>
                  <td className="font-mono font-bold text-sky-600">{p.numero_pedido}</td>
                  <td className="font-mono text-xs">{format(new Date(p.fecha_pedido), 'dd/MM/yy')}</td>
                  <td className="font-semibold">{(p.cliente as {nombre?:string}|null)?.nombre ?? '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{(p.cliente as {ruc?:string}|null)?.ruc ?? '—'}</td>
                  <td className="text-slate-500 text-xs">{(p.vendedor as {nombre?:string}|null)?.nombre ?? '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{format(new Date(p.fecha_entrega_solicitada), 'dd/MM/yy')}</td>
                  <td className="font-mono text-xs">{p.descuento_pct}%</td>
                  <td className="font-mono">${Number(p.subtotal).toFixed(2)}</td>
                  <td className="font-mono font-bold text-sky-600">${Number(p.total).toFixed(2)}</td>
                  <td><OrderStatusPill status={p.estado as never} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── RESULTADOS PRODUCCIÓN ──────────────────────────── */}
      {reporte === 'produccion' && datos.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Órdenes de Producción</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md ml-2">{datos.length}</span>
          </div>
          <table className="data-table">
            <thead><tr><th>OP #</th><th>Fecha</th><th>Producto</th><th>Fórmula</th><th>Responsable</th><th>Estado</th><th>Programado</th><th>Producido</th><th>Merma máx.</th></tr></thead>
            <tbody>
              {(datos as ProduccionRow[]).map((op, i) => {
                const f = op.formula as {version?:number;producto?:{nombre?:string}|{nombre?:string}[]}|null
                const prodNombre = Array.isArray(f?.producto)
                  ? (f?.producto as {nombre?:string}[])[0]?.nombre
                  : (f?.producto as {nombre?:string}|null)?.nombre
                const maxMerma = Math.max(0, ...(op.consumos ?? []).map(c => c.merma_pct ?? 0))
                return (
                  <tr key={i}>
                    <td className="font-mono font-bold text-sky-600">{op.numero_op}</td>
                    <td className="font-mono text-xs">{format(new Date(op.created_at), 'dd/MM/yy')}</td>
                    <td className="font-semibold">{prodNombre ?? '—'}</td>
                    <td className="font-mono text-xs">v{f?.version ?? '—'}</td>
                    <td className="text-slate-500 text-xs">{(op.responsable as {nombre?:string}|null)?.nombre ?? '—'}</td>
                    <td><span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                      op.estado === 'entregada_bodega' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200')}>
                      {op.estado}</span></td>
                    <td className="font-mono">{op.cantidad_a_producir} kg</td>
                    <td className="font-mono">{op.cantidad_producida ?? '—'}{op.cantidad_producida ? ' kg' : ''}</td>
                    <td className={clsx('font-mono font-bold text-sm',
                      maxMerma > 5 ? 'text-red-500' : maxMerma > 2 ? 'text-amber-500' : 'text-emerald-600')}>
                      {maxMerma.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── RESULTADOS INVENTARIO ──────────────────────────── */}
      {reporte === 'inventario' && datos.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Inventario Valorizado</span>
            <div className="ml-auto font-mono font-bold text-sky-600 text-[15px]">
              Total: ${(datos as InventarioRow[]).reduce((s, p) => s + p.stock_actual * p.costo_unitario, 0).toFixed(2)}
            </div>
          </div>
          <table className="data-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Unidad</th><th>Stock Actual</th><th>Stock Mín.</th><th>Stock Máx.</th><th>Costo Unit.</th><th>Valor Total</th><th>Estado</th></tr></thead>
            <tbody>
              {(datos as InventarioRow[]).map((p, i) => {
                const unid = Array.isArray(p.unidad)
                  ? (p.unidad as {simbolo?:string}[])[0]?.simbolo
                  : (p.unidad as {simbolo?:string}|null)?.simbolo
                return (
                  <tr key={i}>
                    <td className="font-mono text-xs font-semibold">{p.codigo}</td>
                    <td className="font-semibold">{p.nombre}</td>
                    <td><span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border',
                      p.tipo === 'PT' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>{p.tipo}</span></td>
                    <td className="font-mono text-xs">{unid}</td>
                    <td className={clsx('font-mono font-bold text-sm', p.stock_actual < p.stock_minimo ? 'text-red-500' : 'text-emerald-600')}>{p.stock_actual}</td>
                    <td className="font-mono text-xs text-slate-500">{p.stock_minimo}</td>
                    <td className="font-mono text-xs text-slate-500">{p.stock_maximo}</td>
                    <td className="font-mono text-xs text-slate-500">${Number(p.costo_unitario).toFixed(4)}</td>
                    <td className="font-mono font-semibold text-sky-600">${(p.stock_actual * p.costo_unitario).toFixed(2)}</td>
                    <td><span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                      p.activo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {p.activo ? 'Activo' : 'Inactivo'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── RESULTADOS TRAZABILIDAD ────────────────────────── */}
      {reporte === 'trazabilidad' && trazaDatos !== null && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Trazabilidad: {busqLote}</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md ml-2">{trazaDatos.length}</span>
          </div>
          {trazaDatos.length === 0
            ? <div className="p-10 text-center text-slate-400 text-sm">Sin resultados para "{busqLote}"</div>
            : (
            <div className="p-5 flex flex-col gap-4">
              {trazaDatos.map((r, i) => (
                <div key={i} className={clsx('border rounded-xl overflow-hidden',
                  r.tipo === 'pedido' ? 'border-sky-200' : 'border-emerald-200')}>
                  <div className={clsx('px-4 py-3 flex items-center gap-3 border-b',
                    r.tipo === 'pedido' ? 'bg-sky-50 border-sky-200' : 'bg-emerald-50 border-emerald-200')}>
                    <span className="text-xl">{r.tipo === 'pedido' ? '📋' : '⚙️'}</span>
                    <div>
                      <p className="font-bold text-slate-800">{r.tipo === 'pedido' ? 'Pedido' : 'OP'} {r.numero}</p>
                      <p className="text-xs text-slate-500">
                        Estado: <strong>{r.estado}</strong>
                        {' · '}Fecha: {format(new Date(r.fecha), 'dd/MM/yyyy')}
                        {r.cliente && ` · Cliente: ${r.cliente}`}
                        {r.producto && ` · Producto: ${r.producto}`}
                      </p>
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {r.lineas && (
                      <div>
                        <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">Líneas del pedido</p>
                        <table className="data-table"><thead><tr><th>Producto</th><th>Cantidad</th></tr></thead>
                          <tbody>{r.lineas.map((l, j) => <tr key={j}><td>{l.producto}</td><td className="font-mono">{l.cantidad}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {r.historial && (
                      <div>
                        <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">Historial de estados</p>
                        <div className="flex flex-col gap-1.5">
                          {r.historial.map((h, j) => (
                            <div key={j} className="flex items-center gap-2 text-xs">
                              <span className="w-2 h-2 rounded-full bg-sky-400 flex-shrink-0" />
                              <span className="font-semibold">{h.estado}</span>
                              <span className="text-slate-400">{h.fecha}</span>
                              <span className="text-slate-400">· {h.usuario}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {r.consumos && (
                      <div className="md:col-span-2">
                        <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">Consumos</p>
                        <table className="data-table"><thead><tr><th>MP</th><th>Teórico</th><th>Real</th></tr></thead>
                          <tbody>{r.consumos.map((c, j) => (
                            <tr key={j}><td>{c.mp}</td>
                              <td className="font-mono">{c.teorico.toFixed(3)}</td>
                              <td className="font-mono">{c.real?.toFixed(3) ?? '—'}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Estado vacío */}
      {!cargando && !hayDatos && reporte !== 'trazabilidad' && (
        <div className="card">
          <div className="text-center py-16 px-6">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-slate-700 font-bold text-sm">Selecciona el rango de fechas y genera el reporte</p>
            <p className="text-slate-400 text-xs mt-1">Los botones de Excel y PDF aparecen automáticamente con los datos del filtro aplicado</p>
          </div>
        </div>
      )}
    </AppLayout>
  )
}