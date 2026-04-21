// src/app/formulas/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, EmptyState, PageLoader, InfoBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { Formula, Producto, UnidadMedida } from '@/types/database'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface LineaForm { mp_id: string; cantidad: number; unidad_id: string; es_semielaborado: boolean }

export default function FormulasPage() {
  const { user } = useAuth()
  const supabase  = createClient()

  const [formulas, setFormulas]   = useState<Formula[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [mps, setMps]             = useState<Producto[]>([])
  const [unidades, setUnidades]   = useState<UnidadMedida[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving]       = useState(false)

  // Calculadora
  const [calcFormula, setCalcFormula] = useState<Formula | null>(null)
  const [calcQty, setCalcQty]         = useState(100)

  // Form nueva fórmula
  const [formPT, setFormPT]       = useState('')
  const [formBase, setFormBase]   = useState(1)
  const [formUnid, setFormUnid]   = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [lineas, setLineas]       = useState<LineaForm[]>([])

  const load = useCallback(async () => {
    const [{ data: fs }, { data: prods }, { data: uns }] = await Promise.all([
      supabase.from('formulas')
        .select('*, producto:productos(nombre,codigo), lineas:formulas_lineas(*, mp:productos(nombre,codigo), unidad:unidades_medida(simbolo))')
        .order('created_at', { ascending: false }),
      supabase.from('productos').select('*, unidad:unidades_medida(simbolo)').eq('activo', true),
      supabase.from('unidades_medida').select('*'),
    ])
    setFormulas(fs ?? [])
    setProductos((prods ?? []).filter(p => p.tipo === 'PT'))
    setMps((prods ?? []).filter(p => p.tipo === 'MP'))
    setUnidades(uns ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function agregarLinea() {
    setLineas(ls => [...ls, {
      mp_id: mps[0]?.id ?? '',
      cantidad: 1,
      unidad_id: unidades[0]?.id ?? '',
      es_semielaborado: false,
    }])
  }

  async function guardarFormula() {
    if (!formPT) { toast.error('Selecciona el producto terminado'); return }
    if (lineas.length === 0) { toast.error('Agrega al menos un ingrediente'); return }
    setSaving(true)
    try {
      const { data: formula, error: ef } = await supabase
        .from('formulas')
        .insert({
          producto_id: formPT,
          activa: true,
          base_cantidad: formBase,
          base_unidad_id: formUnid || unidades[0]?.id,
          notas: formNotes,
          created_by: user?.id,
        })
        .select().single()
      if (ef) throw ef

      const { error: el } = await supabase.from('formulas_lineas').insert(
        lineas.map(l => ({
          formula_id: formula.id,
          mp_id: l.mp_id,
          cantidad: l.cantidad,
          unidad_id: l.unidad_id,
          es_semielaborado: l.es_semielaborado,
        }))
      )
      if (el) throw el

      toast.success('Fórmula guardada y activada')
      setShowModal(false)
      load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <AppLayout title="Fórmulas" breadcrumb="MÓDULOS / FÓRMULAS"><PageLoader /></AppLayout>

  // Agrupar fórmulas por producto
  const porProducto = formulas.reduce<Record<string, Formula[]>>((acc, f) => {
    const pid = f.producto_id
    if (!acc[pid]) acc[pid] = []
    acc[pid].push(f)
    return acc
  }, {})

  return (
    <AppLayout
      title="Fórmulas / Recetas"
      breadcrumb="MÓDULOS / FÓRMULAS"
      action={<button className="btn-primary" onClick={() => { setLineas([]); setShowModal(true) }}>+ Nueva Fórmula</button>}
    >
      {Object.keys(porProducto).length === 0 && (
        <EmptyState icon="🧪" title="Sin fórmulas aún" action={
          <button className="btn-primary" onClick={() => setShowModal(true)}>+ Crear primera fórmula</button>
        } />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(porProducto).map(([, fs]) => {
          const activa = fs.find(f => f.activa) ?? fs[0]
          const prod = activa.producto as { nombre?: string; codigo?: string }
          return (
            <div key={activa.id} className="card">
              <div className="card-header">
                <div>
                  <p className="font-bold text-[14px]">{prod?.nombre}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{prod?.codigo}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                    v{activa.version} · activa
                  </span>
                  <button className="btn text-xs px-2 py-1" onClick={() => { setShowModal(true); setLineas([]) }}>
                    ✏ Nueva versión
                  </button>
                  {fs.length > 1 && (
                    <button className="btn text-xs px-2 py-1" onClick={() => toast.success(`${fs.length} versiones`)}>
                      📋 Historial ({fs.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4">
                <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-3">
                  PARA {activa.base_cantidad} kg DE PT SE REQUIERE:
                </p>
                <div className="flex flex-col gap-2 mb-4">
                  {(activa.lineas ?? []).map((l) => {
                    const linea = l as { id: string; cantidad: number; mp?: { nombre?: string }; unidad?: { simbolo?: string } }
                    return (
                      <div key={linea.id} className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-200
                                                      hover:bg-sky-50 hover:border-sky-200 transition-colors">
                        <span className="flex-1 font-semibold text-[13px] text-slate-700">{linea.mp?.nombre}</span>
                        <span className="font-mono font-bold text-sky-600 text-[14px]">{linea.cantidad.toFixed(3)}</span>
                        <span className="font-mono text-[10px] text-slate-400 min-w-[20px]">{linea.unidad?.simbolo}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Calculadora */}
                <div className="bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 rounded-xl p-3">
                  <p className="font-mono text-[9px] tracking-widest text-sky-600 uppercase mb-2 font-semibold">
                    CALCULADORA
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      className="input font-mono w-20 text-sm"
                      type="number" min={1}
                      value={calcFormula?.id === activa.id ? calcQty : 100}
                      onChange={e => { setCalcFormula(activa); setCalcQty(+e.target.value) }}
                      onFocus={() => setCalcFormula(activa)}
                    />
                    <span className="text-slate-500 text-xs">kg a producir</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(activa.lineas ?? []).map((l) => {
                      const linea = l as { id: string; cantidad: number; mp?: { nombre?: string }; unidad?: { simbolo?: string } }
                      const qty = calcFormula?.id === activa.id
                        ? ((linea.cantidad / activa.base_cantidad) * calcQty).toFixed(3)
                        : ((linea.cantidad / activa.base_cantidad) * 100).toFixed(3)
                      return (
                        <div key={linea.id} className="bg-white border border-sky-200 rounded-lg px-3 py-2 text-xs">
                          <p className="font-mono font-bold text-sky-600 text-[14px]">{qty} {linea.unidad?.simbolo}</p>
                          <p className="text-slate-400 text-[10px] mt-0.5">{linea.mp?.nombre}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Versiones anteriores */}
                {fs.length > 1 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="font-mono text-[9px] tracking-widest text-slate-400 uppercase mb-2">Historial de versiones</p>
                    <div className="flex flex-col gap-1">
                      {fs.filter(f => !f.activa).map(f => (
                        <div key={f.id} className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-mono">v{f.version}</span>
                          <span>·</span>
                          <span>{format(new Date(f.created_at), 'dd/MM/yyyy')}</span>
                          <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">inactiva</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Tarjeta de crear */}
        <button
          className="card border-2 border-dashed border-slate-200 bg-slate-50
                     flex flex-col items-center justify-center min-h-[200px] gap-2
                     text-slate-400 hover:border-sky-300 hover:text-sky-500
                     hover:bg-sky-50 transition-all cursor-pointer"
          onClick={() => { setLineas([]); setShowModal(true) }}
        >
          <span className="text-4xl">➕</span>
          <span className="font-semibold text-[14px]">Nueva Fórmula</span>
        </button>
      </div>

      {/* Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Nueva Fórmula / Receta"
        subtitle="Define la composición del producto terminado"
        icon="🧪"
        wide
        footer={
          <>
            <button className="btn" onClick={() => setShowModal(false)}>Cancelar</button>
            <button className="btn-primary" onClick={guardarFormula} disabled={saving}>
              {saving ? 'Guardando...' : '✓ Guardar y Activar'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Producto Terminado" required>
            <select className="input" value={formPT} onChange={e => setFormPT(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base">
              <input className="input font-mono" type="number" min={0.001} step={0.001} value={formBase} onChange={e => setFormBase(+e.target.value)} />
            </Field>
            <Field label="Unidad">
              <select className="input" value={formUnid} onChange={e => setFormUnid(e.target.value)}>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.simbolo}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-600 mb-3">Ingredientes</p>
          <div className="flex flex-col gap-2">
            {lineas.map((l, i) => (
              <div key={i} className="grid grid-cols-[2fr_100px_80px_auto] gap-2 items-center">
                <select className="input text-xs" value={l.mp_id} onChange={e => setLineas(ls => ls.map((x, j) => j===i ? {...x, mp_id:e.target.value} : x))}>
                  {mps.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <input className="input font-mono text-xs" type="number" min={0} step={0.00001} value={l.cantidad}
                  onChange={e => setLineas(ls => ls.map((x, j) => j===i ? {...x, cantidad:+e.target.value} : x))} />
                <select className="input text-xs" value={l.unidad_id}
                  onChange={e => setLineas(ls => ls.map((x, j) => j===i ? {...x, unidad_id:e.target.value} : x))}>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.simbolo}</option>)}
                </select>
                <button className="btn text-xs px-2 py-1 text-red-500 hover:bg-red-50" onClick={() => setLineas(ls => ls.filter((_,j) => j!==i))}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn text-xs mt-2" onClick={agregarLinea}>+ Ingrediente</button>
        </div>

        <Field label="Notas de la versión">
          <input className="input" value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Cambios respecto a versión anterior..." />
        </Field>

        <InfoBox>
          💡 Al guardar, esta versión se activará automáticamente y la anterior quedará inactiva en el historial.
        </InfoBox>
      </Modal>
    </AppLayout>
  )
}
