// src/app/api/admin/delete-user/route.ts
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'No autenticado' }, { status: 401 })
    }
    const accessToken = authHeader.replace('Bearer ', '').trim()

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ message: 'SUPABASE_SERVICE_ROLE_KEY no configurada' }, { status: 500 })
    }

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verificar que sea master
    const { data: { user: authUser }, error: tokenError } = await adminClient.auth.getUser(accessToken)
    if (tokenError || !authUser) {
      return NextResponse.json({ message: 'Token inválido' }, { status: 401 })
    }

    const { data: userProfile } = await adminClient.from('users').select('rol, tenant_id').eq('id', authUser.id).single()
    if (userProfile?.rol !== 'master') {
      return NextResponse.json({ message: 'Solo el Admin Master puede eliminar usuarios' }, { status: 403 })
    }

    const { user_id } = await req.json()
    if (!user_id) return NextResponse.json({ message: 'user_id requerido' }, { status: 400 })

    // No eliminar al mismo master
    if (user_id === authUser.id) {
      return NextResponse.json({ message: 'No puedes eliminarte a ti mismo' }, { status: 400 })
    }

    // Verificar que el usuario a eliminar pertenece al mismo tenant
    const { data: targetUser } = await adminClient.from('users').select('rol, tenant_id, nombre').eq('id', user_id).single()
    if (!targetUser) return NextResponse.json({ message: 'Usuario no encontrado' }, { status: 404 })
    if (targetUser.tenant_id !== userProfile.tenant_id) {
      return NextResponse.json({ message: 'No puedes eliminar usuarios de otro tenant' }, { status: 403 })
    }
    if (targetUser.rol === 'master') {
      return NextResponse.json({ message: 'No se puede eliminar al Admin Master' }, { status: 400 })
    }

    // 1. Marcar inactivo en tabla users (preserva historial de pedidos/OPs)
    await adminClient.from('users').update({ activo: false }).eq('id', user_id)

    // 2. Eliminar de auth.users (no podrá iniciar sesión)
    const { error } = await adminClient.auth.admin.deleteUser(user_id)
    if (error) {
      return NextResponse.json({ message: 'Error al eliminar: ' + error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: `Usuario ${targetUser.nombre} eliminado` })
  } catch (e: unknown) {
    return NextResponse.json({ message: e instanceof Error ? e.message : 'Error inesperado' }, { status: 500 })
  }
}