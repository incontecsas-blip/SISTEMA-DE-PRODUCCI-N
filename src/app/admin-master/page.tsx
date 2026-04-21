// src/app/admin-master/page.tsx
// Solo accesible para rol = 'master'
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'
import { Modal, Field, PageLoader, InfoBox, WarnBox } from '@/components/ui'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import type { User, Tenant } from '@/types/database'
import { ROLE_LABELS } from '@/types/database'
import type { UserRole } from '@/types/database'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const AVATAR_COLORS: Record<UserRole, string> = {
  master:   'from-amber-400 to-amber-600',
  admin:    'from-sky-400 to-sky-700',
  vendedor: 'from-emerald-400 to-emerald-700',
  bodega:   'from-violet-400 to-violet-700',
  operario: 'from-red-400 to-red-700',
}

export default function AdminMasterPage() {
  const { user: currentUser, isMaster, tenant: currentTenant, refreshUser } = useAuth()
  const router  = useRouter()
  const supabase = createClient()

  const [usuarios, setUsuarios]   = useState<User[]>([])
  const [tenant, setTenant]       = useState<Tenant | null>(currentTenant)
  const [loading, setLoading]     = useState(true)
  const [showNewUser, setShowNewUser] = useState(false)
  const [saving, setSaving]       = useState(false)

  // Branding form
  const [sysName, setSysName]   = useState(currentTenant?.nombre_sistema ?? 'SISTEMA DE PRODUCCIÓN')
  const [coName, setCoName]     = useState(currentTenant?.nombre_empresa ?? '')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState(currentTenant?.logo_url ?? '')
  const [savingBrand, setSavingBrand] = useState(false)

  // New user form
  const [formUser, setFormUser] = useState({
    nombre: '', email: '', rol: 'vendedor' as UserRole, password: '',
  })

  // Redirect if not master
  useEffect(() => {
    if (!loading && !isMaster) router.replace('/dashboard')
  }, [loading, isMaster, router])

  const loadData = useCallback(async () => {
    const [{ data: users }, { data: ten }] = await Promise.all([
      supabase.from('users').select('*').eq('tenant_id', currentUser?.tenant_id ?? '').order('created_at'),
      supabase.from('tenants').select('*').eq('id', currentUser?.tenant_id ?? '').single(),
    ])
    setUsuarios(users ?? [])
    setTenant(ten)
    if (ten) { setSysName(ten.nombre_sistema); setCoName(ten.nombre_empresa); setLogoPreview(ten.logo_url ?? '') }
    setLoading(false)
  }, [supabase, currentUser?.tenant_id])

  useEffect(() => { loadData() }, [loadData])

  async function guardarBranding() {
    if (!tenant) return
    setSavingBrand(true)
    try {
      let logoUrl = tenant.logo_url

      // Subir logo si se seleccionó uno nuevo
      if (logoFile) {
        const ext  = logoFile.name.split('.').pop()
        const path = `${tenant.id}/logo.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('logos')
          .upload(path, logoFile, { upsert: true })
        if (uploadErr) throw uploadErr

        const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path)
        logoUrl = urlData.publicUrl
      }

      const { error } = await supabase
        .from('tenants')
        .update({ nombre_sistema: sysName, nombre_empresa: coName, logo_url: logoUrl })
        .eq('id', tenant.id)

      if (error) throw error
      await refreshUser()
      toast.success('Branding actualizado en todo el sistema')
      loadData()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setSavingBrand(false)
    }
  }

  async function crearUsuario() {
    if (!formUser.nombre || !formUser.email || !formUser.password) {
      toast.error('Todos los campos son obligatorios'); return
    }
    if (formUser.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres'); return
    }

    // Verificar licencias
    const activos = usuarios.filter(u => u.activo).length
    if (tenant && activos >= tenant.licencias_total) {
      toast.error(`Límite de licencias alcanzado (${activos}/${tenant.licencias_total}). Contacta al administrador del sistema.`)
      return
    }

    setSaving(true)
    try {
      // 1. Crear usuario en Supabase Auth via Admin API
      //    En producción esto debe ir en una Edge Function con service_role
      //    Aquí simulamos el flujo completo
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: formUser.nombre,
          email: formUser.email,
          password: formUser.password,
          rol: formUser.rol,
          tenant_id: currentUser?.tenant_id,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message ?? 'Error al crear usuario')
      }
      toast.success(`Usuario ${formUser.email} creado · Credenciales enviadas`)
      setShowNewUser(false)
      setFormUser({ nombre: '', email: '', rol: 'vendedor', password: '' })
      loadData()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleUsuario(u: User) {
    if (u.id === currentUser?.id) { toast.error('No puedes desactivarte a ti mismo'); return }
    if (u.rol === 'master') { toast.error('No puedes desactivar al Admin Master'); return }
    const { error } = await supabase.from('users').update({ activo: !u.activo }).eq('id', u.id)
    if (error) toast.error('Error')
    else { toast.success(u.activo ? 'Usuario desactivado' : 'Usuario reactivado'); loadData() }
  }

  if (loading || !isMaster) return <AppLayout title="Admin Master" breadcrumb="SISTEMA / ADMIN MASTER"><PageLoader /></AppLayout>

  const activos = usuarios.filter(u => u.activo).length
  const disponibles = (tenant?.licencias_total ?? 0) - activos

  return (
    <AppLayout
      title="⚙ Admin Master"
      breadcrumb="SISTEMA / ADMIN MASTER"
      action={<button className="btn gold bg-amber-500 text-white border-amber-500 hover:bg-amber-600" onClick={() => setShowNewUser(true)}>+ Crear Usuario</button>}
    >
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* ── BRANDING ──────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">⚙ Configuración del Sistema</span>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200">
              ADMIN MASTER
            </span>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <WarnBox>
              ⚠ Estos cambios se aplican a <strong>todos los usuarios</strong> del sistema de forma inmediata.
            </WarnBox>

            <Field label="Nombre del Sistema">
              <input className="input" value={sysName} onChange={e => setSysName(e.target.value)} />
            </Field>

            <Field label="Nombre de la Empresa">
              <input className="input" value={coName} onChange={e => setCoName(e.target.value)} />
            </Field>

            <Field label="Logo de la Empresa">
              <div className="flex gap-3 items-center">
                <div className="w-14 h-14 rounded-xl border-2 border-dashed border-slate-200 overflow-hidden
                                flex items-center justify-center bg-slate-50 cursor-pointer
                                hover:border-sky-300 transition-colors"
                  onClick={() => document.getElementById('logo-upload')?.click()}>
                  {logoPreview
                    ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                    : <span className="text-2xl">🏭</span>
                  }
                </div>
                <div>
                  <button className="btn text-xs" onClick={() => document.getElementById('logo-upload')?.click()}>
                    📤 Subir logo
                  </button>
                  {logoPreview && (
                    <button className="btn text-xs ml-2" onClick={() => { setLogoPreview(''); setLogoFile(null) }}>
                      ✕ Quitar
                    </button>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">PNG, JPG o SVG · máx 2MB</p>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 2 * 1024 * 1024) { toast.error('El logo no puede superar 2MB'); return }
                      setLogoFile(f)
                      setLogoPreview(URL.createObjectURL(f))
                    }}
                  />
                </div>
              </div>
            </Field>

            {/* Preview en vivo */}
            <Field label="Vista previa del sidebar">
              <div className="bg-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-sky-400 to-sky-700 flex items-center justify-center">
                  {logoPreview
                    ? <img src={logoPreview} alt="" className="w-full h-full object-cover" />
                    : <span className="text-xl">🏭</span>
                  }
                </div>
                <div>
                  <p className="text-white font-extrabold text-[13px] leading-tight">{sysName || 'SISTEMA DE PRODUCCIÓN'}</p>
                  <p className="text-sky-400 text-[10px] font-semibold mt-0.5">{coName || 'Tu Empresa S.A.'}</p>
                </div>
              </div>
            </Field>

            <button
              className="btn bg-amber-500 text-white border-amber-500 hover:bg-amber-600 self-start"
              onClick={guardarBranding}
              disabled={savingBrand}
            >
              {savingBrand ? 'Aplicando...' : '💾 Aplicar cambios al sistema'}
            </button>
          </div>
        </div>

        {/* ── USUARIOS ──────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">👑 Gestión de Usuarios</span>
            <div className="ml-auto">
              <button className="btn bg-amber-500 text-white border-amber-500 hover:bg-amber-600 text-xs" onClick={() => setShowNewUser(true)}>
                + Crear Usuario
              </button>
            </div>
          </div>
          <InfoBox>
            <div className="p-2 text-xs">
              🔒 Solo el <strong>Admin Master</strong> puede crear, editar o desactivar usuarios.
              Ningún otro rol tiene acceso a esta función.
            </div>
          </InfoBox>
          <table className="data-table">
            <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th>Acc.</th></tr></thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className={clsx('w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0', AVATAR_COLORS[u.rol])}>
                        {u.nombre.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()}
                      </div>
                      <span className="font-semibold text-sm">{u.nombre}</span>
                    </div>
                  </td>
                  <td className="text-slate-500 text-xs">{u.email}</td>
                  <td>
                    <span className={clsx('status-pill text-[9px]',
                      u.rol === 'master' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200')}>
                      {ROLE_LABELS[u.rol]}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-slate-400">
                    {u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleDateString('es') : 'Nunca'}
                  </td>
                  <td>
                    <span className={clsx('status-pill text-[9px]',
                      u.activo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    {u.rol !== 'master' && (
                      <button
                        className={clsx('btn text-xs px-2 py-1', u.activo ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50')}
                        onClick={() => toggleUsuario(u)}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel de licencias */}
      <div className="card">
        <div className="card-header"><span className="font-bold text-[14px]">📊 Licencias y Usuarios</span></div>
        <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Usuarios activos',   value: activos,                      color: 'text-sky-600' },
            { label: 'Licencias totales',  value: tenant?.licencias_total ?? 0, color: 'text-emerald-600' },
            { label: 'Disponibles',        value: disponibles,                  color: disponibles > 0 ? 'text-amber-500' : 'text-red-500' },
            { label: 'Versión del sistema', value: 'v1.0',                      color: 'text-sky-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center p-4 bg-slate-50 rounded-xl border border-slate-200">
              <p className={clsx('font-mono font-bold text-[28px] leading-none', color)}>{value}</p>
              <p className="text-xs text-slate-500 mt-2">{label}</p>
            </div>
          ))}
        </div>
        {disponibles === 0 && (
          <div className="mx-5 mb-5">
            <WarnBox>⚠ Has alcanzado el límite de licencias. Para agregar más usuarios, contacta al proveedor del sistema para ampliar tu plan.</WarnBox>
          </div>
        )}
      </div>

      {/* Modal crear usuario */}
      <Modal
        open={showNewUser}
        onClose={() => setShowNewUser(false)}
        title="Crear Usuario"
        subtitle="Solo el Admin Master puede crear usuarios"
        icon="👤"
        footer={
          <>
            <button className="btn" onClick={() => setShowNewUser(false)}>Cancelar</button>
            <button
              className="btn bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
              onClick={crearUsuario}
              disabled={saving || disponibles <= 0}
            >
              {saving ? 'Creando...' : '✓ Crear Usuario'}
            </button>
          </>
        }
      >
        <WarnBox>
          🔒 Al crear este usuario se usará <strong>1 licencia</strong>. Disponibles: <strong>{disponibles}</strong> de {tenant?.licencias_total}.
        </WarnBox>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre Completo" required>
            <input className="input" value={formUser.nombre} onChange={e => setFormUser(f => ({...f,nombre:e.target.value}))} placeholder="Nombre y apellido" />
          </Field>
          <Field label="Email" required>
            <input className="input" type="email" value={formUser.email} onChange={e => setFormUser(f => ({...f,email:e.target.value}))} placeholder="usuario@empresa.com" />
          </Field>
          <Field label="Rol" required>
            <select className="input" value={formUser.rol} onChange={e => setFormUser(f => ({...f,rol:e.target.value as UserRole}))}>
              <option value="admin">Administrador</option>
              <option value="vendedor">Vendedor</option>
              <option value="bodega">Bodega</option>
              <option value="operario">Operario</option>
            </select>
          </Field>
          <Field label="Contraseña Temporal" required hint="Mínimo 8 caracteres">
            <input className="input" type="password" value={formUser.password} onChange={e => setFormUser(f => ({...f,password:e.target.value}))} placeholder="••••••••" />
          </Field>
        </div>
        <InfoBox>📧 Se enviará un correo al usuario con sus credenciales de acceso al sistema.</InfoBox>
      </Modal>
    </AppLayout>
  )
}
