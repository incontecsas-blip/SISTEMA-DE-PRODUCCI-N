// src/app/bodega/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, EmptyState, PageLoader, InfoBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { Producto, Lote } from '@/types/database'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { downloadCsv, downloadHtmlPdf } from '@/lib/download'
import clsx from 'clsx'

type Tab = 'despacho' | 'entrega' | 'inventario' | 'lotes'

// ── Tipos locales ──────────────────────────────────────────────
interface IngredienteReq {
  mp_id: string; mp_nombre: string; mp_codigo: string
  unidad: string; qty_teorica: number; stock_actual: number; stock_ok: boolean
}
interface SolicitudDespacho {
  pedido_id: string; numero_pedido: string; cliente: string; fecha_entrega: string; fecha_pedido: string; hora_entrega: string
  lineas: {
    producto: string; cantidad: number; unidad: string
    precio_unitario: number; descuento_pct: number; subtotal: number
    ingredientes: IngredienteReq[]
  }[]
  todos_ok: boolean
}
interface PedidoEntregaLinea {
  producto: string; cantidad: number; unidad: string; subtotal: number
}
interface PedidoEntregaOP {
  id: string; estado: string; cantidad_a_producir: number
  cantidad_producida: number | null; producto: string
}
interface PedidoEntrega {
  id: string; numero_pedido: string; cliente: string
  fecha_entrega: string; hora_entrega: string; estado: string
  lineas: PedidoEntregaLinea[]
  ops: PedidoEntregaOP[]
  todas_ops_entregadas: boolean
  total: number
}

