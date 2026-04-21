// src/app/bodega/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, EmptyState, PageLoader, InfoBox, WarnBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { Producto, Lote } from '@/types/database'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

type Tab = 'solicitudes' | 'inventario' | 'pt' | 'lotes'

interface SolicitudDespacho {
  pedido_id: string; numero_pedido: string; cliente: string
  lineas: { producto: string; qty_teorica: number; unidad: string; stock_ok: boolean }[]
}

export default function BodegaPage() {
  const { user } = useAuth()
  const supabase  = createClient()

  const [tab, setTab]               = useState<Tab>('solicitudes')
  const [productos, setProductos]   = useState<Producto[]>([])
  const [lotes, setLotes]           = useState<Lote[]>([])
  const [ptLotes, setPtLotes]       = useState<Lote[]>([])
  const [solicitudes, setSolicitudes] = useState<SolicitudDespacho[]>([])
  const [loading, setLoading]       = useState(true)

  // Modal ingreso MP
  const [showIngreso, setShowIngreso] = useState(false)
  const [formMP, setFormMP] = useState({
    producto_id: '', proveedor: '', cantidad: 0, costo_unitario: 0,
    numero_lote: '', fecha_vencimiento: '',
  })
  const [saving, setSaving] = useState(false)

  // Alertas dinámicas
  const alertas = productos.filter(p => p.tipo === 'MP' && p.activo && p.stock_actual < p.stock_minimo)

  const loadData = useCallback(async () => {
    const [{ data: prods }, { data: allLotes }, { data: peds }] = await Promise.all([
      supabase.from('productos').select('*, unidad:unidades_medida(simbolo)').eq('activo', true).order('nombre'),
      supabase.from('lotes').select('*, producto:productos(nombre,codigo)').eq('activo', true).order('fecha_vencimiento', { ascending: true }),
      supabase.from('pedidos')
        .select('id, numero_pedido, cliente:clientes(nombre), lineas:pedidos_lineas(cantidad, producto:productos(nombre,id), unidad:unidades_medida(simbolo))')
        .eq('estado', 'confirmado'),
    ])

    setProductos(prods ?? [])
    setLotes((allLotes ?? []).filter((l: Lote) => {
      const prod = prods?.find(p => p.id === l.producto_id)
      return prod?.tipo === 'MP'
    }))
    setPtLotes((allLotes ?? []).filter((l: Lote) => {
      const prod = prods?.find(p => p.id === l.producto_id)
      return prod?.tipo === 'PT'
    }))

    // Construir solicitudes con verificación de stock
    const sols: SolicitudDespacho[] = (peds ?? []).map((p: {
      id: string; numero_pedido: string
      cliente: { nombre?: string } | null
      lineas: { cantidad: number; producto: { nombre: string; id: string } | null; unidad: { simbolo: string } | null }[]
    }) => ({
      pedido_id: p.id,
      numero_pedido: p.numero_pedido,
      cliente: p.cliente?.nombre ?? '—',
      lineas: (p.lineas ?? []).map(l => {
        const prod = prods?.find(pr => pr.id === l.producto?.id)
        return {
          producto: l.producto?.nombre ?? '—',
          qty_teorica: l.cantidad,
          unidad: l.unidad?.simbolo ?? 'kg',
          stock_ok: (prod?.stock_actual ?? 0) >= l.cantidad,
        }
      }),
    }))
    setSolicitudes(sols)
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadData() }, [loadData])

  async function despachar(pedidoId: string) {
    const { error } = await supabase
      .from('pedidos').update({ estado: 'en_produccion' }).eq('id', pedidoId)
    if (error) { toast.error('Error al despachar'); return }
    toast.success('Despachado a Producción · OP creada automáticamente')
    loadData()
  }

  async function handleIngresoMP() {
    if (!formMP.producto_id || !formMP.numero_lote || !formMP.cantidad) {
      toast.error('Completa todos los campos requeridos'); return
    }
    setSaving(true)
    try {
      // 1. Crear lote
      const { data: lote, error: eLote } = await supabase
        .from('lotes')
        .insert({
          producto_id: formMP.producto_id,
          numero_lote: formMP.numero_lote,
          proveedor: formMP.proveedor,
          cantidad_inicial: formMP.cantidad,
          cantidad_disponible: formMP.cantidad,
          costo_unitario: formMP.costo_unitario,
          fecha_vencimiento: formMP.fecha_vencimiento || null,
          created_by: user?.id,
        })
        .select().single()
      if (eLote) throw eLote

      // 2. Registrar movimiento (trigger actualizará stock_actual)
      const { error: eMov } = await supabase
        .from('movimientos_inventario')
        .insert({
          producto_id: formMP.producto_id,
          lote_id: lote.id,
          tipo_movimiento: 'ENTRADA',
          cantidad: formMP.cantidad,
          referencia_tipo: 'ingreso_manual',
          notas: `Ingreso lote ${formMP.numero_lote}`,
          created_by: user?.id,
        })
      if (eMov) throw eMov

      toast.success(`MP ingresada · Lote ${formMP.numero_lote} activo`)
      setShowIngreso(false)
      loadData()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar')
    } finally {
      setSaving(false)
    }
  }

  async function registrarEntrega(loteId: string, pedidoId: string) {
    const { error } = await supabase
      .from('pedidos').update({ estado: 'entregado', fecha_entrega_real: new Date().toISOString().split('T')[0] })
      .eq('id', pedidoId)
    if (error) { toast.error('Error'); return }
    toast.success('Entrega registrada · Pedido cerrado')
    loadData()
  }

  // Días hasta vencimiento
  function diasVenc(fecha: string | null) {
    if (!fecha) return null
    return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)
  }

  function stockPill(prod: Producto) {
    if (prod.stock_actual < prod.stock_minimo * 0.3)
      return <span className="status-pill bg-red-50 text-red-600 border-red-200">Crítico</span>
    if (prod.stock_actual < prod.stock_minimo)
      return <span className="status-pill bg-amber-50 text-amber-700 border-amber-200">Bajo mínimo</span>
    return <span className="status-pill bg-emerald-50 text-emerald-700 border-emerald-200">OK</span>
  }

  if (loading) return <AppLayout title="Bodega" breadcrumb="MÓDULOS / BODEGA"><PageLoader /></AppLayout>

  const TABS: { id: Tab; label: string }[] = [
    { id: 'solicitudes', label: 'Solicitudes de Despacho' },
    { id: 'inventario',  label: 'Inventario MP' },
    { id: 'pt',          label: 'Producto Terminado' },
    { id: 'lotes',       label: 'Lotes y Vencimientos' },
  ]

  const mpProductos = productos.filter(p => p.tipo === 'MP')

  return (
    <AppLayout
      title="Bodega"
      breadcrumb="MÓDULOS / BODEGA"
      action={<button className="btn-primary" onClick={() => setShowIngreso(true)}>+ Ingreso MP</button>}
    >
      {/* Tabs */}
      <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SOLICITUDES ─────────────────────────────── */}
      {tab === 'solicitudes' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card">
            <div className="card-header">
              <span className="font-bold text-[14px]">Pendientes de Despacho</span>
              <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md">{solicitudes.length}</span>
            </div>
            {solicitudes.length === 0
              ? <EmptyState icon="📦" title="Sin pedidos confirmados pendientes" />
              : (
              <table className="data-table">
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Materiales Req.</th><th>Stock</th><th>Acción</th></tr></thead>
                <tbody>
                  {solicitudes.map(s => (
                    <tr key={s.pedido_id}>
                      <td className="font-mono font-bold text-sky-600">{s.numero_pedido}</td>
                      <td className="font-semibold">{s.cliente}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {s.lineas.map((l, i) => (
                            <span key={i} className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-md">
                              {l.qty_teorica} {l.unidad} {l.producto}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {s.lineas.every(l => l.stock_ok)
                          ? <span className="text-emerald-600 font-semibold text-xs">✓ Suficiente</span>
                          : <span className="text-red-500 font-semibold text-xs">✗ Insuficiente</span>}
                      </td>
                      <td>
                        <button
                          className={clsx('btn text-xs', s.lineas.every(l => l.stock_ok) ? 'btn-primary' : '')}
                          disabled={!s.lineas.every(l => l.stock_ok)}
                          onClick={() => despachar(s.pedido_id)}
                        >
                          ▶ Despachar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Alertas de inventario — atadas a stock_minimo de productos */}
          <div className="card">
            <div className="card-header">
              <span className="font-bold text-[14px]">Alertas de Inventario</span>
              <span className="text-[10px] font-mono bg-red-100 border border-red-200 text-red-600 px-2 py-0.5 rounded-md">{alertas.length}</span>
            </div>
            <div className="p-4 flex flex-col gap-2.5">
              {alertas.length === 0 && <p className="text-center text-slate-400 text-sm py-6">✅ Sin alertas</p>}
              {alertas.map(p => {
                const pct = p.stock_minimo > 0 ? Math.round(p.stock_actual / p.stock_minimo * 100) : 0
                return (
                  <div key={p.id} className={clsx(
                    'flex gap-3 items-start p-3 rounded-lg border-l-4',
                    pct < 30 ? 'bg-red-50 border-l-red-400' : 'bg-amber-50 border-l-amber-400'
                  )}>
                    <span className="text-xl">{pct < 30 ? '📉' : '📦'}</span>
                    <div>
                      <p className="font-semibold text-slate-800 text-xs">{p.nombre}</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Stock: <strong>{p.stock_actual} {(p.unidad as { simbolo?: string })?.simbolo}</strong> · Mín: {p.stock_minimo}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── INVENTARIO MP ────────────────────────────── */}
      {tab === 'inventario' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Materias Primas</span>
            <div className="ml-auto flex gap-2">
              <button className="btn text-xs" onClick={() => toast.success('Excel generado')}>⬇ Excel</button>
            </div>
          </div>
          {mpProductos.map(p => {
            const ratio = p.stock_maximo > 0 ? Math.min(p.stock_actual / p.stock_maximo, 1) : 0
            const barColor = p.stock_actual < p.stock_minimo * 0.3 ? 'bg-red-400'
              : p.stock_actual < p.stock_minimo ? 'bg-amber-400' : 'bg-emerald-400'
            return (
              <div key={p.id} className="px-5 py-4 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3 mb-2">
                  <p className="font-semibold text-[13px] flex-1">{p.nombre}</p>
                  {stockPill(p)}
                  <p className="font-mono text-xs text-slate-500">
                    {p.stock_actual} / {p.stock_maximo} {(p.unidad as { simbolo?: string })?.simbolo}
                  </p>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${ratio * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-slate-400">
                  <span>Mín: {p.stock_minimo} · Máx: {p.stock_maximo}</span>
                  <span>Costo: ${p.costo_unitario}/{(p.unidad as { simbolo?: string })?.simbolo}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── PRODUCTO TERMINADO ──────────────────────── */}
      {tab === 'pt' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Producto Terminado en Bodega</span>
          </div>
          {ptLotes.length === 0
            ? <EmptyState icon="📦" title="Sin PT en bodega" />
            : (
            <table className="data-table">
              <thead><tr><th>Lote PT</th><th>Producto</th><th>Cantidad</th><th>Ingreso</th><th>Vencimiento</th><th>Estado</th><th>Acción</th></tr></thead>
              <tbody>
                {ptLotes.map(l => {
                  const dias = diasVenc(l.fecha_vencimiento)
                  return (
                    <tr key={l.id}>
                      <td className="font-mono font-bold text-sky-600">{l.numero_lote}</td>
                      <td className="font-semibold">{(l.producto as { nombre?: string })?.nombre}</td>
                      <td className="font-mono">{l.cantidad_disponible} kg</td>
                      <td className="font-mono text-slate-500 text-xs">{format(new Date(l.fecha_ingreso), 'dd/MM/yy')}</td>
                      <td className="font-mono text-xs">{l.fecha_vencimiento ? format(new Date(l.fecha_vencimiento), 'dd/MM/yy') : '—'}</td>
                      <td>
                        <span className={clsx('status-pill',
                          dias !== null && dias <= 7 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                          {dias !== null && dias <= 7 ? `Vence en ${dias}d` : 'OK'}
                        </span>
                      </td>
                      <td>
                        <button className="btn-success text-xs px-2 py-1"
                          onClick={() => registrarEntrega(l.id, '')}>
                          ✓ Despachar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── LOTES Y VENCIMIENTOS ─────────────────────── */}
      {tab === 'lotes' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Control de Lotes</span>
            <div className="ml-auto">
              <button className="btn text-xs" onClick={() => toast.success('Excel generado')}>⬇ Excel</button>
            </div>
          </div>
          <table className="data-table">
            <thead><tr><th>Lote</th><th>Material</th><th>Tipo</th><th>Disponible</th><th>Ingreso</th><th>Vencimiento</th><th>Días rest.</th><th>Estado</th></tr></thead>
            <tbody>
              {lotes.concat(ptLotes).map(l => {
                const dias = diasVenc(l.fecha_vencimiento)
                const prod = productos.find(p => p.id === l.producto_id)
                return (
                  <tr key={l.id}>
                    <td className="font-mono font-bold text-sky-600">{l.numero_lote}</td>
                    <td className="font-semibold">{(l.producto as { nombre?: string })?.nombre ?? '—'}</td>
                    <td><span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border',
                      prod?.tipo === 'PT' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                    )}>{prod?.tipo}</span></td>
                    <td className="font-mono">{l.cantidad_disponible} kg</td>
                    <td className="font-mono text-xs text-slate-500">{format(new Date(l.fecha_ingreso), 'dd/MM/yy')}</td>
                    <td className="font-mono text-xs">{l.fecha_vencimiento ? format(new Date(l.fecha_vencimiento), 'dd/MM/yy') : '—'}</td>
                    <td className={clsx('font-mono font-bold text-sm',
                      dias === null ? 'text-slate-400' : dias <= 3 ? 'text-red-500' : dias <= 7 ? 'text-amber-500' : 'text-emerald-600'
                    )}>
                      {dias ?? '—'}
                    </td>
                    <td>
                      <span className={clsx('status-pill',
                        dias === null ? 'bg-slate-100 text-slate-500 border-slate-200'
                        : dias <= 3 ? 'bg-red-50 text-red-600 border-red-200'
                        : dias <= 7 ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      )}>
                        {dias === null ? 'Sin fecha' : dias <= 3 ? 'Urgente' : dias <= 7 ? 'Próx. vencer' : 'OK'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Ingreso MP */}
      <Modal
        open={showIngreso}
        onClose={() => setShowIngreso(false)}
        title="Ingreso de Materia Prima"
        subtitle="Registrar entrada con lote y vencimiento"
        icon="📦"
        footer={
          <>
            <button className="btn" onClick={() => setShowIngreso(false)}>Cancelar</button>
            <button className="btn-primary" onClick={handleIngresoMP} disabled={saving}>
              {saving ? 'Registrando...' : '✓ Registrar Ingreso'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Materia Prima" required>
            <select className="input" value={formMP.producto_id} onChange={e => setFormMP(f => ({ ...f, producto_id: e.target.value }))}>
              <option value="">— Seleccionar —</option>
              {mpProductos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Proveedor">
            <input className="input" value={formMP.proveedor} onChange={e => setFormMP(f => ({ ...f, proveedor: e.target.value }))} placeholder="Nombre del proveedor" />
          </Field>
          <Field label="Cantidad" required>
            <input className="input font-mono" type="number" min={0.001} step={0.001} value={formMP.cantidad || ''} onChange={e => setFormMP(f => ({ ...f, cantidad: +e.target.value }))} />
          </Field>
          <Field label="Costo Unitario">
            <input className="input font-mono" type="number" min={0} step={0.0001} value={formMP.costo_unitario || ''} onChange={e => setFormMP(f => ({ ...f, costo_unitario: +e.target.value }))} placeholder="0.0000" />
          </Field>
          <Field label="N° de Lote" required>
            <input className="input font-mono" value={formMP.numero_lote} onChange={e => setFormMP(f => ({ ...f, numero_lote: e.target.value }))} placeholder="Ej: B-205" />
          </Field>
          <Field label="Fecha de Vencimiento" hint="Dejar vacío si no caduca">
            <input className="input" type="date" value={formMP.fecha_vencimiento} onChange={e => setFormMP(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
          </Field>
        </div>
        <InfoBox>
          💡 El stock se actualizará automáticamente. El lote quedará registrado en el historial aunque se hagan cargas posteriores de Excel.
        </InfoBox>
      </Modal>
    </AppLayout>
  )
}
