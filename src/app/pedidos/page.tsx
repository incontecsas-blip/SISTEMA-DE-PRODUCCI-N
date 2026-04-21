// src/app/pedidos/page.tsx
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, OrderStatusPill, EmptyState, PageLoader, InfoBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { Pedido, Cliente, Producto, UnidadMedida, PedidoHistorial } from '@/types/database'
import { ORDER_STATUS_FLOW, ORDER_STATUS_LABELS } from '@/types/database'
import type { OrderStatus } from '@/types/database'
import { format, addDays } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// ── tipos locales ──────────────────────────────────────────────
interface Linea {
  producto_id: string
  producto_nombre: string
  cantidad: number
  unidad_id: string
  precio_unitario: number
  descuento_pct: number
}

const ESTADO_ICONS: Record<OrderStatus, string> = {
  borrador: '📝', confirmado: '✓', en_bodega: '📦',
  en_produccion: '⚙️', listo_entrega: '🚚', entregado: '✅', anulado: '✕',
}

export default function PedidosPage() {
  const { user, role } = useAuth()
  const supabase = createClient()

  const [pedidos, setPedidos]     = useState<Pedido[]>([])
  const [loading, setLoading]     = useState(true)
  const [tabActivo, setTabActivo] = useState<'todos' | 'mios' | 'confirmar'>('todos')
  const [selected, setSelected]   = useState<Pedido | null>(null)
  const [historial, setHistorial] = useState<PedidoHistorial[]>([])
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving]       = useState(false)

  // Formulario nuevo pedido
  const [clienteInput, setClienteInput] = useState('')
  const [clienteSugg, setClienteSugg]   = useState<Cliente[]>([])
  const [clienteSel, setClienteSel]     = useState<Cliente | null>(null)
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [observaciones, setObs]         = useState('')
  const [lineas, setLineas]             = useState<Linea[]>([])
  const [productos, setProductos]       = useState<Producto[]>([])
  const [unidades, setUnidades]         = useState<UnidadMedida[]>([])
  const acRef = useRef<HTMLDivElement>(null)

  // Cargar catálogos
  useEffect(() => {
    supabase.from('productos').select('*, unidad:unidades_medida(*)').eq('tipo','PT').eq('activo',true)
      .then(({ data }) => setProductos(data ?? []))
    supabase.from('unidades_medida').select('*')
      .then(({ data }) => setUnidades(data ?? []))
  }, [supabase])

  const fetchPedidos = useCallback(async () => {
    let q = supabase
      .from('pedidos')
      .select('*, cliente:clientes(nombre,ruc,descuento_pct), vendedor:users(nombre)')
      .neq('estado', 'anulado')
      .order('created_at', { ascending: false })

    if (tabActivo === 'mios')      q = q.eq('vendedor_id', user?.id ?? '')
    if (tabActivo === 'confirmar') q = q.eq('estado', 'borrador')

    const { data, error } = await q
    if (error) toast.error('Error al cargar pedidos')
    else setPedidos(data ?? [])
    setLoading(false)
  }, [supabase, tabActivo, user?.id])

  useEffect(() => { fetchPedidos() }, [fetchPedidos])

  // Autocompletar cliente
  async function buscarCliente(q: string) {
    setClienteInput(q)
    setClienteSel(null)
    if (q.length < 2) { setClienteSugg([]); return }
    const { data } = await supabase
      .from('clientes')
      .select('*')
      .eq('activo', true)
      .or(`nombre.ilike.%${q}%,ruc.ilike.%${q}%`)
      .limit(6)
    setClienteSugg(data ?? [])
  }

  function seleccionarCliente(c: Cliente) {
    setClienteSel(c)
    setClienteInput(c.nombre)
    setClienteSugg([])
    const dias = c.tiempo_entrega_dias ?? 3
    setFechaEntrega(format(addDays(new Date(), dias), 'yyyy-MM-dd'))
    // Aplicar descuento del cliente a todas las líneas existentes
    setLineas(ls => ls.map(l => ({ ...l, descuento_pct: c.descuento_pct })))
  }

  // Líneas del pedido
  function agregarLinea() {
    if (!productos[0]) return
    setLineas(ls => [...ls, {
      producto_id: productos[0].id,
      producto_nombre: productos[0].nombre,
      cantidad: 1,
      unidad_id: (productos[0].unidad as UnidadMedida | undefined)?.id ?? unidades[0]?.id ?? '',
      precio_unitario: 0,
      descuento_pct: clienteSel?.descuento_pct ?? 0,
    }])
  }

  function updateLinea(i: number, field: keyof Linea, value: string | number) {
    setLineas(ls => ls.map((l, idx) => {
      if (idx !== i) return l
      if (field === 'producto_id') {
        const p = productos.find(p => p.id === value)
        return { ...l, producto_id: value as string, producto_nombre: p?.nombre ?? '',
                 unidad_id: (p?.unidad as UnidadMedida | undefined)?.id ?? l.unidad_id }
      }
      return { ...l, [field]: value }
    }))
  }

  const totalPedido = lineas.reduce((sum, l) => {
    return sum + (l.cantidad * l.precio_unitario * (1 - l.descuento_pct / 100))
  }, 0)

  // Guardar pedido
  async function handleGuardar(confirmar: boolean) {
    if (!clienteSel) { toast.error('Selecciona un cliente'); return }
    if (!fechaEntrega) { toast.error('Fecha de entrega requerida'); return }
    if (lineas.length === 0) { toast.error('Agrega al menos un producto'); return }
    setSaving(true)
    try {
      const estado: OrderStatus = confirmar ? 'confirmado' : 'borrador'
      const { data: pedido, error } = await supabase
        .from('pedidos')
        .insert({
          cliente_id: clienteSel.id,
          vendedor_id: user?.id,
          estado,
          fecha_entrega_solicitada: fechaEntrega,
          descuento_pct: clienteSel.descuento_pct,
          observaciones,
          subtotal: totalPedido,
          total: totalPedido,
        })
        .select()
        .single()

      if (error) throw error

      // Insertar líneas
      const { error: eLineas } = await supabase.from('pedidos_lineas').insert(
        lineas.map(l => ({
          pedido_id: pedido.id,
          producto_id: l.producto_id,
          cantidad: l.cantidad,
          unidad_id: l.unidad_id,
          precio_unitario: l.precio_unitario,
          descuento_pct: l.descuento_pct,
        }))
      )
      if (eLineas) throw eLineas

      toast.success(confirmar ? `Pedido ${pedido.numero_pedido} confirmado` : 'Borrador guardado')
      setShowModal(false)
      resetForm()
      fetchPedidos()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setClienteInput(''); setClienteSel(null); setFechaEntrega('')
    setObs(''); setLineas([])
  }

  // Avanzar estado
  async function avanzarEstado(pedido: Pedido) {
    const idx = ORDER_STATUS_FLOW.indexOf(pedido.estado)
    if (idx < 0 || idx >= ORDER_STATUS_FLOW.length - 1) return
    const nuevoEstado = ORDER_STATUS_FLOW[idx + 1]
    const { error } = await supabase
      .from('pedidos').update({ estado: nuevoEstado }).eq('id', pedido.id)
    if (error) toast.error('Error al actualizar estado')
    else {
      toast.success(`Pedido → ${ORDER_STATUS_LABELS[nuevoEstado]}`)
      fetchPedidos()
      if (selected?.id === pedido.id) {
        setSelected({ ...pedido, estado: nuevoEstado })
        cargarHistorial(pedido.id)
      }
    }
  }

  async function verDetalle(p: Pedido) {
    const { data } = await supabase
      .from('pedidos')
      .select('*, cliente:clientes(*), vendedor:users(nombre), lineas:pedidos_lineas(*, producto:productos(nombre,codigo), unidad:unidades_medida(simbolo))')
      .eq('id', p.id)
      .single()
    setSelected(data)
    cargarHistorial(p.id)
  }

  async function cargarHistorial(pedidoId: string) {
    const { data } = await supabase
      .from('pedidos_historial')
      .select('*, usuario:users(nombre)')
      .eq('pedido_id', pedidoId)
      .order('created_at', { ascending: true })
    setHistorial(data ?? [])
  }

  if (loading) return <AppLayout title="Pedidos" breadcrumb="MÓDULOS / PEDIDOS"><PageLoader /></AppLayout>

  return (
    <AppLayout
      title="Pedidos / Ventas"
      breadcrumb="MÓDULOS / PEDIDOS"
      action={<button className="btn-primary" onClick={() => { resetForm(); setShowModal(true) }}>+ Nuevo Pedido</button>}
    >
      {/* Tabs */}
      <div className="flex gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1 w-fit mb-4">
        {[
          { id: 'todos', label: 'Todos' },
          { id: 'mios', label: 'Mis Pedidos' },
          { id: 'confirmar', label: 'Por Confirmar' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTabActivo(t.id as typeof tabActivo)}
            className={clsx(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tabActivo === t.id ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-header">
          <span className="font-bold text-[14px]">Pedidos</span>
          <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md">{pedidos.length}</span>
          <div className="ml-auto flex gap-2">
            <button className="btn text-xs" onClick={() => toast.success('Excel generado')}>⬇ Excel</button>
            <button className="btn text-xs" onClick={() => toast.success('PDF generado')}>⬇ PDF</button>
          </div>
        </div>
        {pedidos.length === 0
          ? <EmptyState icon="📋" title="Sin pedidos" action={<button className="btn-primary" onClick={() => setShowModal(true)}>+ Crear pedido</button>} />
          : (
          <table className="data-table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>F. Entrega</th><th>Total</th><th>Estado</th><th>Acc.</th></tr></thead>
            <tbody>
              {pedidos.map(p => (
                <tr key={p.id}>
                  <td className="font-mono font-bold text-sky-600">{p.numero_pedido}</td>
                  <td className="font-semibold">{(p.cliente as { nombre?: string })?.nombre ?? '—'}</td>
                  <td className="text-slate-500 text-xs">{(p.vendedor as { nombre?: string })?.nombre ?? '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{format(new Date(p.fecha_entrega_solicitada), 'dd/MM/yy')}</td>
                  <td className="font-mono font-semibold">${Number(p.total).toFixed(2)}</td>
                  <td><OrderStatusPill status={p.estado} /></td>
                  <td className="flex gap-1.5">
                    <button className="btn text-xs px-2 py-1" onClick={() => verDetalle(p)}>Ver</button>
                    {ORDER_STATUS_FLOW.indexOf(p.estado) < ORDER_STATUS_FLOW.length - 1 && (
                      <button className="btn-primary text-xs px-2 py-1" onClick={() => avanzarEstado(p)}>
                        → {ORDER_STATUS_LABELS[ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.indexOf(p.estado) + 1]]}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Panel de detalle */}
      {selected && (
        <div className="card mt-4 animate-[fadeUp_0.2s_ease]">
          <div className="card-header">
            <div>
              <p className="font-bold text-[15px]">{selected.numero_pedido} – {(selected.cliente as { nombre?: string })?.nombre}</p>
              <p className="text-xs text-slate-500 mt-0.5">Vendedor: {(selected.vendedor as { nombre?: string })?.nombre} · Entrega: {format(new Date(selected.fecha_entrega_solicitada), 'dd/MM/yyyy')}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn text-xs" onClick={() => toast.success('PDF del pedido generado')}>⬇ PDF</button>
              {ORDER_STATUS_FLOW.indexOf(selected.estado) < ORDER_STATUS_FLOW.length - 1 && (
                <button className="btn-primary text-xs" onClick={() => avanzarEstado(selected)}>
                  → Mover a {ORDER_STATUS_LABELS[ORDER_STATUS_FLOW[ORDER_STATUS_FLOW.indexOf(selected.estado) + 1]]}
                </button>
              )}
              <button className="btn text-xs" onClick={() => setSelected(null)}>✕ Cerrar</button>
            </div>
          </div>

          {/* Pipeline de estados */}
          <div className="flex items-center px-6 py-4 overflow-x-auto border-b border-slate-100">
            {ORDER_STATUS_FLOW.map((s, i) => {
              const currentIdx = ORDER_STATUS_FLOW.indexOf(selected.estado)
              const isDone    = i < currentIdx
              const isCurrent = i === currentIdx
              return (
                <div key={s} className="flex items-center">
                  <div className="flex flex-col items-center min-w-[80px]">
                    <div className={clsx(
                      'w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-all',
                      isDone    ? 'border-sky-400 bg-sky-500 text-white' : '',
                      isCurrent ? 'border-sky-400 bg-white text-sky-600 shadow-[0_0_0_4px_rgba(56,189,248,0.15)]' : '',
                      !isDone && !isCurrent ? 'border-slate-200 bg-white text-slate-400' : ''
                    )}>
                      {isDone ? '✓' : ESTADO_ICONS[s]}
                    </div>
                    <p className={clsx('text-[9px] mt-1.5 font-semibold text-center whitespace-nowrap',
                      isCurrent ? 'text-sky-700' : isDone ? 'text-sky-600' : 'text-slate-400')}>
                      {ORDER_STATUS_LABELS[s]}
                    </p>
                  </div>
                  {i < ORDER_STATUS_FLOW.length - 1 && (
                    <div className={clsx('h-0.5 w-8 mx-1 mb-5', isDone ? 'bg-sky-400' : 'bg-slate-200')} />
                  )}
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            {/* Info + líneas */}
            <div className="p-5 border-r border-slate-100">
              <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">Líneas del Pedido</p>
              <table className="data-table">
                <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Subtotal</th></tr></thead>
                <tbody>
                  {(selected.lineas ?? []).map((l) => {
                    const linea = l as { id: string; cantidad: number; precio_unitario: number; descuento_pct: number; subtotal_linea: number; producto?: { nombre?: string; codigo?: string }; unidad?: { simbolo?: string } }
                    return (
                      <tr key={linea.id}>
                        <td className="font-semibold">{linea.producto?.nombre ?? '—'}</td>
                        <td className="font-mono">{linea.cantidad} {linea.unidad?.simbolo}</td>
                        <td className="font-mono">${linea.precio_unitario.toFixed(2)}</td>
                        <td className="font-mono text-sky-600">{linea.descuento_pct}%</td>
                        <td className="font-mono font-bold">${linea.subtotal_linea.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                  <tr className="bg-slate-50">
                    <td colSpan={4} className="text-right font-bold">Total:</td>
                    <td className="font-mono font-bold text-sky-600 text-[15px]">${Number(selected.total).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Línea de tiempo */}
            <div className="p-5">
              <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">Línea de Tiempo</p>
              <div className="flex flex-col gap-0">
                {historial.map((h, i) => (
                  <div key={h.id} className="flex gap-3 pb-4 relative">
                    {i < historial.length - 1 && (
                      <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-slate-100" />
                    )}
                    <div className={clsx(
                      'w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm flex-shrink-0 z-10',
                      i === historial.length - 1 ? 'border-sky-500 bg-sky-500 text-white' : 'border-sky-200 bg-sky-50'
                    )}>
                      {ESTADO_ICONS[h.estado_nuevo]}
                    </div>
                    <div>
                      <p className="font-semibold text-xs text-slate-800">{ORDER_STATUS_LABELS[h.estado_nuevo]}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {(h.usuario as { nombre?: string })?.nombre ?? 'Sistema'} · {format(new Date(h.created_at), 'dd/MM/yy HH:mm')}
                      </p>
                      {h.comentario && <p className="text-xs text-slate-500 mt-0.5 italic">{h.comentario}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo pedido */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); resetForm() }}
        title="Nuevo Pedido"
        subtitle="Completa los datos del pedido"
        icon="📋"
        wide
        footer={
          <>
            <button className="btn" onClick={() => { setShowModal(false); resetForm() }}>Cancelar</button>
            <button className="btn" onClick={() => handleGuardar(false)} disabled={saving}>💾 Borrador</button>
            <button className="btn-primary" onClick={() => handleGuardar(true)} disabled={saving}>
              {saving ? 'Guardando...' : '✓ Crear y Confirmar'}
            </button>
          </>
        }
      >
        {/* Autocomplete cliente */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cliente (nombre o RUC)" required>
            <div className="relative" ref={acRef}>
              <input
                className="input"
                placeholder="Escribir para buscar..."
                value={clienteInput}
                onChange={e => buscarCliente(e.target.value)}
                autoComplete="off"
              />
              {clienteSugg.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-sky-200 rounded-xl
                                shadow-xl z-50 max-h-48 overflow-y-auto mt-1">
                  {clienteSugg.map(c => (
                    <button
                      key={c.id}
                      className="w-full text-left px-4 py-3 hover:bg-sky-50 border-b border-slate-50 last:border-0 transition-colors"
                      onClick={() => seleccionarCliente(c)}
                    >
                      <p className="font-semibold text-[13px] text-slate-800">{c.nombre}</p>
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {c.ruc} · {c.tipo} · Desc: {c.descuento_pct}%
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
          <Field label="Fecha de Entrega" required>
            <input className="input" type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} />
          </Field>
        </div>

        {/* Info del cliente seleccionado */}
        {clienteSel && (
          <InfoBox>
            <strong>{clienteSel.nombre}</strong> &nbsp;·&nbsp;
            Descuento: <strong>{clienteSel.descuento_pct}%</strong> &nbsp;·&nbsp;
            Entrega: <strong>{clienteSel.tiempo_entrega_dias} días</strong> &nbsp;·&nbsp;
            Contacto: {clienteSel.contacto_nombre}
          </InfoBox>
        )}

        {/* Líneas del pedido */}
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">Líneas del Pedido <span className="text-red-400">*</span></p>
          <div className="flex flex-col gap-2">
            {lineas.map((l, i) => (
              <div key={i} className="grid grid-cols-[2fr_80px_90px_80px_80px_auto] gap-2 items-center
                                      p-3 bg-slate-50 rounded-xl border border-slate-200">
                <select
                  className="input text-xs"
                  value={l.producto_id}
                  onChange={e => updateLinea(i, 'producto_id', e.target.value)}
                >
                  {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <input
                  className="input font-mono text-xs"
                  type="number" min={1} placeholder="Cant."
                  value={l.cantidad}
                  onChange={e => updateLinea(i, 'cantidad', +e.target.value)}
                />
                <select
                  className="input text-xs"
                  value={l.unidad_id}
                  onChange={e => updateLinea(i, 'unidad_id', e.target.value)}
                >
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.simbolo}</option>)}
                </select>
                <input
                  className="input font-mono text-xs"
                  type="number" min={0} step={0.01} placeholder="Precio"
                  value={l.precio_unitario}
                  onChange={e => updateLinea(i, 'precio_unitario', +e.target.value)}
                />
                <input
                  className="input font-mono text-xs"
                  type="number" min={0} max={100} placeholder="Desc%"
                  value={l.descuento_pct}
                  onChange={e => updateLinea(i, 'descuento_pct', +e.target.value)}
                />
                <button className="btn-danger text-xs px-2 py-1" onClick={() => setLineas(ls => ls.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn text-xs mt-2" onClick={agregarLinea}>+ Agregar producto</button>
          {lineas.length > 0 && (
            <p className="text-right font-mono font-bold text-sky-600 mt-2">
              Total: ${totalPedido.toFixed(2)}
            </p>
          )}
        </div>

        <Field label="Observaciones">
          <textarea className="input" rows={2} value={observaciones} onChange={e => setObs(e.target.value)} placeholder="Instrucciones especiales..." />
        </Field>

        <InfoBox>
          💡 Al confirmar se genera automáticamente la Solicitud de Materiales en Bodega según las fórmulas de cada producto.
        </InfoBox>
      </Modal>
    </AppLayout>
  )
}