export default function BodegaPage() {
  const { tenantId, userId } = useAuth()
  const supabase = createClient()

  const [tab, setTab]                   = useState<Tab>('despacho')
  const [productos, setProductos]       = useState<Producto[]>([])
  const [lotes, setLotes]               = useState<Lote[]>([])
  const [ptLotes, setPtLotes]           = useState<Lote[]>([])
  const [solicitudes, setSolicitudes]   = useState<SolicitudDespacho[]>([])
  const [pedidosEntrega, setPedEntrega] = useState<PedidoEntrega[]>([])
  const [loading, setLoading]           = useState(true)
  const [pedidoDetalle, setPedidoDetalle] = useState<SolicitudDespacho | null>(null)

  // Modal detalle entrega
  const [entregaDetalle, setEntregaDetalle] = useState<PedidoEntrega | null>(null)

  // Modal ingreso MP
  const [showIngreso, setShowIngreso] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [formMP, setFormMP] = useState({
    producto_id: '', proveedor: '', cantidad: 0,
    costo_unitario: 0, numero_lote: '', fecha_vencimiento: '',
  })

  const alertas = productos.filter(p => p.tipo === 'MP' && p.activo && p.stock_actual < p.stock_minimo)

  // ── Cargar datos ────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [{ data: prods }, { data: allLotes }, { data: peds }, { data: pedEnt }] =
      await Promise.all([
        supabase.from('productos').select('*, unidad:unidades_medida(simbolo)').eq('activo', true).order('nombre'),
        supabase.from('lotes').select('*, producto:productos(nombre,codigo,tipo)').eq('activo', true).order('fecha_vencimiento', { ascending: true }),
        supabase.from('pedidos')
          .select(`id, numero_pedido, fecha_entrega_solicitada, hora_entrega_solicitada, created_at,
            cliente:clientes(nombre),
            lineas:pedidos_lineas(cantidad, precio_unitario, descuento_pct, subtotal_linea,
              producto:productos(id, nombre), unidad:unidades_medida(simbolo))`)
          .eq('estado', 'confirmado'),
        supabase.from('pedidos')
          .select(`id, numero_pedido, estado, fecha_entrega_solicitada,
            cliente:clientes(nombre),
            lineas:pedidos_lineas(cantidad, subtotal_linea,
              producto:productos(nombre), unidad:unidades_medida(simbolo)),
            ops:ordenes_produccion(id, estado, cantidad_a_producir, cantidad_producida,
              formula:formulas(producto:productos(nombre)))`)
          .in('estado', ['listo_entrega', 'en_produccion'])
          .order('fecha_entrega_solicitada', { ascending: true }),
      ])

    const prodList = prods ?? []
    setProductos(prodList)
    setLotes((allLotes ?? []).filter(l => prodList.find(p => p.id === l.producto_id)?.tipo === 'MP'))
    setPtLotes((allLotes ?? []).filter(l => prodList.find(p => p.id === l.producto_id)?.tipo === 'PT'))

    // Construir solicitudes con ingredientes calculados
    const sols: SolicitudDespacho[] = []
    for (const ped of (peds ?? []) as unknown as {
      id: string; numero_pedido: string; fecha_entrega_solicitada: string; hora_entrega_solicitada: string | null; created_at: string
      cliente: { nombre?: string } | null
      lineas: { cantidad: number; precio_unitario: number; descuento_pct: number; subtotal_linea: number
        producto: { id: string; nombre: string } | null; unidad: { simbolo: string } | null }[]
    }[]) {
      let todos_ok = true
      const lineasConIng = []
      for (const linea of (ped.lineas ?? [])) {
        if (!linea.producto?.id) continue
        const { data: formula } = await supabase
          .from('formulas')
          .select('id, base_cantidad, lineas:formulas_lineas(cantidad, mp:productos(id,nombre,codigo), unidad:unidades_medida(simbolo))')
          .eq('producto_id', linea.producto.id).eq('activa', true).single()

        const ingredientes: IngredienteReq[] = []
        if (formula?.lineas) {
          type FLRaw = { cantidad: number; mp: {id:string;nombre:string;codigo:string}|{id:string;nombre:string;codigo:string}[]|null; unidad: {simbolo:string}|{simbolo:string}[]|null }
          for (const fl of (formula.lineas as unknown as FLRaw[])) {
            const mpItem = Array.isArray(fl.mp) ? fl.mp[0] : fl.mp
            const unItem = Array.isArray(fl.unidad) ? fl.unidad[0] : fl.unidad
            if (!mpItem) continue
            const factor = linea.cantidad / (formula.base_cantidad ?? 1)
            const qty_teorica = parseFloat((fl.cantidad * factor).toFixed(4))
            const prod = prodList.find(p => p.id === mpItem.id)
            const stock_ok = (prod?.stock_actual ?? 0) >= qty_teorica
            if (!stock_ok) todos_ok = false
            ingredientes.push({ mp_id: mpItem.id, mp_nombre: mpItem.nombre, mp_codigo: mpItem.codigo, unidad: unItem?.simbolo ?? 'kg', qty_teorica, stock_actual: prod?.stock_actual ?? 0, stock_ok })
          }
        }
        lineasConIng.push({
          producto: linea.producto.nombre, cantidad: linea.cantidad,
          unidad: linea.unidad?.simbolo ?? '', precio_unitario: linea.precio_unitario,
          descuento_pct: linea.descuento_pct, subtotal: linea.subtotal_linea, ingredientes,
        })
      }
      sols.push({ pedido_id: ped.id, numero_pedido: ped.numero_pedido,
        cliente: (ped.cliente as {nombre?:string}|null)?.nombre ?? '—',
        fecha_entrega: ped.fecha_entrega_solicitada,
        hora_entrega: ped.hora_entrega_solicitada ?? '',
        fecha_pedido: ped.created_at ?? '',
        lineas: lineasConIng, todos_ok })
    }
    setSolicitudes(sols)

    type PedEntRaw = {
      id: string; numero_pedido: string; estado: string
      fecha_entrega_solicitada: string; hora_entrega_solicitada: string | null
      cliente: {nombre?:string}|{nombre?:string}[]|null
      lineas: {
        cantidad: number; subtotal_linea: number
        producto: {nombre?:string}|{nombre?:string}[]|null
        unidad: {simbolo?:string}|{simbolo?:string}[]|null
      }[]
      ops: {
        id: string; estado: string; cantidad_a_producir: number; cantidad_producida: number|null
        formula: {producto:{nombre?:string}|{nombre?:string}[]|null}|{producto:{nombre?:string}|{nombre?:string}[]|null}[]|null
      }[]
    }
    setPedEntrega(((pedEnt ?? []) as unknown as PedEntRaw[]).map(p => {
      const clienteObj = Array.isArray(p.cliente) ? p.cliente[0] : p.cliente
      const opsArr = (p.ops ?? [])
      const todas_ops_entregadas = opsArr.length > 0 && opsArr.every(op => op.estado === 'entregada_bodega')
      const lineasArr = (p.lineas ?? []).map(l => {
        const prodObj = Array.isArray(l.producto) ? l.producto[0] : l.producto
        const unidObj = Array.isArray(l.unidad) ? l.unidad[0] : l.unidad
        return {
          producto: prodObj?.nombre ?? '—',
          cantidad: l.cantidad,
          unidad: unidObj?.simbolo ?? '',
          subtotal: l.subtotal_linea ?? 0,
        }
      })
      const opsConv = opsArr.map(op => {
        const formulaObj = Array.isArray(op.formula) ? op.formula[0] : op.formula
        const prodOp = Array.isArray(formulaObj?.producto) ? formulaObj?.producto[0] : formulaObj?.producto
        return {
          id: op.id, estado: op.estado,
          cantidad_a_producir: op.cantidad_a_producir,
          cantidad_producida: op.cantidad_producida,
          producto: prodOp?.nombre ?? '—',
        }
      })
      return {
        id: p.id, numero_pedido: p.numero_pedido, estado: p.estado,
        cliente: clienteObj?.nombre ?? '—',
        fecha_entrega: p.fecha_entrega_solicitada,
        hora_entrega: p.hora_entrega_solicitada ?? '',
        lineas: lineasArr, ops: opsConv, todas_ops_entregadas,
        total: lineasArr.reduce((s, l) => s + l.subtotal, 0),
      }
    }))
    setLoading(false)
  }, [supabase])

  useEffect(() => { loadData() }, [loadData])

  // ── Despachar a Producción ──────────────────────────────────
  async function despachar(sol: SolicitudDespacho) {
    if (!sol.todos_ok) {
      const ok = confirm('⚠ Hay ingredientes con stock insuficiente.\n\n¿Despachar de todas formas a Producción?')
      if (!ok) return
    }

    // 1. Cambiar estado del pedido
    const { error: errPed } = await supabase
      .from('pedidos').update({ estado: 'en_produccion' }).eq('id', sol.pedido_id)
    if (errPed) { toast.error('Error al actualizar pedido: ' + errPed.message); return }

    let opsCreadas = 0

    // 2. Crear una OP por cada línea
    for (const linea of sol.lineas) {
      // Buscar producto por nombre para obtener su ID
      const { data: prods } = await supabase
        .from('productos')
        .select('id')
        .eq('nombre', linea.producto)
        .eq('tipo', 'PT')
        .limit(1)

      const prod = prods?.[0]
      if (!prod) {
        console.warn('No se encontró producto PT:', linea.producto)
        continue
      }

      // Buscar fórmula activa
      const { data: formulas } = await supabase
        .from('formulas')
        .select('id')
        .eq('producto_id', prod.id)
        .eq('activa', true)
        .limit(1)

      const formula = formulas?.[0]
      if (!formula) {
        console.warn('No hay fórmula activa para:', linea.producto)
        toast.error(`Sin fórmula activa para: ${linea.producto}`)
        continue
      }

      // Buscar línea del pedido
      const { data: pLineas } = await supabase
        .from('pedidos_lineas')
        .select('id')
        .eq('pedido_id', sol.pedido_id)
        .eq('producto_id', prod.id)
        .limit(1)

      const pLinea = pLineas?.[0]

      // Insertar OP
      const { error: errOP } = await supabase.from('ordenes_produccion').insert({
        tenant_id: tenantId,
        pedido_id: sol.pedido_id,
        pedido_linea_id: pLinea?.id ?? null,
        formula_id: formula.id,
        estado: 'pendiente',
        cantidad_a_producir: linea.cantidad,
      })

      if (errOP) {
        console.error('Error creando OP:', errOP)
        toast.error(`Error al crear OP para ${linea.producto}: ${errOP.message}`)
      } else {
        opsCreadas++
      }
    }

    if (opsCreadas > 0) {
      toast.success(`✅ Pedido ${sol.numero_pedido} despachado · ${opsCreadas} OP${opsCreadas > 1 ? 's' : ''} creadas en Producción`)
    } else {
      toast.error('⚠ Pedido actualizado pero no se crearon OPs. Verifica que los productos tengan fórmula activa.')
    }

    setPedidoDetalle(null)
    loadData()
  }

  // ── Listo para Entrega ──────────────────────────────────────
  async function marcarListoEntrega(p: PedidoEntrega) {
    const { error } = await supabase.from('pedidos').update({ estado: 'listo_entrega' }).eq('id', p.id)
    if (error) { toast.error('Error: ' + error.message); return }
    toast.success(`${p.numero_pedido} → Listo para Entrega 🚚`)
    loadData()
  }

  // ── Registrar Entrega al Cliente ────────────────────────────
  async function marcarEntregado(p: PedidoEntrega) {
    const { error } = await supabase.from('pedidos')
      .update({ estado: 'entregado', fecha_entrega_real: new Date().toISOString().split('T')[0] })
      .eq('id', p.id)
    if (error) { toast.error('Error: ' + error.message); return }
    toast.success(`${p.numero_pedido} entregado al cliente ✅`)
    loadData()
  }

  // ── Ingreso MP ──────────────────────────────────────────────
  async function handleIngresoMP() {
    if (!formMP.producto_id || !formMP.numero_lote || !formMP.cantidad) {
      toast.error('Completa todos los campos requeridos'); return
    }
    if (!tenantId) { toast.error('Sesión expirada'); return }
    setSaving(true)
    try {
      const { data: lote, error: eLote } = await supabase.from('lotes').insert({
        tenant_id: tenantId, producto_id: formMP.producto_id,
        numero_lote: formMP.numero_lote, proveedor: formMP.proveedor || null,
        cantidad_inicial: formMP.cantidad, cantidad_disponible: formMP.cantidad,
        costo_unitario: formMP.costo_unitario || null,
        fecha_vencimiento: formMP.fecha_vencimiento || null, created_by: userId,
      }).select().single()
      if (eLote) throw eLote
      await supabase.from('movimientos_inventario').insert({
        tenant_id: tenantId, producto_id: formMP.producto_id, lote_id: lote.id,
        tipo_movimiento: 'ENTRADA', cantidad: formMP.cantidad,
        referencia_tipo: 'ingreso_manual', notas: `Ingreso lote ${formMP.numero_lote}`, created_by: userId,
      })
      toast.success(`Lote ${formMP.numero_lote} ingresado`)
      setShowIngreso(false)
      setFormMP({ producto_id:'', proveedor:'', cantidad:0, costo_unitario:0, numero_lote:'', fecha_vencimiento:'' })
      loadData()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar')
    } finally { setSaving(false) }
  }

  function diasVenc(fecha: string | null) {
    if (!fecha) return null
    return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)
  }

  const mpProductos = productos.filter(p => p.tipo === 'MP')

  if (loading) return <AppLayout title="Bodega" breadcrumb="MÓDULOS / BODEGA"><PageLoader /></AppLayout>

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'despacho',  label: 'Solicitudes de Despacho', badge: solicitudes.length },
    { id: 'entrega',   label: 'Entrega al Cliente',      badge: pedidosEntrega.filter(p => p.estado !== 'entregado').length },
    { id: 'inventario',label: 'Inventario MP' },
    { id: 'lotes',     label: 'Lotes y Vencimientos' },
  ]

  return (
    <AppLayout title="Bodega" breadcrumb="MÓDULOS / BODEGA"
      action={<button className="btn-primary" onClick={() => setShowIngreso(true)}>+ Ingreso MP</button>}>

      {/* Tabs */}
      <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tab === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={clsx('text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full',
                tab === t.id ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-500')}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ DESPACHO A PRODUCCIÓN ════════════════════════════════ */}
      {tab === 'despacho' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 card">
            <div className="card-header">
              <span className="font-bold text-[14px]">Pedidos Confirmados — Pendientes de Despacho</span>
              <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md ml-2">{solicitudes.length}</span>
            </div>
            {solicitudes.length === 0
              ? <EmptyState icon="📦" title="Sin pedidos pendientes" subtitle="Los pedidos confirmados aparecen aquí" />
              : (
              <table className="data-table">
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th>F. Entrega</th><th>Stock</th><th>Acciones</th></tr></thead>
                <tbody>
                  {solicitudes.map(s => (
                    <tr key={s.pedido_id}>
                      <td className="font-mono font-bold text-sky-600">{s.numero_pedido}</td>
                      <td className="font-semibold">{s.cliente}</td>
                      <td>
                        {s.lineas.map((l, i) => (
                          <span key={i} className="block text-xs text-slate-600">{l.cantidad} {l.unidad} {l.producto}</span>
                        ))}
                      </td>
                      <td className="font-mono text-xs text-slate-500">
                        <div className="font-semibold">{format(new Date(s.fecha_entrega), 'dd/MM/yyyy')}</div>
                        {s.hora_entrega && (
                          <div className="text-[10px] text-sky-500 font-bold">🕐 {s.hora_entrega.slice(0,5)}</div>
                        )}
                      </td>
                      <td>
                        {s.todos_ok
                          ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ OK</span>
                          : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">⚠ Incompleto</span>
                        }
                      </td>
                      <td className="flex gap-1.5">
                        <button className="btn text-xs px-2 py-1" onClick={() => setPedidoDetalle(s)}>👁 Ver</button>
                        <button
                          className={clsx('text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors',
                            s.todos_ok ? 'bg-sky-500 text-white border-sky-500 hover:bg-sky-600' : 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600')}
                          onClick={() => despachar(s)}>
                          ▶ Despachar
                        </button>
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
              <span className="font-bold text-[14px]">Alertas de Stock</span>
              <span className={clsx('text-[10px] font-mono px-2 py-0.5 rounded-md ml-2',
                alertas.length > 0 ? 'bg-red-100 border border-red-200 text-red-600' : 'bg-slate-100 border border-slate-200 text-slate-500')}>
                {alertas.length}
              </span>
            </div>
            <div className="p-4 flex flex-col gap-2.5">
              {alertas.length === 0
                ? <p className="text-center text-slate-400 text-sm py-6">✅ Sin alertas</p>
                : alertas.map(p => {
                  const pct = p.stock_minimo > 0 ? Math.round(p.stock_actual / p.stock_minimo * 100) : 0
                  return (
                    <div key={p.id} className={clsx('flex gap-3 items-start p-3 rounded-lg border-l-4',
                      pct < 30 ? 'bg-red-50 border-l-red-400' : 'bg-amber-50 border-l-amber-400')}>
                      <span className="text-xl">{pct < 30 ? '📉' : '📦'}</span>
                      <div>
                        <p className="font-semibold text-slate-800 text-xs">{p.nombre}</p>
                        <p className="text-slate-500 text-[11px] mt-0.5">
                          Stock: <strong>{p.stock_actual} {(p.unidad as {simbolo?:string})?.simbolo}</strong> · Mín: {p.stock_minimo}
                        </p>
                      </div>
                    </div>
                  )
                })
              }
            </div>
          </div>
        </div>
      )}

      {/* ══ ENTREGA AL CLIENTE ═══════════════════════════════════ */}
      {tab === 'entrega' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Despacho Final al Cliente</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md ml-2">{pedidosEntrega.length}</span>
          </div>
          {pedidosEntrega.length === 0
            ? <EmptyState icon="🚚" title="Sin pedidos listos para entrega" subtitle="Aparecen aquí cuando Producción finaliza las OPs" />
            : (
            <table className="data-table">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>F. Pedido Entrega</th><th>F. Entrega Real</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {pedidosEntrega.map(p => (
                  <tr key={p.id}>
                    <td className="font-mono font-bold text-sky-600">{p.numero_pedido}</td>
                    <td className="font-semibold">{p.cliente}</td>
                    <td className="font-mono text-xs text-slate-500">
                      <div className="font-semibold">{format(new Date(p.fecha_entrega), 'dd/MM/yyyy')}</div>
                      {p.hora_entrega && (
                        <div className="text-[10px] text-sky-500 font-bold">🕐 {p.hora_entrega.slice(0,5)}</div>
                      )}
                    </td>
                    <td className="font-mono text-xs text-slate-500">
                      {p.estado === 'entregado' ? (
                        <span className="text-emerald-600 font-semibold text-[10px]">✓ Hoy</span>
                      ) : (
                        <span className="text-slate-400">Pendiente</span>
                      )}
                    </td>
                    <td>
                      <span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                        p.estado === 'en_produccion' ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : p.estado === 'listo_entrega' ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {p.estado === 'en_produccion' ? 'En Producción'
                          : p.estado === 'listo_entrega' ? 'Listo para Entrega' : 'Entregado'}
                      </span>
                    </td>
                    <td className="flex gap-1.5">
                      <button className="btn text-xs px-2 py-1"
                        onClick={() => setEntregaDetalle(p)}>
                        👁 Ver
                      </button>
                      {p.estado === 'en_produccion' && (
                        <button
                          className={clsx(
                            'inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors',
                            p.todas_ops_entregadas
                              ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                              : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          )}
                          disabled={!p.todas_ops_entregadas}
                          title={p.todas_ops_entregadas ? '' : 'Esperar a que Producción entregue todas las OPs'}
                          onClick={() => p.todas_ops_entregadas && marcarListoEntrega(p)}>
                          {p.todas_ops_entregadas ? '📦 Listo para Entrega' : '⏳ En Producción...'}
                        </button>
                      )}
                      {p.estado === 'listo_entrega' && (
                        <button
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600 transition-colors"
                          onClick={() => marcarEntregado(p)}>
                          ✅ Registrar Entrega al Cliente
                        </button>
                      )}
                      {p.estado === 'entregado' && (
                        <span className="text-xs text-emerald-600 font-semibold px-2">✓ Completado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══ INVENTARIO MP ════════════════════════════════════════ */}
      {tab === 'inventario' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Materias Primas</span>
            <div className="ml-auto"><button className="btn text-xs" onClick={() => toast.success('Excel generado')}>⬇ Excel</button></div>
          </div>
          {mpProductos.map(p => {
            const ratio = p.stock_maximo > 0 ? Math.min(p.stock_actual / p.stock_maximo, 1) : 0
            const barColor = p.stock_actual < p.stock_minimo * 0.3 ? 'bg-red-400' : p.stock_actual < p.stock_minimo ? 'bg-amber-400' : 'bg-emerald-400'
            return (
              <div key={p.id} className="px-5 py-4 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3 mb-2">
                  <p className="font-semibold text-[13px] flex-1">{p.nombre}</p>
                  <span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                    p.stock_actual < p.stock_minimo * 0.3 ? 'bg-red-50 text-red-600 border-red-200'
                    : p.stock_actual < p.stock_minimo ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                    {p.stock_actual < p.stock_minimo * 0.3 ? 'Crítico' : p.stock_actual < p.stock_minimo ? 'Bajo mínimo' : 'OK'}
                  </span>
                  <p className="font-mono text-xs text-slate-500">{p.stock_actual} / {p.stock_maximo} {(p.unidad as {simbolo?:string})?.simbolo}</p>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width:`${ratio*100}%` }} />
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

      {/* ══ LOTES Y VENCIMIENTOS ═════════════════════════════════ */}
      {tab === 'lotes' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Control de Lotes</span>
            <div className="ml-auto"><button className="btn text-xs" onClick={() => toast.success('Excel generado')}>⬇ Excel</button></div>
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
                    <td><span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border',
                      prod?.tipo === 'PT' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>{prod?.tipo}</span></td>
                    <td className="font-mono">{l.cantidad_disponible} kg</td>
                    <td className="font-mono text-xs text-slate-500">{format(new Date(l.fecha_ingreso), 'dd/MM/yy')}</td>
                    <td className="font-mono text-xs">{l.fecha_vencimiento ? format(new Date(l.fecha_vencimiento), 'dd/MM/yy') : '—'}</td>
                    <td className={clsx('font-mono font-bold text-sm',
                      dias === null ? 'text-slate-400' : dias <= 3 ? 'text-red-500' : dias <= 7 ? 'text-amber-500' : 'text-emerald-600')}>
                      {dias ?? '—'}
                    </td>
                    <td><span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                      dias === null ? 'bg-slate-100 text-slate-500 border-slate-200' : dias <= 3 ? 'bg-red-50 text-red-600 border-red-200' : dias <= 7 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                      {dias === null ? 'Sin fecha' : dias <= 3 ? 'Urgente' : dias <= 7 ? 'Próx. vencer' : 'OK'}
                    </span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ══ MODAL: VER PEDIDO DETALLE ════════════════════════════ */}
      {pedidoDetalle && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setPedidoDetalle(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3 sticky top-0 bg-white rounded-t-2xl">
              <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center text-xl">📦</div>
              <div>
                <h3 className="font-bold text-[15px]">{pedidoDetalle.numero_pedido} — Detalle de Ingredientes</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cliente: {pedidoDetalle.cliente} · Entrega: {format(new Date(pedidoDetalle.fecha_entrega), 'dd/MM/yyyy')}{pedidoDetalle.hora_entrega && <span className="text-sky-500 font-semibold ml-1">🕐 {pedidoDetalle.hora_entrega.slice(0,5)}</span>}
                </p>
              </div>
              <button onClick={() => setPedidoDetalle(null)}
                className="ml-auto w-8 h-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100">✕</button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-5">
              {pedidoDetalle.lineas.map((linea, li) => (
                <div key={li} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 flex items-center gap-3 border-b border-slate-200">
                    <span className="text-lg">📦</span>
                    <div>
                      <p className="font-bold text-slate-800">{linea.producto}</p>
                      <p className="text-xs text-slate-500">
                        Cantidad: <strong>{linea.cantidad} {linea.unidad}</strong>
                        {' · '}Precio: <strong>${linea.precio_unitario.toFixed(2)}</strong>
                        {' · '}Desc: <strong>{linea.descuento_pct}%</strong>
                        {' · '}Subtotal: <strong className="text-sky-600">${(linea.subtotal ?? 0).toFixed(2)}</strong>
                      </p>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">
                      Ingredientes necesarios para {linea.cantidad} {linea.unidad}
                    </p>
                    {linea.ingredientes.length === 0
                      ? <p className="text-slate-400 text-xs italic">Sin fórmula definida para este producto</p>
                      : (
                      <table className="data-table">
                        <thead><tr><th>Materia Prima</th><th>Código</th><th>Cant. Requerida</th><th>Stock Actual</th><th>Estado</th></tr></thead>
                        <tbody>
                          {linea.ingredientes.map((ing, ii) => (
                            <tr key={ii}>
                              <td className="font-semibold">{ing.mp_nombre}</td>
                              <td className="font-mono text-xs text-slate-500">{ing.mp_codigo}</td>
                              <td className="font-mono font-bold text-sky-600">{ing.qty_teorica.toFixed(3)} {ing.unidad}</td>
                              <td className={clsx('font-mono text-sm font-semibold', ing.stock_ok ? 'text-emerald-600' : 'text-red-500')}>
                                {ing.stock_actual.toFixed(3)} {ing.unidad}
                              </td>
                              <td>
                                <span className={clsx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold border',
                                  ing.stock_ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200')}>
                                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                  {ing.stock_ok ? '✓ Suficiente' : `✗ Falta ${(ing.qty_teorica - ing.stock_actual).toFixed(3)} ${ing.unidad}`}
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

              <div className={clsx('p-4 rounded-xl border-l-4 text-sm font-medium',
                pedidoDetalle.todos_ok ? 'bg-emerald-50 border-l-emerald-400 text-emerald-700' : 'bg-amber-50 border-l-amber-400 text-amber-700')}>
                {pedidoDetalle.todos_ok
                  ? '✅ Stock suficiente para todos los ingredientes.'
                  : '⚠ Stock insuficiente en algunos ingredientes. Puedes despachar de todas formas.'}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end sticky bottom-0 bg-white rounded-b-2xl">
              <button className="btn" onClick={() => setPedidoDetalle(null)}>Cerrar</button>
              <button
                className={clsx('inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors',
                  pedidoDetalle.todos_ok ? 'bg-sky-500 text-white border-sky-500 hover:bg-sky-600' : 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600')}
                onClick={() => despachar(pedidoDetalle)}>
                {pedidoDetalle.todos_ok ? '▶ Confirmar y Despachar a Producción' : '⚠ Despachar con stock incompleto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: VER DETALLE ENTREGA ══════════════════════════ */}
      {entregaDetalle && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setEntregaDetalle(null) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3 sticky top-0 bg-white rounded-t-2xl">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl">🚚</div>
              <div>
                <h3 className="font-bold text-[15px]">{entregaDetalle.numero_pedido} — Detalle de Entrega</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cliente: {entregaDetalle.cliente} · F. Entrega: {format(new Date(entregaDetalle.fecha_entrega), 'dd/MM/yyyy')}
                </p>
              </div>
              <button onClick={() => setEntregaDetalle(null)}
                className="ml-auto w-8 h-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">

              {/* Productos del pedido */}
              <div>
                <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">Productos del Pedido</p>
                <table className="data-table">
                  <thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Subtotal</th></tr></thead>
                  <tbody>
                    {entregaDetalle.lineas.map((l, i) => (
                      <tr key={i}>
                        <td className="font-semibold">{l.producto}</td>
                        <td className="font-mono font-bold text-sky-600">{l.cantidad}</td>
                        <td className="font-mono text-slate-500">{l.unidad}</td>
                        <td className="font-mono font-semibold">${l.subtotal.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="text-right font-bold">Total:</td>
                      <td className="font-mono font-bold text-sky-600 text-[15px]">${entregaDetalle.total.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Estado de OPs */}
              <div>
                <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">Estado de Órdenes de Producción</p>
                <div className="flex flex-col gap-2">
                  {entregaDetalle.ops.map((op, i) => (
                    <div key={i} className={clsx(
                      'flex items-center gap-3 p-3 rounded-xl border',
                      op.estado === 'entregada_bodega' ? 'bg-emerald-50 border-emerald-200' : 'bg-sky-50 border-sky-200'
                    )}>
                      <span className="text-lg">{op.estado === 'entregada_bodega' ? '✅' : '⚙️'}</span>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{op.producto}</p>
                        <p className="text-xs text-slate-500">
                          A producir: <strong>{op.cantidad_a_producir} kg</strong>
                          {op.cantidad_producida != null && ` · Producido: ${op.cantidad_producida} kg`}
                        </p>
                      </div>
                      <span className={clsx(
                        'text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full border',
                        op.estado === 'entregada_bodega'
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                          : 'bg-sky-100 text-sky-700 border-sky-300'
                      )}>
                        {op.estado === 'entregada_bodega' ? '✓ Entregado a Bodega' : op.estado === 'en_proceso' ? 'En proceso' : 'Pendiente'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resumen */}
              <div className={clsx('p-4 rounded-xl border-l-4 text-sm font-medium',
                entregaDetalle.todas_ops_entregadas
                  ? 'bg-emerald-50 border-l-emerald-400 text-emerald-700'
                  : 'bg-sky-50 border-l-sky-400 text-sky-700')}>
                {entregaDetalle.todas_ops_entregadas
                  ? '✅ Producción completó y entregó todas las OPs. Puedes marcar como Listo para Entrega.'
                  : '⏳ Esperando que Producción entregue todas las OPs a Bodega antes de poder despachar.'}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end sticky bottom-0 bg-white rounded-b-2xl">
              <button className="btn" onClick={() => setEntregaDetalle(null)}>Cerrar</button>
              {entregaDetalle.estado === 'en_produccion' && entregaDetalle.todas_ops_entregadas && (
                <button
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-white border border-amber-500 hover:bg-amber-600"
                  onClick={() => { marcarListoEntrega(entregaDetalle); setEntregaDetalle(null) }}>
                  📦 Marcar como Listo para Entrega
                </button>
              )}
              {entregaDetalle.estado === 'listo_entrega' && (
                <button
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-white border border-emerald-500 hover:bg-emerald-600"
                  onClick={() => { marcarEntregado(entregaDetalle); setEntregaDetalle(null) }}>
                  ✅ Registrar Entrega al Cliente
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: INGRESO MP ════════════════════════════════════ */}
      <Modal open={showIngreso} onClose={() => setShowIngreso(false)}
        title="Ingreso de Materia Prima" subtitle="Registrar entrada con lote y vencimiento" icon="📦"
        footer={<>
          <button className="btn" onClick={() => setShowIngreso(false)}>Cancelar</button>
          <button className="btn-primary" onClick={handleIngresoMP} disabled={saving}>
            {saving ? 'Registrando...' : '✓ Registrar Ingreso'}
          </button>
        </>}>
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
        <InfoBox>💡 El stock se actualiza automáticamente al registrar el ingreso.</InfoBox>
      </Modal>
    </AppLayout>
  )
}