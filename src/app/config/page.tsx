// src/app/config/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, PageLoader, InfoBox, WarnBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { Producto, UnidadMedida, ParametrosSistema } from '@/types/database'
import toast from 'react-hot-toast'
import clsx from 'clsx'

type Tab = 'productos' | 'unidades' | 'params' | 'permisos'

export default function ConfigPage() {
  const { user, tenantId, userId } = useAuth()
  const supabase  = createClient()

  const [tab, setTab]             = useState<Tab>('productos')
  const [productos, setProductos] = useState<Producto[]>([])
  const [unidades, setUnidades]   = useState<UnidadMedida[]>([])
  const [params, setParams]       = useState<ParametrosSistema | null>(null)
  const [loading, setLoading]     = useState(true)

  // Modal producto
  const [showProd, setShowProd] = useState(false)
  const [savingProd, setSavingProd] = useState(false)
  const [formProd, setFormProd] = useState({
    codigo: '', nombre: '', tipo: 'MP' as 'MP' | 'PT',
    unidad_id: '', costo_unitario: 0,
    stock_minimo: 0, stock_maximo: 0, stock_actual: 0,
    caducidad_dias: '' as number | '', manejo_lotes: true,
  })

  // Modal subir Excel
  const [showExcel, setShowExcel] = useState(false)
  const [excelFile, setExcelFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    const [{ data: prods }, { data: uns }, { data: ps }] = await Promise.all([
      supabase.from('productos').select('*, unidad:unidades_medida(simbolo,nombre)').eq('activo', true).order('tipo').order('nombre'),
      supabase.from('unidades_medida').select('*').order('tipo'),
      supabase.from('parametros_sistema').select('*').single(),
    ])
    setProductos(prods ?? [])
    setUnidades(uns ?? [])
    setParams(ps)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function guardarProducto() {
    if (!formProd.codigo || !formProd.nombre || !formProd.unidad_id) {
      toast.error('Código, nombre y unidad son obligatorios'); return
    }
    setSavingProd(true)
    try {
      if (!tenantId) { toast.error('Sesión expirada. Recarga la página.'); setSavingProd(false); return }

      const { error } = await supabase.from('productos').insert({
        ...formProd,
        tenant_id: tenantId,
        created_by: userId,
        caducidad_dias: formProd.caducidad_dias === '' ? null : formProd.caducidad_dias,
      })
      if (error) {
        console.error('Error inserting producto:', error)
        toast.error(error.code === '23505' ? 'El código ya existe' : 'Error: ' + error.message)
        return
      }
      toast.success('Producto creado')
      setShowProd(false)
      load()
    } catch (e: unknown) {
      console.error('guardarProducto exception:', e)
      toast.error('Error inesperado al guardar')
    } finally {
      setSavingProd(false)
    }
  }

  async function guardarParams() {
    if (!params) return
    const { error } = await supabase.from('parametros_sistema')
      .update({ ...params, updated_by: user?.id })
      .eq('id', params.id)
    if (error) toast.error('Error al guardar')
    else toast.success('Parámetros actualizados')
  }

  async function handleExcelUpload() {
    if (!excelFile) { toast.error('Selecciona un archivo'); return }
    toast.success('Inventario actualizado desde Excel (simulado) · Historial de lotes preservado')
    setShowExcel(false)
    setExcelFile(null)
  }

  function stockPill(p: Producto) {
    if (p.tipo === 'PT') return null
    if (p.stock_actual < p.stock_minimo * 0.3)
      return <span className="status-pill bg-red-50 text-red-600 border-red-200 text-[9px]">Crítico</span>
    if (p.stock_actual < p.stock_minimo)
      return <span className="status-pill bg-amber-50 text-amber-700 border-amber-200 text-[9px]">Bajo mín.</span>
    return <span className="status-pill bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px]">OK</span>
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'productos', label: 'Productos y MP' },
    { id: 'unidades',  label: 'Unidades' },
    { id: 'params',    label: 'Parámetros' },
    { id: 'permisos',  label: 'Permisos' },
  ]

  if (loading) return <AppLayout title="Configuración" breadcrumb="SISTEMA / CONFIGURACIÓN"><PageLoader /></AppLayout>

  return (
    <AppLayout title="Configuración" breadcrumb="SISTEMA / CONFIGURACIÓN"
      action={tab === 'productos' ? <button className="btn-primary" onClick={() => setShowProd(true)}>+ Nuevo Producto</button> : undefined}
    >
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

      {/* ── PRODUCTOS Y MP ─────────────────────────── */}
      {tab === 'productos' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Catálogo de Productos y MP</span>
            <span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-md">{productos.length}</span>
            <div className="ml-auto flex gap-2">
              <button className="btn text-xs" onClick={() => setShowExcel(true)}>📤 Subir Excel Inventario</button>
            </div>
          </div>
          <InfoBox>
            <div className="p-3 text-xs">
              💡 Configura el <strong>stock mínimo</strong> y <strong>máximo</strong> por producto.
              Las alertas de Bodega se generan automáticamente cuando el stock cae por debajo del mínimo.
              El historial de lotes se preserva siempre, aunque se suba un Excel de inventario.
            </div>
          </InfoBox>
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th><th>Nombre</th><th>Tipo</th><th>Unidad</th>
                <th>Stock Actual</th><th>Mín.</th><th>Máx.</th>
                <th>Cad. días</th><th>Lotes</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {productos.map(p => (
                <tr key={p.id}>
                  <td className="font-mono font-semibold text-xs">{p.codigo}</td>
                  <td className="font-semibold">{p.nombre}</td>
                  <td>
                    <span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border',
                      p.tipo === 'PT' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                    )}>{p.tipo}</span>
                  </td>
                  <td className="font-mono text-xs">{(p.unidad as { simbolo?: string })?.simbolo}</td>
                  <td className={clsx('font-mono font-bold text-sm', p.tipo === 'MP' && p.stock_actual < p.stock_minimo ? 'text-red-500' : 'text-emerald-600')}>
                    {p.stock_actual}
                  </td>
                  <td className="font-mono text-xs text-slate-500">{p.stock_minimo}</td>
                  <td className="font-mono text-xs text-slate-500">{p.stock_maximo}</td>
                  <td className="font-mono text-xs text-slate-500">{p.caducidad_dias ?? '—'}</td>
                  <td>{p.manejo_lotes
                    ? <span className="status-pill bg-blue-50 text-blue-700 border-blue-200 text-[9px]">✓ Sí</span>
                    : <span className="status-pill bg-slate-100 text-slate-400 border-slate-200 text-[9px]">No</span>
                  }</td>
                  <td>{stockPill(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── UNIDADES ──────────────────────────────── */}
      {tab === 'unidades' && (
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">Unidades de Medida</span>
            <div className="ml-auto">
              <button className="btn-primary text-xs" onClick={() => toast.success('Formulario de nueva unidad')}>+ Nueva</button>
            </div>
          </div>
          <table className="data-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Símbolo</th></tr></thead>
            <tbody>
              {unidades.map(u => (
                <tr key={u.id}>
                  <td className="font-mono font-bold text-sky-600">{u.codigo}</td>
                  <td className="font-semibold">{u.nombre}</td>
                  <td><span className="text-[10px] font-mono bg-slate-100 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-md">{u.tipo}</span></td>
                  <td className="font-mono font-bold">{u.simbolo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── PARÁMETROS ────────────────────────────── */}
      {tab === 'params' && params && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header"><span className="font-bold text-[14px]">Parámetros del Sistema</span></div>
            <div className="p-5 flex flex-col gap-5">
              {[
                {
                  label: '% Merma Aceptable (global)',
                  hint: 'Se usa para alertas en todas las OPs',
                  field: 'merma_aceptable_pct' as const,
                  suffix: '%',
                  type: 'number',
                },
                {
                  label: 'Días de Alerta por Vencimiento',
                  hint: 'Alerta cuando un lote vence en ≤ N días',
                  field: 'dias_alerta_vencimiento' as const,
                  suffix: 'días',
                  type: 'number',
                },
              ].map(({ label, hint, field, suffix, type }) => (
                <div key={field} className="flex items-center justify-between pb-5 border-b border-slate-100 last:border-0 last:pb-0">
                  <div>
                    <p className="font-semibold text-sm">{label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      className="input font-mono w-16 text-sm text-center"
                      type={type}
                      value={params[field]}
                      onChange={e => setParams({ ...params, [field]: +e.target.value })}
                    />
                    <span className="text-sm text-slate-400">{suffix}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Moneda</p>
                  <p className="text-xs text-slate-400 mt-0.5">Para reportes de inventario valorizado</p>
                </div>
                <select className="input w-24 text-sm font-mono" value={params.moneda} onChange={e => setParams({ ...params, moneda: e.target.value })}>
                  <option>USD</option><option>COP</option><option>EUR</option>
                </select>
              </div>
              <button className="btn-primary text-xs self-start" onClick={guardarParams}>💾 Guardar cambios</button>
            </div>
          </div>

          {/* Historial de lotes por producto */}
          <div className="card">
            <div className="card-header"><span className="font-bold text-[14px]">Historial de Lotes por Producto</span></div>
            <div className="p-4">
              <select className="input mb-4" onChange={async e => {
                if (!e.target.value) return
                const { data } = await supabase
                  .from('lotes')
                  .select('*, producto:productos(nombre)')
                  .eq('producto_id', e.target.value)
                  .order('fecha_ingreso', { ascending: false })
                  .limit(20)
                const container = document.getElementById('hist-lotes-content')
                if (container && data) {
                  container.innerHTML = data.length === 0
                    ? '<p class="text-slate-400 text-xs text-center py-4">Sin lotes</p>'
                    : data.map(l => `
                      <div class="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0 text-xs">
                        <span class="font-mono font-bold text-sky-600 w-20">${l.numero_lote}</span>
                        <span class="font-mono text-slate-500 w-16">${l.cantidad_disponible}/${l.cantidad_inicial}</span>
                        <span class="font-mono text-slate-400">${l.fecha_ingreso}</span>
                        <span class="font-mono text-slate-400 ml-auto">${l.fecha_vencimiento ?? 'Sin fecha'}</span>
                      </div>`).join('')
                }
              }}>
                <option value="">— Seleccionar producto —</option>
                {productos.filter(p => p.manejo_lotes).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <div id="hist-lotes-content">
                <p className="text-slate-400 text-xs text-center py-8">Selecciona un producto para ver el historial de lotes</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PERMISOS ──────────────────────────────── */}
      {tab === 'permisos' && (
        <div className="card">
          <div className="card-header"><span className="font-bold text-[14px]">Permisos por Rol</span></div>
          <table className="data-table">
            <thead>
              <tr><th>Módulo</th><th>Admin Master</th><th>Administrador</th><th>Vendedor</th><th>Bodega</th><th>Operario</th></tr>
            </thead>
            <tbody>
              {[
                ['Dashboard',      '✓ Completo',    '✓ Completo',    '✓ Parcial',    '✓ Parcial',    '✓ Parcial'],
                ['Clientes',       '✓ Completo',    '✓ Completo',    '✓ Ver/Crear',  '— Ver',        '—'],
                ['Pedidos',        '✓ Completo',    '✓ Completo',    '✓ Solo suyos', '— Ver',        '—'],
                ['Bodega',         '✓ Completo',    '✓ Completo',    '—',            '✓ Completo',   '—'],
                ['Producción',     '✓ Completo',    '✓ Completo',    '—',            '— Ver',        '✓ Completo'],
                ['Fórmulas',       '✓ Completo',    '✓ Completo',    '— Ver',        '— Ver',        '— Ver'],
                ['Reportes',       '✓ Completo',    '✓ Completo',    '— Solo suyos', '— Parcial',    '—'],
                ['Configuración',  '✓ Completo',    '✓ Sin usuarios','✗ Sin acceso', '✗ Sin acceso', '✗ Sin acceso'],
                ['Admin Master',   '✓ Exclusivo',   '✗',            '✗',            '✗',            '✗'],
              ].map(([modulo, ...roles]) => (
                <tr key={modulo}>
                  <td className="font-semibold">{modulo}</td>
                  {roles.map((r, i) => (
                    <td key={i} className={clsx('text-xs font-medium',
                      r.startsWith('✓') ? 'text-emerald-600' : r.startsWith('✗') ? 'text-red-400' : 'text-slate-400')}>
                      {r}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nuevo producto */}
      <Modal
        open={showProd}
        onClose={() => setShowProd(false)}
        title="Nuevo Producto / MP"
        subtitle="Configurar stock, alertas y parámetros de lote"
        icon="📦"
        footer={
          <>
            <button className="btn" onClick={() => setShowProd(false)}>Cancelar</button>
            <button className="btn-primary" onClick={guardarProducto} disabled={savingProd}>
              {savingProd ? 'Guardando...' : '✓ Guardar'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código" required><input className="input font-mono" value={formProd.codigo} onChange={e => setFormProd(f => ({...f,codigo:e.target.value}))} placeholder="MP-007" /></Field>
          <Field label="Nombre" required><input className="input" value={formProd.nombre} onChange={e => setFormProd(f => ({...f,nombre:e.target.value}))} /></Field>
          <Field label="Tipo"><select className="input" value={formProd.tipo} onChange={e => setFormProd(f => ({...f,tipo:e.target.value as 'MP'|'PT'}))}><option value="MP">MP - Materia Prima</option><option value="PT">PT - Producto Terminado</option></select></Field>
          <Field label="Unidad Base" required><select className="input" value={formProd.unidad_id} onChange={e => setFormProd(f => ({...f,unidad_id:e.target.value}))}><option value="">— Seleccionar —</option>{unidades.map(u=><option key={u.id} value={u.id}>{u.nombre} ({u.simbolo})</option>)}</select></Field>
          <Field label="Costo Unitario"><input className="input font-mono" type="number" min={0} step={0.0001} value={formProd.costo_unitario} onChange={e => setFormProd(f => ({...f,costo_unitario:+e.target.value}))} /></Field>
          <Field label="Stock Inicial"><input className="input font-mono" type="number" min={0} value={formProd.stock_actual} onChange={e => setFormProd(f => ({...f,stock_actual:+e.target.value}))} /></Field>
          <Field label="Stock Mínimo" hint="Genera alerta de Bodega cuando baje de este valor"><input className="input font-mono" type="number" min={0} value={formProd.stock_minimo} onChange={e => setFormProd(f => ({...f,stock_minimo:+e.target.value}))} /></Field>
          <Field label="Stock Máximo"><input className="input font-mono" type="number" min={0} value={formProd.stock_maximo} onChange={e => setFormProd(f => ({...f,stock_maximo:+e.target.value}))} /></Field>
          <Field label="Caducidad (días desde ingreso)" hint="Vacío = no caduca"><input className="input font-mono" type="number" min={1} value={formProd.caducidad_dias} onChange={e => setFormProd(f => ({...f,caducidad_dias:e.target.value===''?'':+e.target.value}))} placeholder="Ej: 30" /></Field>
          <Field label="Manejo de Lotes"><select className="input" value={formProd.manejo_lotes?'1':'0'} onChange={e => setFormProd(f => ({...f,manejo_lotes:e.target.value==='1'}))}><option value="1">Sí - llevar historial por lote</option><option value="0">No</option></select></Field>
        </div>
        <InfoBox>💡 Cuando el stock caiga por debajo del mínimo configurado, se generará automáticamente una alerta en Bodega.</InfoBox>
      </Modal>

      {/* Modal subir Excel */}
      <Modal
        open={showExcel}
        onClose={() => setShowExcel(false)}
        title="Subir Excel de Inventario"
        subtitle="Carga masiva sin borrar historial de lotes"
        icon="📤"
        footer={
          <>
            <button className="btn" onClick={() => setShowExcel(false)}>Cancelar</button>
            <button className="btn-primary" onClick={handleExcelUpload} disabled={!excelFile}>✓ Importar</button>
          </>
        }
      >
        <WarnBox>
          ⚠ <strong>Importante:</strong> La carga actualiza el stock actual pero <strong>no modifica</strong> el historial de lotes ni las fechas de vencimiento configuradas.
        </WarnBox>
        <div
          className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer
                     hover:border-sky-300 hover:bg-sky-50 transition-all"
          onClick={() => document.getElementById('excel-input')?.click()}
        >
          <div className="text-4xl mb-2">📊</div>
          <p className="font-semibold text-slate-600 text-sm">{excelFile ? excelFile.name : 'Haz clic para seleccionar el archivo Excel'}</p>
          <p className="text-xs text-slate-400 mt-1">.xlsx o .csv · Máx 5MB</p>
          <input id="excel-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => setExcelFile(e.target.files?.[0] ?? null)} />
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Formato esperado del Excel:</p>
          <table className="data-table text-xs">
            <thead><tr><th>codigo</th><th>nombre</th><th>stock_actual</th><th>lote</th><th>fecha_vencimiento</th></tr></thead>
            <tbody>
              <tr><td className="font-mono">MP-001</td><td>Banano Fresco</td><td className="font-mono">250</td><td className="font-mono">B-205</td><td className="font-mono">2026-04-30</td></tr>
              <tr><td className="font-mono">MP-002</td><td>Ácido Cítrico</td><td className="font-mono">15</td><td className="font-mono">AC-090</td><td className="font-mono">2026-08-15</td></tr>
            </tbody>
          </table>
        </div>
      </Modal>
    </AppLayout>
  )
}
