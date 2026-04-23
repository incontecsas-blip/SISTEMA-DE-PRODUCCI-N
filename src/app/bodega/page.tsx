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

interface IngredienteReq {
  mp_id: string
  mp_nombre: string
  mp_codigo: string
  unidad: string
  qty_teorica: number
  stock_actual: number
  stock_ok: boolean
}

interface SolicitudDespacho {
  pedido_id: string
  numero_pedido: string
  cliente: string
  fecha_entrega: string
  lineas: {
    producto: string
    cantidad: number
    unidad: string
    precio_unitario: number
    descuento_pct: number
    subtotal: number
    ingredientes: IngredienteReq[]
  }[]
  todos_ingredientes_ok: boolean
}

export default function BodegaPage() {
  const { tenantId, userId } = useAuth()
  const supabase = createClient()

  const [tab, setTab]             = useState<Tab>('solicitudes')
  const [productos, setProductos] = useState<Producto[]>([])
  const [lotes, setLotes]         = useState<Lote[]>([])
  const [ptLotes, setPtLotes]     = useState<Lote[]>([])
  const [solicitudes, setSolicitudes] = useState<SolicitudDespacho[]>([])
  const [loading, setLoading]     = useState(true)

  // Modal ver pedido detalle
  const [pedidoDetalle, setPedidoDetalle] = useState<SolicitudDespacho | null>(null)

  // Modal ingreso MP
  const [showIngreso, setShowIngreso] = useState(false)
  const [formMP, setFormMP] = useState({
    producto_id: '', proveedor: '', cantidad: 0,
    costo_unitario: 0, numero_lote: '', fecha_vencimiento: '',
  })
  const [saving, setSaving] = useState(false)

  const alertas = productos.filter(p => p.tipo === 'MP' && p.activo && p.stock_actual < p.stock_minimo)

  const loadData = useCallback(async () => {
    const [{ data: prods }, { data: allLotes }, { data: peds }] = await Promise.all([
      supabase.from('productos')
        .select('*, unidad:unidades_medida(simbolo)')
        .eq('activo', true).order('nombre'),

      supabase.from('lotes')
        .select('*, producto:productos(nombre,codigo,tipo)')
        .eq('activo', true)
        .order('fecha_vencimiento', { ascending: true }),

      // Pedidos confirmados con líneas, productos y fórmulas activas
      supabase.from('pedidos')
        .select(`
          id, numero_pedido, fecha_entrega_solicitada,
          cliente:clientes(nombre),
          lineas:pedidos_lineas(
            cantidad, precio_unitario, descuento_pct, subtotal_linea,
            producto:productos(id, nombre, codigo),
            unidad:unidades_medida(simbolo)
          )
        `)
        .eq('estado', 'confirmado'),
    ])

    if (!prods) { setLoading(false); return }

    setProductos(prods)
    setLotes((allLotes ?? []).filter(l => {
      const p = prods.find(pr => pr.id === l.producto_id)
      return p?.tipo === 'MP'
    }))
    setPtLotes((allLotes ?? []).filter(l => {
      const p = prods.find(pr => pr.id === l.producto_id)
      return p?.tipo === 'PT'
    }))

    // Construir solicitudes con ingredientes calculados
    const sols: SolicitudDespacho[] = []

    for (const ped of (peds ?? []) as unknown as {
      id: string; numero_pedido: string; fecha_entrega_solicitada: string
      cliente: { nombre?: string } | null
      lineas: {
        cantidad: number; precio_unitario: number; descuento_pct: number; subtotal_linea: number
        producto: { id: string; nombre: string; codigo: string } | null
        unidad: { simbolo: string } | null
      }[]
    }[]) {
      const lineasConIngredientes = []
      let todos_ok = true

      for (const linea of (ped.lineas ?? [])) {
        if (!linea.producto?.id) continue

        // Buscar fórmula activa del producto
        const { data: formula } = await supabase
          .from('formulas')
          .select('id, base_cantidad, lineas:formulas_lineas(cantidad, mp:productos(id,nombre,codigo), unidad:unidades_medida(simbolo))')
          .eq('producto_id', linea.producto.id)
          .eq('activa', true)
          .single()

        const ingredientes: IngredienteReq[] = []

        if (formula?.lineas) {
          type FormulaLineaRaw = {
            cantidad: number
            mp: { id: string; nombre: string; codigo: string } | { id: string; nombre: string; codigo: string }[] | null
            unidad: { simbolo: string } | { simbolo: string }[] | null
          }
          for (const fl of (formula.lineas as unknown as FormulaLineaRaw[])) {
            const mpItem = Array.isArray(fl.mp) ? fl.mp[0] : fl.mp
            const unItem = Array.isArray(fl.unidad) ? fl.unidad[0] : fl.unidad
            if (!mpItem) continue
            const factor = linea.cantidad / (formula.base_cantidad ?? 1)
            const qty_teorica = parseFloat((fl.cantidad * factor).toFixed(4))
            const prod = prods.find(p => p.id === mpItem.id)
            const stock_ok = (prod?.stock_actual ?? 0) >= qty_teorica
            if (!stock_ok) todos_ok = false
            ingredientes.push({
              mp_id: mpItem.id,
              mp_nombre: mpItem.nombre,
              mp_codigo: mpItem.codigo,
              unidad: unItem?.simbolo ?? 'kg',
              qty_teorica,
              stock_actual: prod?.stock_actual ?? 0,
              stock_ok,
            })
          }
        }

        lineasConIngredientes.push({
          producto: linea.producto.nombre,
          cantidad: linea.cantidad,
          unidad: linea.unidad?.simbolo ?? '',
          precio_unitario: linea.precio_unitario,
          descuento_pct: linea.descuento_pct,
          subtotal: linea.subtotal_linea,
          ingredientes,
        })
      }

      const clienteObj = ped.cliente as { nombre?: string } | null
      sols.push({
        pedido_id: ped.id,
        numero_pedido: ped.numero_pedido,
        cliente: clienteObj?.nombre ?? '—',
        fecha_entrega: ped.fecha_entrega_solicitada,
        lineas: lineasConIngredientes,
        todos_ingredientes_ok: todos_ok,
      })
    }

    setSolicitudes(sols)
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadData() }, [loadData])

  async function despachar(sol: SolicitudDespacho) {
    if (!sol.todos_ingredientes_ok) {
      toast.error('No hay stock suficiente de todos los ingredientes')
      return
    }

    // Cambiar pedido a en_produccion
    const { error } = await supabase
      .from('pedidos')
      .update({ estado: 'en_produccion' })
      .eq('id', sol.pedido_id)

    if (error) { toast.error('Error al despachar: ' + error.message); return }

    // Crear OP por cada línea del pedido
    for (const linea of sol.lineas) {
      const { data: prod } = await supabase
        .from('productos')
        .select('id')
        .eq('nombre', linea.producto)
        .single()

      if (!prod) continue

      const { data: formula } = await supabase
        .from('formulas')
        .select('id')
        .eq('producto_id', prod.id)
        .eq('activa', true)
        .single()

      if (!formula) continue

      // Buscar línea del pedido
      const { data: pedidoLinea } = await supabase
        .from('pedidos_lineas')
        .select('id')
        .eq('pedido_id', sol.pedido_id)
        .eq('producto_id', prod.id)
        .single()

      await supabase.from('ordenes_produccion').insert({
        tenant_id: tenantId,
        pedido_id: sol.pedido_id,
        pedido_linea_id: pedidoLinea?.id,
        formula_id: formula.id,
        estado: 'pendiente',
        cantidad_a_producir: linea.cantidad,
      })
    }

    toast.success(`Pedido ${sol.numero_pedido} despachado a Producción · OPs creadas`)
    setPedidoDetalle(null)
    loadData()
  }

  async function handleIngresoMP() {
    if (!formMP.producto_id || !formMP.numero_lote || !formMP.cantidad) {
      toast.error('Completa todos los campos requeridos'); return
    }
    if (!tenantId) { toast.error('Sesión expirada'); return }
    setSaving(true)
    try {
      const { data: lote, error: eLote } = await supabase
        .from('lotes')
        .insert({
          tenant_id: tenantId,
          producto_id: formMP.producto_id,
          numero_lote: formMP.numero_lote,
          proveedor: formMP.proveedor,
          cantidad_inicial: formMP.cantidad,
          cantidad_disponible: formMP.cantidad,
          costo_unitario: formMP.costo_unitario || null,
          fecha_vencimiento: formMP.fecha_vencimiento || null,
          created_by: userId,
        })
        .select().single()
      if (eLote) throw eLote

      await supabase.from('movimientos_inventario').insert({
        tenant_id: tenantId,
        producto_id: formMP.producto_id,
        lote_id: lote.id,
        tipo_movimiento: 'ENTRADA',
        cantidad: formMP.cantidad,
        referencia_tipo: 'ingreso_manual',
        notas: `Ingreso lote ${formMP.numero_lote}`,
        created_by: userId,
      })

      toast.success(`MP ingresada · Lote ${formMP.numero_lote} activo`)
      setShowIngreso(false)
      setFormMP({ producto_id:'', proveedor:'', cantidad:0, costo_unitario:0, numero_lote:'', fecha_vencimiento:'' })
      loadData()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar')
    } finally {
      setSaving(false)
    }
  }

  function diasVenc(fecha: string | null) {
    if (!fecha) return null
    return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)
  }

  const mpProductos = productos.filter(p => p.tipo === 'MP')

  if (loading) return <AppLayout title="Bodega" breadcrumb="MÓDULOS / BODEGA"><PageLoader /></AppLayout>

  const TABS: { id: Tab; label: string }[] = [
    { id: 'solicitudes', label: 'Solicitudes de Despacho' },
    { id: 'inventario',  label: 'Inventario MP' },
    { id: 'pt',          label: 'Producto Terminado' },
    { id: 'lotes',       label: 'Lotes y Vencimientos' },
  ]

  return (
    <AppLayout
      title="Bodega"
      breadcrumb="MÓDULOS / BODEGA"
      action={<button className="btn-primary" onClick={() => setShowIngreso(true)}>+ Ingreso MP</button>}
    >
      {/* Tabs */}
      <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SOLICITUDES ─────────────────────────────────── */}
      {tab === 'solicitudes' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Tabla de solicitudes */}
            <div className="xl:col-span-2 card">
              <div className="card-header">
                <span className="font-bold text-[14px]">Pedidos Confirmados — Pendientes de Despacho</span>
                <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md ml-2">
                  {solicitudes.length}
                </span>
              </div>
              {solicitudes.length === 0
                ? <EmptyState icon="📦" title="Sin pedidos confirmados pendientes" subtitle="Los pedidos confirmados aparecerán aquí para despacho" />
                : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Cliente</th>
                      <th>Productos</th>
                      <th>F. Entrega</th>
                      <th>Ingredientes</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solicitudes.map(s => (
                      <tr key={s.pedido_id}>
                        <td className="font-mono font-bold text-sky-600">{s.numero_pedido}</td>
                        <td className="font-semibold">{s.cliente}</td>
                        <td>
                          <div className="flex flex-col gap-0.5">
                            {s.lineas.map((l, i) => (
                              <span key={i} className="text-xs text-slate-600">
                                {l.cantidad} {l.unidad} {l.producto}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="font-mono text-xs text-slate-500">
                          {format(new Date(s.fecha_entrega), 'dd/MM/yy')}
                        </td>
                        <td>
                          {s.todos_ingredientes_ok
                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Stock OK</span>
                            : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-200">✗ Stock insuficiente</span>
                          }
                        </td>
                        <td>
                          <div className="flex gap-1.5">
                            <button
                              className="btn text-xs px-2 py-1"
                              onClick={() => setPedidoDetalle(s)}
                            >
                              👁 Ver pedido
                            </button>
                            <button
                              className={clsx(
                                'text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors',
                                s.todos_ingredientes_ok
                                  ? 'bg-sky-500 text-white border-sky-500 hover:bg-sky-600'
                                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                              )}
                              disabled={!s.todos_ingredientes_ok}
                              onClick={() => despachar(s)}
                            >
                              ▶ Confirmar y Despachar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Alertas */}
            <div className="card">
              <div className="card-header">
                <span className="font-bold text-[14px]">Alertas de Inventario</span>
                <span className={clsx(
                  'text-[10px] font-mono px-2 py-0.5 rounded-md ml-2',
                  alertas.length > 0 ? 'bg-red-100 border border-red-200 text-red-600' : 'bg-slate-100 border border-slate-200 text-slate-500'
                )}>
                  {alertas.length}
                </span>
              </div>
              <div className="p-4 flex flex-col gap-2.5">
                {alertas.length === 0
                  ? <p className="text-center text-slate-400 text-sm py-6">✅ Sin alertas activas</p>
                  : alertas.map(p => {
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
                            Stock: <strong>{p.stock_actual} {(p.unidad as {simbolo?:string})?.simbolo}</strong>
                            {' · '}Mín: {p.stock_minimo}
                          </p>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── INVENTARIO MP ─────────────────────────────────── */}
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
                  <span className={clsx(
                    'text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                    p.stock_actual < p.stock_minimo * 0.3 ? 'bg-red-50 text-red-600 border-red-200'
                    : p.stock_actual < p.stock_minimo ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  )}>
                    {p.stock_actual < p.stock_minimo * 0.3 ? 'Crítico' : p.stock_actual < p.stock_minimo ? 'Bajo mínimo' : 'OK'}
                  </span>
                  <p className="font-mono text-xs text-slate-500">
                    {p.stock_actual} / {p.stock_maximo} {(p.unidad as {simbolo?:string})?.simbolo}
                  </p>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${ratio * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-slate-400">
                  <span>Mín: {p.stock_minimo} · Máx: {p.stock_maximo}</span>
                  <span>Costo: ${p.costo_unitario}/{(p.unidad as {simbolo?:string})?.simbolo}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── PRODUCTO TERMINADO ───────────────────────────── */}
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
                      <td className="font-semibold">{(l.producto as {nombre?:string})?.nombre}</td>
                      <td className="font-mono">{l.cantidad_disponible} kg</td>
                      <td className="font-mono text-xs text-slate-500">{format(new Date(l.fecha_ingreso), 'dd/MM/yy')}</td>
                      <td className="font-mono text-xs">{l.fecha_vencimiento ? format(new Date(l.fecha_vencimiento), 'dd/MM/yy') : '—'}</td>
                      <td>
                        <span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                          dias !== null && dias <= 7 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                          {dias !== null && dias <= 7 ? `Vence en ${dias}d` : 'OK'}
                        </span>
                      </td>
                      <td>
                        <button className="btn text-xs px-2 py-1 bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"
                          onClick={() => toast.success('Entrega registrada')}>
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

      {/* ── LOTES Y VENCIMIENTOS ─────────────────────────── */}
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
                    <td className="font-semibold">{(l.producto as {nombre?:string})?.nombre ?? '—'}</td>
                    <td>
                      <span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border',
                        prod?.tipo === 'PT' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                      )}>{prod?.tipo}</span>
                    </td>
                    <td className="font-mono">{l.cantidad_disponible} kg</td>
                    <td className="font-mono text-xs text-slate-500">{format(new Date(l.fecha_ingreso), 'dd/MM/yy')}</td>
                    <td className="font-mono text-xs">{l.fecha_vencimiento ? format(new Date(l.fecha_vencimiento), 'dd/MM/yy') : '—'}</td>
                    <td className={clsx('font-mono font-bold text-sm',
                      dias === null ? 'text-slate-400' : dias <= 3 ? 'text-red-500' : dias <= 7 ? 'text-amber-500' : 'text-emerald-600'
                    )}>
                      {dias ?? '—'}
                    </td>
                    <td>
                      <span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border',
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

      {/* ── MODAL: VER PEDIDO DETALLE ──────────────────────── */}
      <Modal
        open={!!pedidoDetalle}
        onClose={() => setPedidoDetalle(null)}
        title={`Pedido ${pedidoDetalle?.numero_pedido ?? ''} — Detalle de Ingredientes`}
        subtitle={`Cliente: ${pedidoDetalle?.cliente} · Entrega: ${pedidoDetalle ? format(new Date(pedidoDetalle.fecha_entrega), 'dd/MM/yyyy') : ''}`}
        icon="📦"
        extraWide
        footer={
          <>
            <button className="btn" onClick={() => setPedidoDetalle(null)}>Cerrar</button>
            {pedidoDetalle?.todos_ingredientes_ok && (
              <button
                className="btn-primary"
                onClick={() => pedidoDetalle && despachar(pedidoDetalle)}
              >
                ▶ Confirmar y Despachar a Producción
              </button>
            )}
          </>
        }
      >
        {pedidoDetalle && (
          <div className="flex flex-col gap-5">
            {pedidoDetalle.lineas.map((linea, li) => (
              <div key={li} className="border border-slate-200 rounded-xl overflow-hidden">
                {/* Cabecera del producto */}
                <div className="bg-slate-50 px-4 py-3 flex items-center gap-3 border-b border-slate-200">
                  <span className="text-lg">📦</span>
                  <div>
                    <p className="font-bold text-slate-800">{linea.producto}</p>
                    <p className="text-xs text-slate-500">
                      Cantidad pedida: <strong>{linea.cantidad} {linea.unidad}</strong>
                      {' · '}Precio: <strong>${linea.precio_unitario.toFixed(2)}</strong>
                      {' · '}Descuento: <strong>{linea.descuento_pct}%</strong>
                      {' · '}Subtotal: <strong className="text-sky-600">${linea.subtotal?.toFixed(2) ?? '—'}</strong>
                    </p>
                  </div>
                </div>

                {/* Ingredientes requeridos */}
                <div className="p-4">
                  <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">
                    Ingredientes necesarios para {linea.cantidad} {linea.unidad}
                  </p>
                  {linea.ingredientes.length === 0 ? (
                    <p className="text-slate-400 text-xs italic">Sin fórmula definida para este producto</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Materia Prima</th>
                          <th>Código</th>
                          <th>Cant. Requerida</th>
                          <th>Stock Actual</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linea.ingredientes.map((ing, ii) => (
                          <tr key={ii}>
                            <td className="font-semibold">{ing.mp_nombre}</td>
                            <td className="font-mono text-xs text-slate-500">{ing.mp_codigo}</td>
                            <td className="font-mono font-bold text-sky-600">
                              {ing.qty_teorica.toFixed(3)} {ing.unidad}
                            </td>
                            <td className={clsx(
                              'font-mono text-sm font-semibold',
                              ing.stock_ok ? 'text-emerald-600' : 'text-red-500'
                            )}>
                              {ing.stock_actual.toFixed(3)} {ing.unidad}
                            </td>
                            <td>
                              <span className={clsx(
                                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                                ing.stock_ok
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-red-50 text-red-600 border-red-200'
                              )}>
                                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                {ing.stock_ok ? '✓ Suficiente' : '✗ Falta ' + (ing.qty_teorica - ing.stock_actual).toFixed(3) + ' ' + ing.unidad}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ))}

            {/* Resumen general */}
            <div className={clsx(
              'p-4 rounded-xl border-l-4 text-sm font-medium',
              pedidoDetalle.todos_ingredientes_ok
                ? 'bg-emerald-50 border-l-emerald-400 text-emerald-700'
                : 'bg-red-50 border-l-red-400 text-red-700'
            )}>
              {pedidoDetalle.todos_ingredientes_ok
                ? '✅ Hay stock suficiente de todos los ingredientes. Puedes despachar a Producción.'
                : '⚠ Hay ingredientes con stock insuficiente. Registra el ingreso de MP antes de despachar.'}
            </div>
          </div>
        )}
      </Modal>

      {/* ── MODAL: INGRESO MP ────────────────────────────── */}
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
            <select className="input" value={formMP.producto_id} onChange={e => setFormMP(f => ({...f, producto_id: e.target.value}))}>
              <option value="">— Seleccionar —</option>
              {mpProductos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Proveedor">
            <input className="input" value={formMP.proveedor} onChange={e => setFormMP(f => ({...f, proveedor: e.target.value}))} placeholder="Nombre del proveedor" />
          </Field>
          <Field label="Cantidad" required>
            <input className="input font-mono" type="number" min={0.001} step={0.001} value={formMP.cantidad || ''} onChange={e => setFormMP(f => ({...f, cantidad: +e.target.value}))} />
          </Field>
          <Field label="Costo Unitario">
            <input className="input font-mono" type="number" min={0} step={0.0001} value={formMP.costo_unitario || ''} onChange={e => setFormMP(f => ({...f, costo_unitario: +e.target.value}))} placeholder="0.0000" />
          </Field>
          <Field label="N° de Lote" required>
            <input className="input font-mono" value={formMP.numero_lote} onChange={e => setFormMP(f => ({...f, numero_lote: e.target.value}))} placeholder="Ej: B-205" />
          </Field>
          <Field label="Fecha de Vencimiento" hint="Dejar vacío si no caduca">
            <input className="input" type="date" value={formMP.fecha_vencimiento} onChange={e => setFormMP(f => ({...f, fecha_vencimiento: e.target.value}))} />
          </Field>
        </div>
        <InfoBox>
          💡 El stock se actualiza automáticamente. El lote queda en historial aunque se cargue Excel después.
        </InfoBox>
      </Modal>
    </AppLayout>
  )
}
