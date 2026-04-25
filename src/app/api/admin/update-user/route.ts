// src/app/api/admin/update-user/route.ts
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

    const { data: userProfile } = await adminClient.from('users').select('rol').eq('id', authUser.id).single()
    if (userProfile?.rol !== 'master') {
      return NextResponse.json({ message: 'Solo el Admin Master puede actualizar usuarios' }, { status: 403 })
    }

    const { user_id, password } = await req.json()
    if (!user_id || !password) {
      return NextResponse.json({ message: 'user_id y password son requeridos' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ message: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 })
    }

    const { error } = await adminClient.auth.admin.updateUserById(user_id, { password })
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, message: 'Contraseña actualizada' })
  } catch (e: unknown) {
    return NextResponse.json({ message: e instanceof Error ? e.message : 'Error inesperado' }, { status: 500 })
  }
}