// src/components/layout/AppLayout.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '@/context/AuthContext'
import { ROLE_LABELS, ROLE_AVATAR_GRADIENT, cn, initials } from '@/lib/utils'
import type { UserRole } from '@/types/database'

const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: '📊', roles: ['master','admin','vendedor','bodega','operario'] },
    ],
  },
  {
    label: 'Módulos',
    items: [
      { href: '/clientes',   label: 'Clientes',        icon: '🏢', roles: ['master','admin','vendedor'] },
      { href: '/pedidos',    label: 'Pedidos / Ventas', icon: '📋', roles: ['master','admin','vendedor','bodega'] },
      { href: '/bodega',     label: 'Bodega',           icon: '📦', roles: ['master','admin','bodega'] },
      { href: '/produccion', label: 'Producción',       icon: '⚙️', roles: ['master','admin','operario','bodega'] },
      { href: '/formulas',   label: 'Fórmulas',         icon: '🧪', roles: ['master','admin'] },
      { href: '/reportes',   label: 'Reportes',         icon: '📈', roles: ['master','admin'] },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/config',       label: 'Configuración', icon: '⚙',  roles: ['master','admin'] },
      { href: '/admin-master', label: 'Admin Master',  icon: '👑', roles: ['master'] },
    ],
  },
]

interface AppLayoutProps {
  children: React.ReactNode
  title: string
  breadcrumb?: string
  action?: React.ReactNode
}

export default function AppLayout({ children, title, breadcrumb, action }: AppLayoutProps) {
  const { user, tenant, role, logout } = useAuth()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const userInitials = user?.nombre ? initials(user.nombre) : '??'
  const avatarGrad   = role ? (ROLE_AVATAR_GRADIENT[role] ?? 'from-slate-400 to-slate-600') : 'from-slate-400 to-slate-600'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {open && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-60 bg-slate-800 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.15)]',
        'transition-transform duration-200 md:relative md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="flex items-center gap-3 px-4 py-4 border-b border-white/[0.07] min-h-[64px]">
          <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 shadow-lg shadow-sky-500/30 bg-gradient-to-br from-sky-400 to-sky-700 flex items-center justify-center">
            {tenant?.logo_url
              ? <Image src={tenant.logo_url} alt="Logo" width={36} height={36} className="object-cover w-full h-full" />
              : <span className="text-lg">🏭</span>}
          </div>
          <div className="min-w-0">
            <p className="text-white font-extrabold text-[12.5px] leading-tight tracking-tight truncate">
              {tenant?.nombre_sistema ?? 'SISTEMA DE PRODUCCIÓN'}
            </p>
            <p className="text-sky-400 text-[9.5px] font-semibold truncate mt-0.5">
              {tenant?.nombre_empresa ?? '—'}
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_SECTIONS.map(section => {
            const visible = section.items.filter(item => role && (item.roles as string[]).includes(role))
            if (!visible.length) return null
            return (
              <div key={section.label}>
                <p className="px-4 pt-4 pb-1 font-mono text-[9px] tracking-[2px] text-slate-600 uppercase select-none">{section.label}</p>
                {visible.map(item => {
                  const active = pathname.startsWith(item.href)
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn(
                      'flex items-center gap-2.5 px-4 py-[9px] border-l-[3px] text-[13px] font-medium transition-all duration-150',
                      active ? 'bg-sky-400/10 border-sky-400 text-sky-400' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'
                    )}>
                      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-[14px] flex-shrink-0', active ? 'bg-sky-400/15' : 'bg-white/5')}>
                        {item.icon}
                      </span>
                      {item.label}
                      {item.href === '/admin-master' && (
                        <span className="ml-auto text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300">MASTER</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>

        <div className="flex items-center gap-2.5 px-4 py-3 border-t border-white/[0.07]">
          <div className={cn('w-8 h-8 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0', avatarGrad)}>
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">{user?.nombre}</p>
            <p className={cn('font-mono text-[9px] tracking-wide', role === 'master' ? 'text-amber-400' : 'text-sky-400')}>
              {role ? ROLE_LABELS[role as UserRole].toUpperCase() : ''}
            </p>
          </div>
          <button onClick={logout} title="Cerrar sesión" className="text-slate-500 hover:text-red-400 transition-colors text-base leading-none">⏻</button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-[58px] bg-white border-b border-slate-200 flex items-center px-5 gap-3 flex-shrink-0 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
          <button className="md:hidden text-slate-500 hover:text-slate-700 text-xl leading-none mr-1" onClick={() => setOpen(true)}>☰</button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-[16px] text-slate-800 tracking-tight truncate">{title}</h1>
            {breadcrumb && <p className="font-mono text-[9px] text-slate-400 tracking-[1px] mt-0.5 truncate">{breadcrumb}</p>}
          </div>
          {action && <div className="flex items-center gap-2 flex-shrink-0">{action}</div>}
        </header>
        <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">{children}</main>
      </div>
    </div>
  )
}
