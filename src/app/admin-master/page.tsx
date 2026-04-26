// src/app/admin-master/page.tsx — Solo accesible para rol = 'master'
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
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

const TODOS_MODULOS = [
  { key: 'dashboard',     label: 'Dashboard',      icon: '📊' },
  { key: 'clientes',      label: 'Clientes',        icon: '🏢' },
  { key: 'pedidos',       label: 'Pedidos',         icon: '📋' },
  { key: 'bodega',        label: 'Bodega',          icon: '📦' },
  { key: 'produccion',    label: 'Producción',      icon: '⚙️' },
  { key: 'formulas',      label: 'Fórmulas',        icon: '🧪' },
  { key: 'reportes',      label: 'Reportes',        icon: '📈' },
  { key: 'config',        label: 'Configuración',   icon: '⚙' },
  { key: 'admin-master',  label: 'Admin Master',    icon: '👑' },
]

export default function AdminMasterPage() {
  const { user: currentUser, isMaster, tenant: currentTenant, refreshUser } = useAuth()
  const router   = useRouter()
  const supabase = createClient()

  const [usuarios, setUsuarios]   = useState<User[]>([])
  const [tenant, setTenant]       = useState<Tenant | null>(currentTenant)
  const [loading, setLoading]     = useState(true)
  const [showNewUser, setShowNewUser]   = useState(false)
  const [showEditUser, setShowEditUser] = useState(false)
  const [editingUser, setEditingUser]   = useState<User | null>(null)
  const [saving, setSaving]       = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)

  // Branding
  const [sysName,   setSysName]   = useState(currentTenant?.nombre_sistema ?? 'SISTEMA DE PRODUCCIÓN')
  const [coName,    setCoName]    = useState(currentTenant?.nombre_empresa ?? '')
  const [logoFile,  setLogoFile]  = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState(currentTenant?.logo_url ?? '')
  const [savingBrand, setSavingBrand] = useState(false)

  // New user form
  const [formUser, setFormUser] = useState({
    nombre: '', email: '', rol: 'vendedor' as UserRole, password: '',
  })

  // Permisos por módulo del usuario en edición
  const [permisosUsuario, setPermisosUsuario] = useState<Record<string, boolean>>({})

  // Edit user form
  const [formEdit, setFormEdit] = useState({
    nombre: '', rol: 'vendedor' as UserRole, activo: true, password: '',
  })

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

  // Cargar permisos del usuario desde BD
  async function cargarPermisos(userId: string, userRol: UserRole) {
    // Módulos base según el rol
    const modulosBase: Record<string, string[]> = {
      master:   ['dashboard','clientes','pedidos','bodega','produccion','formulas','reportes','config','admin-master'],
      admin:    ['dashboard','clientes','pedidos','bodega','produccion','formulas','reportes','config'],
      vendedor: ['dashboard','clientes','pedidos'],
      bodega:   ['dashboard','pedidos','bodega'],
      operario: ['dashboard','produccion'],
    }
    const base = modulosBase[userRol] ?? []
    const baseMap: Record<string, boolean> = {}
    TODOS_MODULOS.forEach(m => { baseMap[m.key] = base.includes(m.key) })

    // Leer overrides de BD
    const { data: overrides } = await supabase
      .from('permisos_modulos')
      .select('modulo, habilitado')
      .eq('user_id', userId)

    const result = { ...baseMap }
    for (const ov of (overrides ?? [])) {
      result[ov.modulo] = ov.habilitado
    }
    setPermisosUsuario(result)
  }

  // ── Branding ─────────────────────────────────────────────────
  async function guardarBranding() {
    if (!tenant) return
    setSavingBrand(true)
    try {
      let logoUrl = tenant.logo_url
      if (logoFile) {
        const ext  = logoFile.name.split('.').pop()
        const path = `${tenant.id}/logo.${ext}`
        const { error: uploadErr } = await supabase.storage.from('logos').upload(path, logoFile, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path)
        logoUrl = urlData.publicUrl
      }
      const { error } = await supabase.from('tenants')
        .update({ nombre_sistema: sysName, nombre_empresa: coName, logo_url: logoUrl })
        .eq('id', tenant.id)
      if (error) throw error
      await refreshUser()
      toast.success('Branding actualizado')
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSavingBrand(false) }
  }

  // ── Crear usuario ─────────────────────────────────────────────
  async function crearUsuario() {
    if (!formUser.nombre || !formUser.email || !formUser.password) {
      toast.error('Todos los campos son obligatorios'); return
    }
    if (formUser.password.length < 8) { toast.error('Contraseña mínimo 8 caracteres'); return }
    const activos = usuarios.filter(u => u.activo).length
    if (tenant && activos >= tenant.licencias_total) {
      toast.error(`Límite de licencias alcanzado (${activos}/${tenant.licencias_total})`); return
    }
    setSaving(true)
    try {
      const supabaseClient = createClient()
      const { data: { session } } = await supabaseClient.auth.getSession()
      if (!session?.access_token) { toast.error('Sesión expirada. Recarga la página.'); setSaving(false); return }

      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ nombre: formUser.nombre, email: formUser.email, password: formUser.password, rol: formUser.rol }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.message ?? 'Error al crear usuario'); setSaving(false); return }
      toast.success(`✅ Usuario ${formUser.email} creado`)
      setShowNewUser(false)
      setFormUser({ nombre: '', email: '', rol: 'vendedor', password: '' })
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  // ── Abrir editar usuario ──────────────────────────────────────
  function abrirEditar(u: User) {
    if (u.id === currentUser?.id) { toast.error('No puedes editarte a ti mismo'); return }
    setEditingUser(u)
    setFormEdit({ nombre: u.nombre, rol: u.rol, activo: u.activo, password: '' })
    cargarPermisos(u.id, u.rol)
    setShowEditUser(true)
  }

  // ── Guardar edición de usuario ────────────────────────────────
  async function guardarEdicion() {
    if (!editingUser) return
    if (!formEdit.nombre) { toast.error('El nombre es obligatorio'); return }
    if (formEdit.password && formEdit.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres'); return
    }
    setSavingEdit(true)
    try {
      // Actualizar perfil en tabla users
      const { error } = await supabase.from('users')
        .update({ nombre: formEdit.nombre, rol: formEdit.rol, activo: formEdit.activo })
        .eq('id', editingUser.id)
      if (error) { toast.error('Error: ' + error.message); return }

      // Cambiar contraseña si se proporcionó
      if (formEdit.password) {
        const supabaseClient = createClient()
        const { data: { session } } = await supabaseClient.auth.getSession()
        if (session?.access_token) {
          const res = await fetch('/api/admin/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ user_id: editingUser.id, password: formEdit.password }),
          })
          if (!res.ok) {
            const d = await res.json()
            toast.error('Error al cambiar contraseña: ' + (d.message ?? 'Error'))
            return
          }
        }
      }

      toast.success(`✅ Usuario ${editingUser.nombre} actualizado`)
      setShowEditUser(false)
      setEditingUser(null)
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSavingEdit(false) }
  }

  // ── Eliminar usuario ──────────────────────────────────────────
  async function eliminarUsuario(u: User) {
    if (u.id === currentUser?.id) { toast.error('No puedes eliminarte a ti mismo'); return }
    if (u.rol === 'master') { toast.error('No se puede eliminar al Admin Master'); return }
    if (!confirm(`¿Eliminar definitivamente al usuario "${u.nombre}"?\n\nSus pedidos y órdenes NO se borrarán, pero no podrá iniciar sesión.`)) return

    try {
      const supabaseClient = createClient()
      const { data: { session } } = await supabaseClient.auth.getSession()
      if (!session?.access_token) { toast.error('Sesión expirada'); return }

      const res = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_id: u.id }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.message ?? 'Error al eliminar'); return }
      toast.success(`Usuario ${u.nombre} eliminado`)
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
  }

  // ── Toggle módulo individual ──────────────────────────────────────
  async function toggleModulo(moduloKey: string, habilitado: boolean) {
    if (!editingUser) return
    const nuevoEstado = !habilitado
    setPermisosUsuario(prev => ({ ...prev, [moduloKey]: nuevoEstado }))

    // Guardar en BD (upsert)
    const { error } = await supabase.from('permisos_modulos').upsert({
      user_id: editingUser.id,
      tenant_id: currentUser?.tenant_id,
      modulo: moduloKey,
      habilitado: nuevoEstado,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,modulo' })

    if (error) {
      toast.error('Error al guardar permiso')
      setPermisosUsuario(prev => ({ ...prev, [moduloKey]: habilitado })) // revert
    } else {
      toast.success(`${nuevoEstado ? '✅ Habilitado' : '🚫 Deshabilitado'}: ${TODOS_MODULOS.find(m=>m.key===moduloKey)?.label}`)
    }
  }

  // ── Toggle activo ─────────────────────────────────────────────
  async function toggleUsuario(u: User) {
    if (u.id === currentUser?.id) { toast.error('No puedes desactivarte a ti mismo'); return }
    if (u.rol === 'master') { toast.error('No puedes desactivar al Admin Master'); return }
    const { error } = await supabase.from('users').update({ activo: !u.activo }).eq('id', u.id)
    if (error) toast.error('Error')
    else { toast.success(u.activo ? 'Usuario desactivado' : 'Usuario reactivado'); loadData() }
  }

  if (loading || !isMaster) return <AppLayout title="Admin Master" breadcrumb="SISTEMA / ADMIN MASTER"><PageLoader /></AppLayout>

  const activos     = usuarios.filter(u => u.activo).length
  const disponibles = (tenant?.licencias_total ?? 0) - activos

  return (
    <AppLayout title="⚙ Admin Master" breadcrumb="SISTEMA / ADMIN MASTER"
      action={
        <button className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-white border border-amber-500 hover:bg-amber-600"
          onClick={() => setShowNewUser(true)}>
          + Crear Usuario
        </button>
      }>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── BRANDING ──────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">⚙ Configuración del Sistema</span>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 border border-amber-200 ml-2">ADMIN MASTER</span>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <WarnBox>⚠ Estos cambios se aplican a <strong>todos los usuarios</strong> del sistema de forma inmediata.</WarnBox>
            <Field label="Nombre del Sistema">
              <input className="input" value={sysName} onChange={e => setSysName(e.target.value)} />
            </Field>
            <Field label="Nombre de la Empresa">
              <input className="input" value={coName} onChange={e => setCoName(e.target.value)} />
            </Field>
            <Field label="Logo de la Empresa">
              <div className="flex gap-3 items-center">
                <div className="w-14 h-14 rounded-xl border-2 border-dashed border-slate-200 overflow-hidden flex items-center justify-center bg-slate-50 cursor-pointer hover:border-sky-300"
                  onClick={() => document.getElementById('logo-upload')?.click()}>
                  {logoPreview
                    ? <Image src={logoPreview} alt="Logo" width={56} height={56} className="object-cover w-full h-full" />
                    : <span className="text-2xl">🏭</span>}
                </div>
                <div>
                  <button className="btn text-xs" onClick={() => document.getElementById('logo-upload')?.click()}>📤 Subir logo</button>
                  {logoPreview && <button className="btn text-xs ml-2" onClick={() => { setLogoPreview(''); setLogoFile(null) }}>✕ Quitar</button>}
                  <p className="text-[10px] text-slate-400 mt-1">PNG, JPG o SVG · máx 2MB</p>
                  <input id="logo-upload" type="file" accept="image/*" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 2*1024*1024) { toast.error('El logo no puede superar 2MB'); return }
                      setLogoFile(f); setLogoPreview(URL.createObjectURL(f))
                    }} />
                </div>
              </div>
            </Field>
            <Field label="Vista previa del sidebar">
              <div className="bg-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-sky-400 to-sky-700 flex items-center justify-center">
                  {logoPreview ? <Image src={logoPreview} alt="" width={40} height={40} className="object-cover w-full h-full" /> : <span className="text-xl">🏭</span>}
                </div>
                <div>
                  <p className="text-white font-extrabold text-[13px] leading-tight">{sysName || 'SISTEMA DE PRODUCCIÓN'}</p>
                  <p className="text-sky-400 text-[10px] font-semibold mt-0.5">{coName || 'Tu Empresa S.A.'}</p>
                </div>
              </div>
            </Field>
            <button className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-white border border-amber-500 hover:bg-amber-600 self-start"
              onClick={guardarBranding} disabled={savingBrand}>
              {savingBrand ? 'Aplicando...' : '💾 Aplicar cambios al sistema'}
            </button>
          </div>
        </div>

        {/* ── USUARIOS ──────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <span className="font-bold text-[14px]">👑 Gestión de Usuarios</span>
            <div className="ml-auto">
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-amber-500 text-white border border-amber-500 hover:bg-amber-600"
                onClick={() => setShowNewUser(true)}>
                + Crear Usuario
              </button>
            </div>
          </div>
          <InfoBox><div className="p-2 text-xs">🔒 Solo el <strong>Admin Master</strong> puede crear, editar o eliminar usuarios.</div></InfoBox>
          <table className="data-table">
            <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th>Acciones</th></tr></thead>
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
                    <span className={clsx('text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                      u.rol === 'master' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>
                      {ROLE_LABELS[u.rol]}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-slate-400">
                    {u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleDateString('es') : 'Nunca'}
                  </td>
                  <td>
                    <span className={clsx('text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full border',
                      u.activo ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    {u.rol !== 'master' && (
                      <div className="flex gap-1">
                        <button
                          className="btn text-xs px-2 py-1 text-sky-600 hover:bg-sky-50 hover:border-sky-200"
                          onClick={() => abrirEditar(u)}>
                          ✏ Editar
                        </button>
                        <button
                          className={clsx('btn text-xs px-2 py-1', u.activo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50')}
                          onClick={() => toggleUsuario(u)}>
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          className="btn text-xs px-2 py-1 text-red-500 hover:bg-red-50 hover:border-red-200"
                          onClick={() => eliminarUsuario(u)}>
                          🗑
                        </button>
                      </div>
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
            { label: 'Usuarios activos',    value: activos,                      color: 'text-sky-600' },
            { label: 'Licencias totales',   value: tenant?.licencias_total ?? 0, color: 'text-emerald-600' },
            { label: 'Disponibles',         value: disponibles,                  color: disponibles > 0 ? 'text-amber-500' : 'text-red-500' },
            { label: 'Versión del sistema', value: 'v1.0',                       color: 'text-sky-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center p-4 bg-slate-50 rounded-xl border border-slate-200">
              <p className={clsx('font-mono font-bold text-[28px] leading-none', color)}>{value}</p>
              <p className="text-xs text-slate-500 mt-2">{label}</p>
            </div>
          ))}
        </div>
        {disponibles === 0 && <div className="mx-5 mb-5"><WarnBox>⚠ Has alcanzado el límite de licencias. Contacta al proveedor para ampliar tu plan.</WarnBox></div>}
      </div>

      {/* ── Modal CREAR usuario ────────────────────────────── */}
      <Modal open={showNewUser} onClose={() => setShowNewUser(false)}
        title="Crear Usuario" subtitle="Solo el Admin Master puede crear usuarios" icon="👤"
        footer={<>
          <button className="btn" onClick={() => setShowNewUser(false)}>Cancelar</button>
          <button className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-white border border-amber-500 hover:bg-amber-600 disabled:opacity-50"
            onClick={crearUsuario} disabled={saving || disponibles <= 0}>
            {saving ? 'Creando...' : '✓ Crear Usuario'}
          </button>
        </>}>
        <WarnBox>🔒 Al crear este usuario se usará <strong>1 licencia</strong>. Disponibles: <strong>{disponibles}</strong> de {tenant?.licencias_total}.</WarnBox>
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
        {/* Módulos accesibles según rol seleccionado */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-slate-600 mb-2">Módulos que tendrá habilitados:</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { modulo: 'Dashboard',      roles: ['master','admin','vendedor','bodega','operario'] },
              { modulo: 'Clientes',       roles: ['master','admin','vendedor'] },
              { modulo: 'Pedidos',        roles: ['master','admin','vendedor','bodega'] },
              { modulo: 'Bodega',         roles: ['master','admin','bodega'] },
              { modulo: 'Producción',     roles: ['master','admin','operario','bodega'] },
              { modulo: 'Fórmulas',       roles: ['master','admin'] },
              { modulo: 'Reportes',       roles: ['master','admin'] },
              { modulo: 'Configuración',  roles: ['master','admin'] },
            ].map(({ modulo, roles }) => {
              const tiene = roles.includes(formUser.rol)
              return (
                <span key={modulo} className={clsx(
                  'text-[10px] font-mono font-semibold px-2 py-1 rounded-lg border',
                  tiene
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-400 border-slate-200'
                )}>
                  {tiene ? '✓' : '—'} {modulo}
                </span>
              )
            })}
          </div>
        </div>
        <InfoBox>📧 El usuario podrá iniciar sesión con estas credenciales inmediatamente.</InfoBox>
      </Modal>

      {/* ── Modal EDITAR usuario ───────────────────────────── */}
      <Modal open={showEditUser} onClose={() => { setShowEditUser(false); setEditingUser(null) }}
        title={`Editar Usuario: ${editingUser?.nombre ?? ''}`}
        subtitle="Solo el Admin Master puede editar usuarios"
        icon="✏"
        footer={<>
          <button className="btn" onClick={() => { setShowEditUser(false); setEditingUser(null) }}>Cancelar</button>
          <button className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-500 text-white border border-sky-500 hover:bg-sky-600 disabled:opacity-50"
            onClick={guardarEdicion} disabled={savingEdit}>
            {savingEdit ? 'Guardando...' : '✓ Guardar Cambios'}
          </button>
        </>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre Completo" required>
            <input className="input" value={formEdit.nombre} onChange={e => setFormEdit(f => ({...f,nombre:e.target.value}))} />
          </Field>
          <Field label="Rol" required>
            <select className="input" value={formEdit.rol} onChange={e => setFormEdit(f => ({...f,rol:e.target.value as UserRole}))}>
              <option value="admin">Administrador</option>
              <option value="vendedor">Vendedor</option>
              <option value="bodega">Bodega</option>
              <option value="operario">Operario</option>
            </select>
          </Field>
          <Field label="Estado">
            <select className="input" value={formEdit.activo ? '1' : '0'} onChange={e => setFormEdit(f => ({...f,activo:e.target.value==='1'}))}>
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </Field>
          <Field label="Nueva Contraseña" hint="Dejar vacío para no cambiar">
            <input className="input" type="password" value={formEdit.password} onChange={e => setFormEdit(f => ({...f,password:e.target.value}))} placeholder="••••••••" />
          </Field>
        </div>
        <InfoBox>💡 Solo cambia los campos que necesitas modificar. El email no se puede editar.</InfoBox>
        <div className="text-xs text-slate-500 mb-2">Email actual: <strong>{editingUser?.email}</strong></div>

        {/* Permisos por módulo — toggle individual */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-600">Acceso por módulo</p>
            <p className="text-[10px] text-slate-400">Los cambios se guardan inmediatamente</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TODOS_MODULOS.filter(m => m.key !== 'admin-master').map(m => {
              const habilitado = permisosUsuario[m.key] ?? false
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleModulo(m.key, habilitado)}
                  className={clsx(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all',
                    habilitado
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-100 border-slate-200 text-slate-400'
                  )}
                >
                  <span className="text-base">{m.icon}</span>
                  <span className="text-xs font-semibold flex-1">{m.label}</span>
                  <span className={clsx(
                    'w-8 h-4 rounded-full transition-colors flex-shrink-0 relative',
                    habilitado ? 'bg-emerald-400' : 'bg-slate-300'
                  )}>
                    <span className={clsx(
                      'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
                      habilitado ? 'left-4' : 'left-0.5'
                    )} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Modal>
    </AppLayout>
  )
}