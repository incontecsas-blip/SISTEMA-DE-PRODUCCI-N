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
import clsx from 'clsx'

export default function ProduccionPage() {
  const { user, role } = useAuth()
  const supabase = createClient()

  const [ops, setOps]               = useState<OrdenProduccion[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'ops' | 'consumos'>('ops')
  const [opActiva, setOpActiva]     = useState<OrdenProduccion | null>(null)
  const [consumos, setConsumos]     = useState<(OpConsumo & { mp_nombre: string; mp_codigo: string; unidad: string })[]>([])
  const [mermaParam, setMermaParam] = useState(5)
  const [savingConsumos, setSavingConsumos] = useState(false)

  const fetchOPs = useCallback(async () => {
    let q = supabase
      .from('ordenes_produccion')
      .select('*, pedido:pedidos(numero_pedido), responsable:users(nombre), formula:formulas(version, producto:productos(nombre))')
      .order('created_at', { ascending: false })

    if (role === 'operario') q = q.eq('responsable_id', user?.id ?? '')

    const { data, error } = await q
    if (error) toast.error('Error al cargar OPs')
    else setOps(data ?? [])
    setLoading(false)
  }, [supabase, role, user?.id])

  useEffect(() => {
    fetchOPs()
    // Cargar parámetro de merma
    supabase.from('parametros_sistema').select('merma_aceptable_pct').single()
      .then(({ data }) => { if (data) setMermaParam(data.merma_aceptable_pct) })
  }, [supabase])

  async function iniciarOP(op: OrdenProduccion) {
    const { error } = await supabase
      .from('ordenes_produccion')
      .update({ estado: 'en_proceso', responsable_id: user?.id })
      .eq('id', op.id)
    if (error) toast.error('Error')
    else { toast.success(`OP ${op.numero_op} iniciada`); fetchOPs() }
  }

  async function abrirConsumos(op: OrdenProduccion) {
    setOpActiva(op)
    setTab('consumos')

    // Cargar consumos existentes con datos del MP
    const { data: consumosData } = await supabase
      .from('op_consumos')
      .select('*, mp:productos(nombre, codigo, unidad:unidades_medida(simbolo)), lote:lotes(numero_lote)')
      .eq('op_id', op.id)

    if (consumosData && consumosData.length > 0) {
      setConsumos(consumosData.map(c => ({
        ...c,
        mp_nombre: (c.mp as { nombre?: string })?.nombre ?? '—',
        mp_codigo: (c.mp as { codigo?: string })?.codigo ?? '—',
        unidad: ((c.mp as { unidad?: { simbolo?: string } })?.unidad)?.simbolo ?? 'kg',
      })))
    } else {
      // Generar consumos teóricos desde la fórmula
      const { data: reqs } = await supabase
        .rpc('fn_calcular_requerimientos', {
          p_formula_id: op.formula_id,
          p_cantidad_pt: op.cantidad_a_producir,
        })

      const nuevosConsumos = reqs?.map((r: {
        mp_id: string; mp_nombre: string; mp_codigo: string; unidad_sim: string; qty_teorica: number
      }) => ({
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
      })) ?? []

      // Insertar consumos teóricos en BD
      if (nuevosConsumos.length > 0) {
        const { data: inserted } = await supabase
          .from('op_consumos')
          .insert(nuevosConsumos.map(c => ({
            op_id: c.op_id, mp_id: c.mp_id,
            cantidad_teorica: c.cantidad_teorica,
          })))
          .select('*, mp:productos(nombre, codigo, unidad:unidades_medida(simbolo))')

        if (inserted) {
          setConsumos(inserted.map(c => ({
            ...c,
            mp_nombre: (c.mp as { nombre?: string })?.nombre ?? '—',
            mp_codigo: (c.mp as { codigo?: string })?.codigo ?? '—',
            unidad: ((c.mp as { unidad?: { simbolo?: string } })?.unidad)?.simbolo ?? 'kg',
          })))
        }
      } else {
        setConsumos([])
      }
    }
  }

  function updateCantidadReal(consumoId: string, valor: number) {
    setConsumos(cs => cs.map(c => c.id === consumoId ? { ...c, cantidad_real: valor } : c))
  }

  async function guardarConsumos() {
    setSavingConsumos(true)
    try {
      for (const c of consumos) {
        if (!c.id) continue
        await supabase.from('op_consumos')
          .update({ cantidad_real: c.cantidad_real })
          .eq('id', c.id)
        // El trigger fn_calcular_merma recalcula merma_pct y dentro_parametro automáticamente
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
    const sinCantidad = consumos.some(c => !c.cantidad_real)
    if (sinCantidad) { toast.error('Completa la cantidad real de todos los insumos'); return }

    setSavingConsumos(true)
    try {
      // 1. Guardar consumos finales
      for (const c of consumos) {
        if (!c.id) continue
        await supabase.from('op_consumos')
          .update({ cantidad_real: c.cantidad_real })
          .eq('id', c.id)
      }

      // 2. Registrar movimientos SALIDA_OP por cada consumo
      for (const c of consumos) {
        await supabase.from('movimientos_inventario').insert({
          producto_id: c.mp_id,
          lote_id: c.lote_id,
          tipo_movimiento: 'SALIDA_OP',
          cantidad: c.cantidad_real ?? c.cantidad_teorica,
          referencia_tipo: 'orden_produccion',
          referencia_id: opActiva.id,
          notas: `OP ${opActiva.numero_op}`,
          created_by: user?.id,
        })
      }

      // 3. Actualizar estado de OP — trigger actualizará el pedido
      await supabase.from('ordenes_produccion')
        .update({ estado: 'entregada_bodega', cantidad_producida: opActiva.cantidad_a_producir })
        .eq('id', opActiva.id)

      toast.success(`OP ${opActiva.numero_op} finalizada · Bodega notificada`)
      setTab('ops')
      setOpActiva(null)
      fetchOPs()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al finalizar')
    } finally {
      setSavingConsumos(false)
    }
  }

  if (loading) return <AppLayout title="Producción" breadcrumb="MÓDULOS / PRODUCCIÓN"><PageLoader /></AppLayout>

  const TABS = [
    { id: 'ops' as const, label: 'Órdenes de Producción' },
    { id: 'consumos' as const, label: opActiva ? `Consumos ${opActiva.numero_op}` : 'Consumos' },
  ]

  return (
    <AppLayout title="Producción" breadcrumb="MÓDULOS / PRODUCCIÓN">
      {/* Tabs */}
      <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit mb-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LISTA DE OPS ──────────────────────────── */}
      {tab === 'ops' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Órdenes de Producción</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md">{ops.length}</span>
          </div>
          {ops.length === 0
            ? <EmptyState icon="⚙️" title="Sin órdenes de producción" />
            : (
            <table className="data-table">
              <thead><tr><th>OP #</th><th>Pedido</th><th>Producto</th><th>Cant.</th><th>Responsable</th><th>Inicio</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {ops.map(op => {
                  const formula = op.formula as { version?: number; producto?: { nombre?: string } }
                  return (
                    <tr key={op.id}>
                      <td className="font-mono font-bold text-sky-600">{op.numero_op}</td>
                      <td className="font-mono text-slate-500">{(op.pedido as { numero_pedido?: string })?.numero_pedido ?? '—'}</td>
                      <td className="font-semibold">{formula?.producto?.nombre ?? '—'}</td>
                      <td className="font-mono">{op.cantidad_a_producir} kg</td>
                      <td className="text-slate-500 text-xs">{(op.responsable as { nombre?: string })?.nombre ?? '—'}</td>
                      <td className="font-mono text-xs text-slate-500">
                        {op.fecha_inicio ? format(new Date(op.fecha_inicio), 'dd/MM HH:mm') : '—'}
                      </td>
                      <td><OpStatusPill status={op.estado} /></td>
                      <td className="flex gap-1.5">
                        {op.estado === 'pendiente' && (
                          <button className="btn-success text-xs px-2 py-1" onClick={() => iniciarOP(op)}>▶ Iniciar</button>
                        )}
                        {op.estado === 'en_proceso' && (
                          <button className="btn-primary text-xs px-2 py-1" onClick={() => abrirConsumos(op)}>
                            Ver consumos
                          </button>
                        )}
                        {(op.estado === 'finalizada' || op.estado === 'entregada_bodega') && (
                          <button className="btn text-xs px-2 py-1" onClick={() => abrirConsumos(op)}>
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

      {/* ── CONSUMOS REAL VS TEÓRICO ─────────────── */}
      {tab === 'consumos' && opActiva && (
        <div className="card">
          <div className="card-header">
            <div>
              <p className="font-bold text-[14px]">{opActiva.numero_op} – Consumo Real vs. Teórico</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Cant. a producir: {opActiva.cantidad_a_producir} kg · Fórmula v{(opActiva.formula as { version?: number })?.version}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn text-xs" onClick={() => toast.success('PDF generado')}>⬇ PDF OP</button>
              <button
                className="btn text-xs"
                onClick={guardarConsumos}
                disabled={savingConsumos}
              >
                💾 Guardar
              </button>
              {opActiva.estado === 'en_proceso' && (
                <button className="btn-success text-xs" onClick={finalizarOP} disabled={savingConsumos}>
                  {savingConsumos ? 'Procesando...' : '✓ Finalizar y Entregar a Bodega'}
                </button>
              )}
              <button className="btn text-xs" onClick={() => { setTab('ops'); setOpActiva(null) }}>← Volver</button>
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
                  const merma = (c.cantidad_real ?? 0) - c.cantidad_teorica
                  const merma_pct = c.cantidad_teorica > 0 ? (merma / c.cantidad_teorica) * 100 : 0
                  const ok = merma_pct <= mermaParam
                  return (
                    <tr key={c.id}>
                      <td className="font-semibold">{c.mp_nombre}</td>
                      <td className="font-mono text-slate-500">{c.cantidad_teorica.toFixed(3)} {c.unidad}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <input
                            className="input font-mono w-24 text-sm"
                            type="number"
                            min={0}
                            step={0.001}
                            value={c.cantidad_real ?? ''}
                            onChange={e => updateCantidadReal(c.id, +e.target.value)}
                            disabled={opActiva.estado !== 'en_proceso'}
                          />
                          <span className="text-xs text-slate-400">{c.unidad}</span>
                        </div>
                      </td>
                      <td className={clsx('font-mono font-bold text-sm', merma > 0 ? 'text-sky-600' : 'text-slate-400')}>
                        {c.cantidad_real !== null ? merma.toFixed(3) : '—'}
                      </td>
                      <td className={clsx('font-mono text-sm', !ok ? 'text-red-500 font-bold' : 'text-slate-600')}>
                        {c.cantidad_real !== null ? `${merma_pct.toFixed(1)}%` : '—'}
                      </td>
                      <td>
                        {c.cantidad_real !== null
                          ? <span className={clsx('status-pill',
                              ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                 : 'bg-red-50 text-red-600 border-red-200'
                            )}>{ok ? '✓ OK' : '⚠ Alto'}</span>
                          : <span className="text-slate-300 text-xs">—</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <p className="text-xs text-slate-400 mt-3 border-t border-slate-100 pt-3">
              Parámetro de merma aceptable: <strong>{mermaParam}%</strong> · Configurable en Configuración → Parámetros
            </p>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
