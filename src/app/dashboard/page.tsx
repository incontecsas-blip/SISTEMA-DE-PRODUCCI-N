// src/app/dashboard/page.tsx
// Dashboard principal — datos reales desde Supabase

import { createClient } from '@/lib/supabase/server'
import AppLayout from '@/components/layout/AppLayout'
import { KpiCard, OrderStatusPill, OpStatusPill } from '@/components/ui'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Obtener datos en paralelo
  const [
    { data: pedidosHoy },
    { data: opsEnCurso },
    { data: pedidosBodega },
    { data: listosEntrega },
    { data: recentePedidos },
    { data: recenteOPs },
  ] = await Promise.all([
    // Pedidos de hoy
    supabase
      .from('pedidos')
      .select('id', { count: 'exact' })
      .eq('fecha_pedido', new Date().toISOString().split('T')[0])
      .neq('estado', 'anulado'),

    // OPs en curso
    supabase
      .from('ordenes_produccion')
      .select('id', { count: 'exact' })
      .in('estado', ['pendiente', 'en_proceso']),

    // Pedidos confirmados pendientes de despacho en bodega
    supabase
      .from('pedidos')
      .select('id', { count: 'exact' })
      .eq('estado', 'confirmado'),

    // Pedidos listos para entrega
    supabase
      .from('pedidos')
      .select('id', { count: 'exact' })
      .eq('estado', 'listo_entrega'),

    // Últimos 6 pedidos con datos del cliente
    supabase
      .from('pedidos')
      .select(`
        id, numero_pedido, estado, fecha_entrega_solicitada, total,
        cliente:clientes(nombre),
        lineas:pedidos_lineas(cantidad, producto:productos(nombre))
      `)
      .neq('estado', 'anulado')
      .order('created_at', { ascending: false })
      .limit(6),

    // OPs activas con responsable
    supabase
      .from('ordenes_produccion')
      .select(`
        id, numero_op, estado, cantidad_a_producir,
        pedido:pedidos(numero_pedido),
        responsable:users(nombre)
      `)
      .in('estado', ['pendiente', 'en_proceso'])
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  // Alertas de vencimiento próximo
  const { data: alertasVenc } = await supabase
    .rpc('fn_alertas_vencimiento', {
      p_tenant_id: (await supabase.from('users').select('tenant_id').single()).data?.tenant_id
    })

  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  return (
    <AppLayout
      title="Dashboard"
      breadcrumb={`HOY · ${today.toUpperCase()}`}
    >
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Pedidos del día"
          value={pedidosHoy?.length ?? 0}
          icon="📋"
          color="sky"
          trend="+2 vs ayer"
          trendUp
        />
        <KpiCard
          label="OPs en curso"
          value={opsEnCurso?.length ?? 0}
          icon="⚙️"
          color="green"
          trend="En tiempo"
          trendUp
        />
        <KpiCard
          label="En Bodega (por despachar)"
          value={pedidosBodega?.length ?? 0}
          icon="📦"
          color="purple"
          trend="Pendientes de despacho"
          trendUp={false}
        />
        <KpiCard
          label="Listos para entrega"
          value={listosEntrega?.length ?? 0}
          icon="🚚"
          color="amber"
          trend="En espera"
          trendUp={false}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        {/* Pedidos recientes */}
        <div className="xl:col-span-2 card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Pedidos Recientes</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200
                             text-slate-500 px-2 py-0.5 rounded-md">
              {recentePedidos?.length ?? 0}
            </span>
            <a href="/pedidos" className="ml-auto text-xs font-semibold text-sky-600 hover:underline">
              Ver todos →
            </a>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Productos</th>
                <th>Entrega</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {recentePedidos?.map(p => (
                <tr key={p.id}>
                  <td className="font-mono font-bold text-sky-600">{p.numero_pedido}</td>
                  <td className="font-semibold">
                    {(p.cliente as { nombre?: string })?.nombre ?? '—'}
                  </td>
                  <td className="text-slate-400 text-xs">
                    {(p.lineas as { cantidad: number; producto?: { nombre?: string } }[])?.length ?? 0} línea(s)
                  </td>
                  <td className="font-mono text-slate-500 text-xs">
                    {format(new Date(p.fecha_entrega_solicitada), 'dd/MM/yy')}
                  </td>
                  <td className="font-mono font-semibold">
                    ${Number(p.total).toFixed(2)}
                  </td>
                  <td>
                    <OrderStatusPill status={p.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Alertas */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Alertas</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200
                             text-slate-500 px-2 py-0.5 rounded-md">
              {(alertasVenc?.length ?? 0)}
            </span>
          </div>
          <div className="p-4 flex flex-col gap-2.5">
            {false && (
              <StockAlertItem
                title="Productos con stock bajo"
                subtitle="—" 
                type="danger"
              />
            )}
            {alertasVenc?.slice(0, 4).map((a: {
              lote_id: string
              numero_lote: string
              producto_nombre: string
              dias_restantes: number
              cantidad: number
            }) => (
              <AlertItem
                key={a.lote_id}
                icon="⏰"
                title={`Lote ${a.numero_lote} vence en ${a.dias_restantes} días`}
                subtitle={`${a.producto_nombre} · ${a.cantidad} kg`}
                type={a.dias_restantes <= 3 ? 'danger' : 'warning'}
              />
            ))}
            {!alertasVenc?.length && (
              <p className="text-center text-slate-400 text-sm py-6">✅ Sin alertas activas</p>
            )}
          </div>
        </div>
      </div>

      {/* OPs en curso */}
      <div className="card">
        <div className="card-header">
          <span className="font-bold text-[14px]">Órdenes de Producción en Curso</span>
          <span className="text-[10px] font-mono bg-slate-100 border border-slate-200
                           text-slate-500 px-2 py-0.5 rounded-md">
            {recenteOPs?.length ?? 0}
          </span>
          <a href="/produccion" className="ml-auto text-xs font-semibold text-sky-600 hover:underline">
            Gestionar →
          </a>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>OP #</th>
              <th>Pedido</th>
              <th>Cantidad</th>
              <th>Responsable</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {recenteOPs?.map(op => (
              <tr key={op.id}>
                <td className="font-mono font-bold text-sky-600">{op.numero_op}</td>
                <td className="font-mono text-slate-500">
                  {(op.pedido as { numero_pedido?: string })?.numero_pedido ?? '—'}
                </td>
                <td className="font-mono">{op.cantidad_a_producir} kg</td>
                <td>{(op.responsable as { nombre?: string })?.nombre ?? '—'}</td>
                <td><OpStatusPill status={op.estado} /></td>
              </tr>
            ))}
            {!recenteOPs?.length && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-8">
                  No hay órdenes activas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppLayout>
  )
}

// Componentes internos del dashboard
function AlertItem({
  icon, title, subtitle, type,
}: {
  icon: string; title: string; subtitle: string
  type: 'danger' | 'warning' | 'info' | 'success'
}) {
  const styles = {
    danger:  'bg-red-50 border-l-red-400',
    warning: 'bg-amber-50 border-l-amber-400',
    info:    'bg-sky-50 border-l-sky-400',
    success: 'bg-emerald-50 border-l-emerald-400',
  }
  return (
    <div className={`flex gap-3 items-start p-3 rounded-lg border-l-4 ${styles[type]}`}>
      <span className="text-lg mt-0.5">{icon}</span>
      <div>
        <p className="font-semibold text-slate-800 text-[12px]">{title}</p>
        <p className="text-slate-500 text-[11px] mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

function StockAlertItem({ title, subtitle, type }: { title: string; subtitle: string; type: 'danger' }) {
  return <AlertItem icon="📉" title={title} subtitle={subtitle} type={type} />
}