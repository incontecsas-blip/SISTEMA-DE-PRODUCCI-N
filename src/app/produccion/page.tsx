// src/app/produccion/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { OpStatusPill, EmptyState, PageLoader } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { OrdenProduccion, OpConsumo } from '@/types/database'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { downloadHtmlPdf } from '@/lib/download'
import clsx from 'clsx'

// ── tipos locales ──────────────────────────────────────────────
interface ConsumoRow extends OpConsumo {
  mp_nombre: string
  mp_codigo: string
  unidad: string
}

interface NuevoConsumoInsert {
  id: string
  op_id: string
  mp_id: string
  lote_id: null
  cantidad_teorica: number
  cantidad_real: null
  merma: number
  merma_pct: null
  dentro_parametro: null
  mp_nombre: string
  mp_codigo: string
  unidad: string
}

interface RpcRequerimiento {
  mp_id: string
  mp_nombre: string
  mp_codigo: string
  unidad_sim: string
  qty_teorica: number
}

export default function ProduccionPage() {
  const { user, role, tenantId, userId } = useAuth()
  const supabase = createClient()

  const [ops, setOps]               = useState<OrdenProduccion[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'ops' | 'consumos'>('ops')
  const [opActiva, setOpActiva]     = useState<OrdenProduccion | null>(null)
  const [consumos, setConsumos]     = useState<ConsumoRow[]>([])
  const [mermaParam, setMermaParam] = useState(5)
  const [savingConsumos, setSavingConsumos] = useState(false)
  // Modal Ver OP detalle
  const [opDetalle, setOpDetalle]   = useState<OrdenProduccion | null>(null)
  const [opIngredientes, setOpIngredientes] = useState<ConsumoRow[]>([])

  const fetchOPs = useCallback(async () => {
    let q = supabase
      .from('ordenes_produccion')
      .select('*, pedido:pedidos(numero_pedido,fecha_entrega_solicitada,hora_entrega_solicitada,created_at), responsable:users(nombre), formula:formulas(version, producto:productos(nombre))')
      .order('created_at', { ascending: false })

    if (role === 'operario') q = q.eq('responsable_id', user?.id ?? '')

    const { data, error } = await q
    if (error) toast.error('Error al cargar OPs')
    else setOps((data ?? []) as OrdenProduccion[])
    setLoading(false)
  }, [supabase, role, user?.id])

  useEffect(() => {
    fetchOPs()
    supabase
      .from('parametros_sistema')
      .select('merma_aceptable_pct')
      .single()
      .then(({ data }) => { if (data) setMermaParam(Number(data.merma_aceptable_pct)) })
  }, [fetchOPs, supabase])

  async function iniciarOP(op: OrdenProduccion) {
    const { error } = await supabase
      .from('ordenes_produccion')
      .update({ estado: 'en_proceso', responsable_id: user?.id })
      .eq('id', op.id)
    if (error) toast.error('Error al iniciar OP')
    else { toast.success(`OP ${op.numero_op} iniciada`); fetchOPs() }
  }

  // Ver detalle de OP con ingredientes teóricos calculados (sin iniciar)
  async function verDetalleOP(op: OrdenProduccion) {
    setOpDetalle(op)
    setOpIngredientes([])

    const { data: reqs } = await supabase
      .rpc('fn_calcular_requerimientos', {
        p_formula_id: op.formula_id,
        p_cantidad_pt: op.cantidad_a_producir,
      })

    if (reqs) {
      setOpIngredientes((reqs as RpcRequerimiento[]).map(r => ({
        id: '',
        op_id: op.id,
        mp_id: r.mp_id,
        lote_id: null,
        cantidad_teorica: r.qty_teorica,
        cantidad_real: null,
        merma: 0,
        merma_pct: null,
        dentro_parametro: null,
        mp_nombre: r.mp_nombre,
        mp_codigo: r.mp_codigo,
        unidad: r.unidad_sim,
      })))
    }
  }

  async function abrirConsumos(op: OrdenProduccion) {
    setOpActiva(op)
    setTab('consumos')

    // 1. Intentar cargar consumos existentes
    const { data: consumosData } = await supabase
      .from('op_consumos')
      .select('*, mp:productos(nombre, codigo, unidad:unidades_medida(simbolo)), lote:lotes(numero_lote)')
      .eq('op_id', op.id)

    if (consumosData && consumosData.length > 0) {
      setConsumos(consumosData.map(c => ({
        ...(c as OpConsumo),
        mp_nombre: (c.mp as { nombre?: string } | null)?.nombre ?? '—',
        mp_codigo: (c.mp as { codigo?: string } | null)?.codigo ?? '—',
        unidad:   ((c.mp as { unidad?: { simbolo?: string } } | null)?.unidad)?.simbolo ?? 'kg',
      })))
      return
    }

    // 2. Generar consumos teóricos desde la fórmula via RPC
    const { data: reqs } = await supabase
      .rpc('fn_calcular_requerimientos', {
        p_formula_id: op.formula_id,
        p_cantidad_pt: op.cantidad_a_producir,
      })

    const nuevosConsumos: NuevoConsumoInsert[] = (reqs as RpcRequerimiento[] ?? []).map(r => ({
      id: '',
      op_id: op.id,
      mp_id: r.mp_id,
      lote_id: null,
      cantidad_teorica: r.qty_teorica,
      cantidad_real: null,
      merma: 0,
      merma_pct: null,
      dentro_parametro: null,
      mp_nombre: r.mp_nombre,
      mp_codigo: r.mp_codigo,
      unidad: r.unidad_sim,
    }))

    if (nuevosConsumos.length === 0) { setConsumos([]); return }

    // 3. Insertar en BD (el trigger calcula merma automáticamente)
    const { data: inserted } = await supabase
      .from('op_consumos')
      .insert(nuevosConsumos.map((c: NuevoConsumoInsert) => ({
        op_id: c.op_id,
        mp_id: c.mp_id,
        cantidad_teorica: c.cantidad_teorica,
      })))
      .select('*, mp:productos(nombre, codigo, unidad:unidades_medida(simbolo))')

    if (inserted) {
      setConsumos(inserted.map(c => ({
        ...(c as OpConsumo),
        mp_nombre: (c.mp as { nombre?: string } | null)?.nombre ?? '—',
        mp_codigo: (c.mp as { codigo?: string } | null)?.codigo ?? '—',
        unidad:   ((c.mp as { unidad?: { simbolo?: string } } | null)?.unidad)?.simbolo ?? 'kg',
      })))
    } else {
      setConsumos([])
    }
  }

  function updateCantidadReal(consumoId: string, valor: number) {
    setConsumos(cs =>
      cs.map(c => c.id === consumoId ? { ...c, cantidad_real: valor } : c)
    )
  }

  async function guardarConsumos() {
    setSavingConsumos(true)
    try {
      for (const c of consumos) {
        if (!c.id) continue
        await supabase
          .from('op_consumos')
          .update({ cantidad_real: c.cantidad_real })
          .eq('id', c.id)
      }
      toast.success('Consumos guardados')
    } catch {
      toast.error('Error al guardar consumos')
    } finally {
      setSavingConsumos(false)
    }
  }

  async function finalizarOP() {
    if (!opActiva) return
    const sinCantidad = consumos.some(c => c.cantidad_real === null || c.cantidad_real === undefined)
    if (sinCantidad) { toast.error('Completa la cantidad real de todos los insumos'); return }

    setSavingConsumos(true)
    try {
      // 1. Guardar consumos finales
      await guardarConsumos()

      // 2. Registrar movimientos SALIDA_OP
      for (const c of consumos) {
        await supabase.from('movimientos_inventario').insert({
          tenant_id: tenantId,
          producto_id: c.mp_id,
          lote_id: c.lote_id,
          tipo_movimiento: 'SALIDA_OP',
          cantidad: c.cantidad_real ?? c.cantidad_teorica,
          referencia_tipo: 'orden_produccion',
          referencia_id: opActiva.id,
          notas: `OP ${opActiva.numero_op}`,
          created_by: userId,
        })
      }

      // 3. Finalizar OP — el trigger actualizará el pedido a listo_entrega
      await supabase
        .from('ordenes_produccion')
        .update({
          estado: 'entregada_bodega',
          cantidad_producida: opActiva.cantidad_a_producir,
        })
        .eq('id', opActiva.id)

      toast.success(`OP ${opActiva.numero_op} finalizada · Bodega notificada`)
      setTab('ops')
      setOpActiva(null)
      setConsumos([])
      fetchOPs()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al finalizar')
    } finally {
      setSavingConsumos(false)
    }
  }

  // ── PDF de una OP con consumos ────────────────────────────────
  function exportarPdfOP(op: OrdenProduccion, consumosData: ConsumoRow[]) {
    const formula = op.formula as {version?:number;producto?:{nombre?:string}}|null
    const prodNombre = (Array.isArray(formula?.producto)
      ? (formula?.producto as {nombre?:string}[])[0]?.nombre
      : (formula?.producto as {nombre?:string}|null)?.nombre) ?? '—'
    const resp = op.responsable as {nombre?:string}|null

    const rows = consumosData.map(c => {
      const real = c.cantidad_real ?? 0
      const merma = c.cantidad_teorica > 0 ? ((real - c.cantidad_teorica) / c.cantidad_teorica * 100) : 0
      return [
        c.mp_nombre,
        c.mp_codigo,
        c.cantidad_teorica.toFixed(4) + ' ' + c.unidad,
        c.cantidad_real != null ? c.cantidad_real.toFixed(4) + ' ' + c.unidad : '—',
        c.cantidad_real != null ? merma.toFixed(1) + '%' : '—',
        c.cantidad_real != null ? (merma <= mermaParam ? '✓ OK' : '⚠ Alto') : '—',
      ]
    })

    downloadHtmlPdf(
      `OP ${op.numero_op} — Consumos`,
      `Producto: ${prodNombre} · Cantidad: ${op.cantidad_a_producir} kg · Responsable: ${resp?.nombre ?? '—'} · Fórmula v${formula?.version ?? '—'}`,
      ['Materia Prima','Código','Cant. Teórica','Cant. Real','% Merma','Estado'],
      rows,
      `op_${op.numero_op}.html`,
      `Merma aceptable: ${mermaParam}%`
    )
  }

  if (loading) {
    return (
      <AppLayout title="Producción" breadcrumb="MÓDULOS / PRODUCCIÓN">
        <PageLoader />
      </AppLayout>
    )
  }

  const TABS = [
    { id: 'ops' as const,      label: 'Órdenes de Producción' },
    { id: 'consumos' as const, label: opActiva ? `Consumos ${opActiva.numero_op}` : 'Consumos' },
  ]

  return (
    <AppLayout title="Producción" breadcrumb="MÓDULOS / PRODUCCIÓN">
      {/* Tabs */}
      <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit mb-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LISTA DE OPs ─────────────────────────────── */}
      {tab === 'ops' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
            <span className="font-bold text-[14px] text-slate-800">Órdenes de Producción</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md">
              {ops.length}
            </span>
          </div>
          {ops.length === 0 ? (
            <EmptyState icon="⚙️" title="Sin órdenes de producción" subtitle="Se crean automáticamente al aprobar despacho en Bodega" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>OP #</th>
                  <th>Pedido</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Responsable</th>
                  <th>Inicio</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ops.map(op => {
                  const formula = op.formula as { version?: number; producto?: { nombre?: string } } | null
                  const pedido  = op.pedido  as { numero_pedido?: string } | null
                  const resp    = op.responsable as { nombre?: string } | null
                  return (
                    <tr key={op.id}>
                      <td className="font-mono font-bold text-sky-600">{op.numero_op}</td>
                      <td className="font-mono text-slate-500">{pedido?.numero_pedido ?? '—'}</td>
                      <td className="font-semibold">{formula?.producto?.nombre ?? '—'}</td>
                      <td className="font-mono">{op.cantidad_a_producir} kg</td>
                      <td className="text-slate-500 text-xs">{resp?.nombre ?? '—'}</td>
                      <td className="font-mono text-xs text-slate-500">
                        {op.created_at ? (
                          <div>
                            <div>{format(new Date(op.created_at), 'dd/MM/yy')}</div>
                            <div className="text-[10px] text-slate-400">{format(new Date(op.created_at), 'HH:mm')}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="font-mono text-xs text-slate-500">
                        {(op.pedido as {fecha_entrega_solicitada?:string}|null)?.fecha_entrega_solicitada ? (
                          <>
                            <div className="font-semibold">
                              {format(new Date((op.pedido as {fecha_entrega_solicitada:string}).fecha_entrega_solicitada), 'dd/MM/yyyy')}
                            </div>
                            {(op.pedido as {hora_entrega_solicitada?:string}|null)?.hora_entrega_solicitada && (
                              <div className="text-[10px] text-sky-500 font-bold">
                                🕐 {(op.pedido as {hora_entrega_solicitada:string}).hora_entrega_solicitada.slice(0,5)}
                              </div>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className="font-mono text-xs text-slate-500">
                        {op.estado === 'entregada_bodega' && op.fecha_fin ? (
                          <div>
                            <div>{format(new Date(op.fecha_fin), 'dd/MM/yy')}</div>
                            <div className="text-[10px] text-slate-400">{format(new Date(op.fecha_fin), 'HH:mm')}</div>
                          </div>
                        ) : op.estado === 'en_proceso' ? (
                          <span className="text-[10px] text-sky-600 font-semibold">En curso...</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="font-mono text-xs">
                        {op.fecha_inicio && op.fecha_fin ? (() => {
                          const mins = Math.round((new Date(op.fecha_fin).getTime() - new Date(op.fecha_inicio).getTime()) / 60000)
                          if (mins < 60) return <span className="text-emerald-600 font-bold">{mins} min</span>
                          const hrs = Math.floor(mins / 60)
                          const min = mins % 60
                          return <span className="text-emerald-600 font-bold">{hrs}h {min}m</span>
                        })() : op.estado === 'en_proceso' && op.fecha_inicio ? (() => {
                          const mins = Math.round((Date.now() - new Date(op.fecha_inicio).getTime()) / 60000)
                          const hrs = Math.floor(mins / 60)
                          const min = mins % 60
                          return <span className="text-sky-500 font-semibold">{hrs > 0 ? `${hrs}h ` : ''}{min}m ⏱</span>
                        })() : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="flex gap-1.5">
                        <button
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                          onClick={() => verDetalleOP(op)}
                        >
                          👁 Ver
                        </button>
                        {op.estado === 'pendiente' && (
                          <button
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600 transition-colors"
                            onClick={() => iniciarOP(op)}
                          >
                            ▶ Iniciar
                          </button>
                        )}
                        {op.estado === 'en_proceso' && (
                          <button
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-sky-500 text-white border border-sky-500 hover:bg-sky-600 transition-colors"
                            onClick={() => abrirConsumos(op)}
                          >
                            Ver consumos
                          </button>
                        )}
                        {(op.estado === 'finalizada' || op.estado === 'entregada_bodega') && (
                          <button
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                            onClick={() => abrirConsumos(op)}
                          >
                            Ver detalle
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── CONSUMOS REAL VS TEÓRICO ─────────────────── */}
      {tab === 'consumos' && opActiva && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2.5">
            <div>
              <p className="font-bold text-[14px] text-slate-800">
                {opActiva.numero_op} – Consumo Real vs. Teórico
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Cant. a producir: {opActiva.cantidad_a_producir} kg ·
                Fórmula v{(opActiva.formula as { version?: number } | null)?.version ?? '—'}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <button
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                onClick={() => opActiva && exportarPdfOP(opActiva, consumos)}
              >
                📄 PDF OP
              </button>
              <button
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                onClick={guardarConsumos}
                disabled={savingConsumos}
              >
                💾 Guardar
              </button>
              {opActiva.estado === 'en_proceso' && (
                <button
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-40"
                  onClick={finalizarOP}
                  disabled={savingConsumos}
                >
                  {savingConsumos ? 'Procesando...' : '✓ Finalizar y Entregar a Bodega'}
                </button>
              )}
              <button
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                onClick={() => { setTab('ops'); setOpActiva(null); setConsumos([]) }}
              >
                ← Volver
              </button>
            </div>
          </div>

          <div className="p-5">
            <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">
              Ingresa la cantidad real utilizada por cada insumo
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Materia Prima</th>
                  <th>Cant. Teórica</th>
                  <th>Cant. Real Usada</th>
                  <th>Merma (kg)</th>
                  <th>% Merma</th>
                  <th>Dentro del {mermaParam}%</th>
                </tr>
              </thead>
              <tbody>
                {consumos.map(c => {
                  const real      = c.cantidad_real ?? 0
                  const merma     = real - c.cantidad_teorica
                  const merma_pct = c.cantidad_teorica > 0
                    ? (merma / c.cantidad_teorica) * 100
                    : 0
                  const ok = merma_pct <= mermaParam
                  const haReal = c.cantidad_real !== null && c.cantidad_real !== undefined

                  return (
                    <tr key={c.id}>
                      <td className="font-semibold">{c.mp_nombre}</td>
                      <td className="font-mono text-slate-500">
                        {c.cantidad_teorica.toFixed(3)} {c.unidad}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input
                            className="w-24 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm font-mono px-3 py-2 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/10 transition-all"
                            type="number"
                            min={0}
                            step={0.001}
                            value={c.cantidad_real ?? ''}
                            onChange={e => updateCantidadReal(c.id, parseFloat(e.target.value) || 0)}
                            disabled={opActiva.estado !== 'en_proceso'}
                          />
                          <span className="text-xs text-slate-400">{c.unidad}</span>
                        </div>
                      </td>
                      <td className={clsx(
                        'font-mono font-bold text-sm',
                        haReal ? (merma > 0 ? 'text-sky-600' : 'text-slate-400') : 'text-slate-300'
                      )}>
                        {haReal ? merma.toFixed(3) : '—'}
                      </td>
                      <td className={clsx(
                        'font-mono text-sm',
                        haReal ? (!ok ? 'text-red-500 font-bold' : 'text-slate-600') : 'text-slate-300'
                      )}>
                        {haReal ? `${merma_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td>
                        {haReal ? (
                          <span className={clsx(
                            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                            ok
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-600 border-red-200'
                          )}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                            {ok ? '✓ OK' : '⚠ Alto'}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">
              Parámetro de merma aceptable: <strong>{mermaParam}%</strong> ·
              Configurable en Configuración → Parámetros
            </p>
          </div>
        </div>
      )}

      {/* Modal Ver OP Detalle */}
      {opDetalle && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setOpDetalle(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center text-xl">⚙️</div>
              <div>
                <h3 className="font-bold text-[15px]">{opDetalle.numero_op} — Detalle de Ingredientes</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Producto: {(opDetalle.formula as {producto?:{nombre?:string}}|null)?.producto?.nombre}
                  {' · '}Cantidad a producir: <strong>{opDetalle.cantidad_a_producir} kg</strong>
                </p>
              </div>
              <button onClick={() => setOpDetalle(null)}
                className="ml-auto w-8 h-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100">
                ✕
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">
                Ingredientes requeridos — Calculados con fórmula activa
              </p>

              {opIngredientes.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <div className="text-3xl mb-2">⏳</div>
                  <p className="text-sm">Calculando ingredientes...</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Materia Prima</th>
                      <th>Código</th>
                      <th>Cantidad Teórica</th>
                      <th>Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opIngredientes.map((ing, i) => (
                      <tr key={i}>
                        <td className="font-semibold">{ing.mp_nombre}</td>
                        <td className="font-mono text-xs text-slate-500">{ing.mp_codigo}</td>
                        <td className="font-mono font-bold text-sky-600 text-[15px]">
                          {ing.cantidad_teorica.toFixed(4)}
                        </td>
                        <td className="font-mono text-slate-500">{ing.unidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
              <button className="btn" onClick={() => setOpDetalle(null)}>Cerrar</button>
              {opDetalle.estado === 'pendiente' && (
                <button
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600"
                  onClick={() => { iniciarOP(opDetalle); setOpDetalle(null) }}
                >
                  ▶ Iniciar OP
                </button>
              )}
              {opDetalle.estado === 'en_proceso' && (
                <button
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-500 text-white border border-sky-500 hover:bg-sky-600"
                  onClick={() => { abrirConsumos(opDetalle); setOpDetalle(null) }}
                >
                  Ver consumos reales
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </AppLayout>
  )
}