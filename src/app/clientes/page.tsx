// src/app/clientes/page.tsx
// Módulo de clientes — lista, búsqueda, creación y detalle

'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, OrderStatusPill, EmptyState, PageLoader, InfoBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { Cliente } from '@/types/database'
import toast from 'react-hot-toast'
import { downloadCsv } from '@/lib/download'
import clsx from 'clsx'

const TIPOS = ['Nacional', 'Exportador', 'Industrial', 'Distribuidor'] as const

const TIPO_CHIP: Record<string, string> = {
  Nacional:    'bg-slate-100 text-slate-600',
  Exportador:  'bg-sky-100 text-sky-700',
  Industrial:  'bg-violet-100 text-violet-700',
  Distribuidor:'bg-amber-100 text-amber-700',
}

const FORM_DEFAULT = {
  ruc: '', nombre: '', nombre_comercial: '', tipo: 'Nacional' as const,
  contacto_nombre: '', contacto_telefono: '', contacto_email: '',
  descuento_pct: 0, tiempo_entrega_dias: 3,
  direccion_entrega: '', ciudad: '', notas: '',
}

export default function ClientesPage() {
  const { user } = useAuth()
  const supabase  = createClient()

  const [clientes, setClientes]     = useState<Cliente[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [selected, setSelected]     = useState<Cliente | null>(null)
  const [showModal, setShowModal]   = useState(false)
  const [editing, setEditing]       = useState<Cliente | null>(null)
  const [form, setForm]             = useState(FORM_DEFAULT)
  const [saving, setSaving]         = useState(false)
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importando, setImportando] = useState(false)

  const fetchClientes = useCallback(async () => {
    const q = supabase
      .from('clientes')
      .select('*')
      .eq('activo', true)
      .order('nombre')

    if (search) q.ilike('nombre', `%${search}%`)

    const { data, error } = await q
    if (error) toast.error('Error al cargar clientes')
    else setClientes(data ?? [])
    setLoading(false)
  }, [supabase, search])

  useEffect(() => { fetchClientes() }, [fetchClientes])

  function openNew() {
    setEditing(null)
    setForm(FORM_DEFAULT)
    setShowModal(true)
  }

  function openEdit(c: Cliente) {
    setEditing(c)
    setForm({
      ruc: c.ruc, nombre: c.nombre,
      nombre_comercial: c.nombre_comercial ?? '',
      tipo: c.tipo as typeof FORM_DEFAULT.tipo,
      contacto_nombre: c.contacto_nombre ?? '',
      contacto_telefono: c.contacto_telefono ?? '',
      contacto_email: c.contacto_email ?? '',
      descuento_pct: c.descuento_pct,
      tiempo_entrega_dias: c.tiempo_entrega_dias,
      direccion_entrega: c.direccion_entrega ?? '',
      ciudad: c.ciudad ?? '',
      notas: c.notas ?? '',
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.ruc || !form.nombre) {
      toast.error('RUC y Razón Social son obligatorios')
      return
    }
    setSaving(true)

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { toast.error('Sesión expirada. Recarga la página.'); setSaving(false); return }

    const { data: userProfile } = await supabase
      .from('users').select('tenant_id').eq('id', authUser.id).single()

    if (!userProfile?.tenant_id) {
      toast.error('No se pudo obtener el tenant. Recarga la página.')
      setSaving(false)
      return
    }

    const payload = { ...form, tenant_id: userProfile.tenant_id, created_by: authUser.id }

    try {
      if (editing) {
        const { error } = await supabase.from('clientes').update(payload).eq('id', editing.id)
        if (error) { console.error('update error:', error); toast.error('Error: ' + error.message); return }
        toast.success('Cliente actualizado')
      } else {
        const { error } = await supabase.from('clientes').insert(payload)
        if (error) {
          console.error('insert error:', error)
          toast.error(error.code === '23505' ? 'El RUC ya existe' : 'Error: ' + error.message)
          return
        }
        toast.success('Cliente creado')
      }
      setShowModal(false)
      fetchClientes()
    } catch (e: unknown) {
      console.error('handleSave exception:', e)
      toast.error('Error inesperado al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('¿Desactivar este cliente?')) return
    const { error } = await supabase.from('clientes').update({ activo: false }).eq('id', id)
    if (error) toast.error('Error al desactivar')
    else { toast.success('Cliente desactivado'); fetchClientes(); setSelected(null) }
  }

  // ── Exportar clientes a Excel CSV ────────────────────────────
  function exportarExcel() {
    if (!clientes.length) { toast.error('No hay clientes para exportar'); return }
    const filtered = tipoFiltro ? clientes.filter(c => c.tipo === tipoFiltro) : clientes
    const rows = filtered.map(c => [
      c.ruc, c.nombre, c.nombre_comercial ?? '', c.tipo,
      c.contacto_nombre ?? '', c.contacto_telefono ?? '', c.contacto_email ?? '',
      c.descuento_pct, c.tiempo_entrega_dias,
      c.ciudad ?? '', c.direccion_entrega ?? '',
    ])
    downloadCsv(
      ['RUC','Razón Social','Nombre Comercial','Tipo','Contacto','Teléfono','Email','Descuento %','Días Entrega','Ciudad','Dirección'],
      rows,
      `clientes_${tipoFiltro || 'todos'}_${new Date().toISOString().split('T')[0]}.csv`
    )
    toast.success(`✅ ${rows.length} clientes exportados`)
  }

  // ── Importar clientes desde Excel/CSV ─────────────────────────
  async function handleImport() {
    if (!importFile) { toast.error('Selecciona un archivo'); return }
    setImportando(true)
    try {
      const text = await importFile.text()
      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) { toast.error('El archivo está vacío o no tiene filas de datos'); return }

      // Detectar separador (coma o punto y coma)
      const sep = lines[0].includes(';') ? ';' : ','
      const headers = lines[0].split(sep).map(h => h.replace(/['"\r]/g,'').trim().toLowerCase())

      // Mapear columnas por nombre
      const idx = {
        ruc:     headers.indexOf('ruc'),
        nombre:  headers.findIndex(h => h.includes('razon') || h.includes('razón') || h === 'nombre'),
        tipo:    headers.indexOf('tipo'),
        contacto:headers.findIndex(h => h.includes('contacto')),
        telefono:headers.findIndex(h => h.includes('telefono') || h.includes('teléfono')),
        email:   headers.indexOf('email'),
        desc:    headers.findIndex(h => h.includes('descuento')),
        ciudad:  headers.indexOf('ciudad'),
      }

      if (idx.ruc < 0 || idx.nombre < 0) {
        toast.error('El archivo debe tener columnas "ruc" y "nombre" (o "razón social")')
        return
      }

      const tiposValidos = ['Nacional','Exportador','Industrial','Distribuidor']
      let creados = 0; let errores = 0

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(sep).map(c => c.replace(/['"\r]/g,'').trim())
        const ruc  = cols[idx.ruc] ?? ''
        const nombre = cols[idx.nombre] ?? ''
        if (!ruc || !nombre) continue

        const tipo = idx.tipo >= 0 && tiposValidos.includes(cols[idx.tipo])
          ? cols[idx.tipo] : 'Nacional'

        const { error } = await supabase.from('clientes').insert({
          tenant_id: tenantId,
          ruc, nombre,
          tipo,
          contacto_nombre:   idx.contacto >= 0 ? cols[idx.contacto] || null : null,
          contacto_telefono: idx.telefono >= 0 ? cols[idx.telefono] || null : null,
          contacto_email:    idx.email >= 0 ? cols[idx.email] || null : null,
          descuento_pct:     idx.desc >= 0 ? parseFloat(cols[idx.desc]) || 0 : 0,
          ciudad:            idx.ciudad >= 0 ? cols[idx.ciudad] || null : null,
          activo: true,
        })

        if (error) {
          if (error.code === '23505') {
            // Duplicado — actualizar en vez de crear
            await supabase.from('clientes').update({ nombre, tipo }).eq('ruc', ruc)
          } else {
            errores++
          }
        } else {
          creados++
        }
      }

      const msg = `✅ ${creados} clientes importados` + (errores > 0 ? ` · ${errores} errores` : '')
      toast.success(msg)
      setShowImport(false)
      setImportFile(null)
      fetchClientes()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error al procesar el archivo')
    } finally {
      setImportando(false)
    }
  }

  if (loading) return <AppLayout title="Clientes" breadcrumb="MÓDULOS / CLIENTES"><PageLoader /></AppLayout>

  return (
    <AppLayout
      title="Clientes"
      breadcrumb="MÓDULOS / CLIENTES"
      action={
        <button className="btn-primary" onClick={openNew}>+ Nuevo Cliente</button>
      }
    >
      {/* Búsqueda */}
      <div className="flex gap-2 mb-4">
        <input
          className="input max-w-xs"
          placeholder="🔍 Nombre, RUC o ciudad..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-40" value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map(t => <option key={t}>{t}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <button className="btn text-xs" onClick={() => setShowImport(true)}>
            📤 Importar Excel
          </button>
          <button className="btn text-xs" onClick={exportarExcel}>
            📊 Exportar Excel
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-header">
          <span className="font-bold text-[14px]">Directorio de Clientes</span>
          <span className="text-[10px] font-mono bg-slate-100 border border-slate-200
                           text-slate-500 px-2 py-0.5 rounded-md">{clientes.length}</span>
        </div>
        {clientes.length === 0
          ? <EmptyState icon="🏢" title="No hay clientes aún" action={
              <button className="btn-primary" onClick={openNew}>+ Crear primer cliente</button>
            } />
          : (
          <table className="data-table">
            <thead>
              <tr>
                <th>RUC</th><th>Razón Social</th><th>Contacto</th>
                <th>Teléfono</th><th>Desc.</th><th>T. Entrega</th>
                <th>Tipo</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clientes.filter(c => !tipoFiltro || c.tipo === tipoFiltro).map(c => (
                <tr key={c.id}>
                  <td className="font-mono text-[12px] font-semibold">{c.ruc}</td>
                  <td className="font-semibold">{c.nombre}</td>
                  <td className="text-slate-500">{c.contacto_nombre ?? '—'}</td>
                  <td className="font-mono text-xs text-slate-500">{c.contacto_telefono ?? '—'}</td>
                  <td className="font-mono font-bold text-sky-600">{c.descuento_pct}%</td>
                  <td className="font-mono text-slate-500">{c.tiempo_entrega_dias} días</td>
                  <td>
                    <span className={clsx('text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md', TIPO_CHIP[c.tipo] ?? TIPO_CHIP.Nacional)}>
                      {c.tipo}
                    </span>
                  </td>
                  <td className="flex gap-1.5">
                    <button className="btn text-xs px-2 py-1" onClick={() => setSelected(c)}>Ver</button>
                    <button className="btn text-xs px-2 py-1" onClick={() => openEdit(c)}>✏</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detalle lateral */}
      {selected && (
        <div className="card mt-4 animate-[fadeUp_0.2s_ease]">
          <div className="card-header">
            <div>
              <p className="font-bold text-[14px]">{selected.nombre}</p>
              <p className="text-xs text-slate-500 mt-0.5">{selected.ruc} · {selected.tipo}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <button className="btn text-xs" onClick={() => openEdit(selected)}>✏ Editar</button>
              <button className="btn-danger text-xs" onClick={() => handleDeactivate(selected.id)}>Desactivar</button>
              <button className="btn text-xs" onClick={() => setSelected(null)}>✕</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-5">
            {[
              { l: 'RUC',               v: selected.ruc },
              { l: 'Razón Social',      v: selected.nombre },
              { l: 'Tipo',              v: selected.tipo },
              { l: 'Contacto',          v: selected.contacto_nombre },
              { l: 'Teléfono',          v: selected.contacto_telefono },
              { l: 'Email',             v: selected.contacto_email },
              { l: 'Descuento',         v: `${selected.descuento_pct}%` },
              { l: 'Tiempo de Entrega', v: `${selected.tiempo_entrega_dias} días` },
              { l: 'Ciudad',            v: selected.ciudad },
            ].map(({ l, v }) => (
              <div key={l}>
                <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-1">{l}</p>
                <p className="font-semibold text-[13px] text-slate-800">{v ?? '—'}</p>
              </div>
            ))}
            {selected.notas && (
              <div className="col-span-full">
                <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-1">Notas</p>
                <p className="text-[13px] text-slate-600">{selected.notas}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal crear/editar */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Editar Cliente' : 'Nuevo Cliente'}
        subtitle="Completa la ficha del cliente"
        icon="🏢"
        wide
        footer={
          <>
            <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : editing ? '✓ Actualizar' : '✓ Guardar Cliente'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="RUC / Identificación" required>
            <input className="input" value={form.ruc} onChange={e => setForm(f => ({ ...f, ruc: e.target.value }))} placeholder="0999999999001" />
          </Field>
          <Field label="Razón Social" required>
            <input className="input" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Empresa S.A." />
          </Field>
          <Field label="Nombre Comercial">
            <input className="input" value={form.nombre_comercial} onChange={e => setForm(f => ({ ...f, nombre_comercial: e.target.value }))} />
          </Field>
          <Field label="Tipo">
            <select className="input" value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as typeof FORM_DEFAULT.tipo }))}>
              {TIPOS.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Persona de Contacto">
            <input className="input" value={form.contacto_nombre} onChange={e => setForm(f => ({ ...f, contacto_nombre: e.target.value }))} />
          </Field>
          <Field label="Teléfono / WhatsApp">
            <input className="input" value={form.contacto_telefono} onChange={e => setForm(f => ({ ...f, contacto_telefono: e.target.value }))} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.contacto_email} onChange={e => setForm(f => ({ ...f, contacto_email: e.target.value }))} />
          </Field>
          <Field label="Descuento (%)" hint="Se aplicará automáticamente en pedidos">
            <input className="input font-mono" type="number" min={0} max={100} value={form.descuento_pct} onChange={e => setForm(f => ({ ...f, descuento_pct: +e.target.value }))} />
          </Field>
          <Field label="Tiempo de Entrega (días)" hint="Para sugerir fecha en pedidos">
            <input className="input font-mono" type="number" min={1} value={form.tiempo_entrega_dias} onChange={e => setForm(f => ({ ...f, tiempo_entrega_dias: +e.target.value }))} />
          </Field>
          <Field label="Ciudad / Provincia">
            <input className="input" value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} />
          </Field>
          <Field label="Dirección de Entrega" >
            <input className="input" value={form.direccion_entrega} onChange={e => setForm(f => ({ ...f, direccion_entrega: e.target.value }))} />
          </Field>
        </div>
        <Field label="Notas Adicionales">
          <textarea className="input" rows={2} value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Condiciones especiales, horarios..." />
        </Field>
        <InfoBox>
          💡 El descuento y tiempo de entrega se copiarán automáticamente al crear pedidos para este cliente.
        </InfoBox>
      </Modal>

      {/* Modal Importar Excel */}
      {showImport && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowImport(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center text-xl">📤</div>
              <div>
                <h3 className="font-bold text-[15px]">Importar Clientes desde Excel</h3>
                <p className="text-xs text-slate-500 mt-0.5">Sube un archivo .csv o .xlsx con los datos</p>
              </div>
              <button onClick={() => setShowImport(false)}
                className="ml-auto w-8 h-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* Zona de carga */}
              <div
                className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer hover:border-sky-300 hover:bg-sky-50 transition-all"
                onClick={() => document.getElementById('import-excel-input')?.click()}
              >
                <div className="text-4xl mb-2">📊</div>
                <p className="font-semibold text-slate-600 text-sm">
                  {importFile ? importFile.name : 'Haz clic para seleccionar el archivo'}
                </p>
                <p className="text-xs text-slate-400 mt-1">.csv o .xlsx · Máx 5MB</p>
                <input id="import-excel-input" type="file" accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
              </div>

              {/* Formato esperado */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-600 mb-2">Formato esperado del archivo CSV:</p>
                <div className="overflow-x-auto">
                  <table className="data-table text-[10px]">
                    <thead><tr><th>ruc</th><th>nombre</th><th>tipo</th><th>contacto</th><th>telefono</th><th>email</th><th>descuento</th><th>ciudad</th></tr></thead>
                    <tbody>
                      <tr><td className="font-mono">1790123456001</td><td>Empresa ABC S.A.</td><td>Nacional</td><td>Juan Pérez</td><td>0991234567</td><td>info@abc.com</td><td className="font-mono">5</td><td>Quito</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-400 mt-2">
                  💡 Si el RUC ya existe, se actualiza el nombre y tipo. Los campos son detectados automáticamente por el nombre de la columna.
                </p>
              </div>

              {/* Botones */}
              <div className="flex gap-2 justify-end">
                <button className="btn" onClick={() => { setShowImport(false); setImportFile(null) }}>Cancelar</button>
                <button
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-500 text-white border border-sky-500 hover:bg-sky-600 disabled:opacity-50"
                  onClick={handleImport}
                  disabled={!importFile || importando}
                >
                  {importando ? (
                    <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Importando...</>
                  ) : '✓ Importar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </AppLayout>
  )
}