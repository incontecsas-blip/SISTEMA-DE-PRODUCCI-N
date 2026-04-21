// src/app/api/admin/create-user/route.ts
// Route Handler para crear usuarios desde Admin Master
// Usa service_role para bypassear RLS en auth.users
// SOLO accesible para usuarios con rol = 'master'

import { createServerClient } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const cookieStore = await cookies()

  // 1. Verificar que el usuario actual sea master
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cs: any) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  )

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) {
    return NextResponse.json({ message: 'No autenticado' }, { status: 401 })
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('rol, tenant_id')
    .eq('id', authUser.id)
    .single()

  if (!userProfile || userProfile.rol !== 'master') {
    return NextResponse.json(
      { message: 'Solo el Admin Master puede crear usuarios' },
      { status: 403 }
    )
  }

  // 2. Parsear el body
  const { nombre, email, password, rol, tenant_id } = await req.json()

  if (!nombre || !email || !password || !rol) {
    return NextResponse.json({ message: 'Faltan campos requeridos' }, { status: 400 })
  }

  // 3. Verificar licencias disponibles
  const { count: activos } = await supabase
    .from('users')
    .select('id', { count: 'exact' })
    .eq('tenant_id', userProfile.tenant_id)
    .eq('activo', true)

  const { data: tenant } = await supabase
    .from('tenants')
    .select('licencias_total')
    .eq('id', userProfile.tenant_id)
    .single()

  if (tenant && (activos ?? 0) >= tenant.licencias_total) {
    return NextResponse.json(
      { message: `Límite de licencias alcanzado (${activos}/${tenant.licencias_total})` },
      { status: 400 }
    )
  }

  // 4. Crear usuario en auth.users con service_role (bypassa restricciones de RLS)
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: newAuthUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,  // confirmar email automáticamente
  })

  if (authError || !newAuthUser.user) {
    return NextResponse.json(
      { message: authError?.message ?? 'Error al crear usuario en Auth' },
      { status: 500 }
    )
  }

  // 5. Crear perfil en tabla users
  const { error: profileError } = await adminClient
    .from('users')
    .insert({
      id: newAuthUser.user.id,
      tenant_id: userProfile.tenant_id,
      nombre,
      email,
      rol,
      activo: true,
      created_by: authUser.id,
    })

  if (profileError) {
    // Rollback: eliminar el usuario de auth si falla la creación del perfil
    await adminClient.auth.admin.deleteUser(newAuthUser.user.id)
    return NextResponse.json(
      { message: profileError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    message: 'Usuario creado exitosamente',
    user_id: newAuthUser.user.id,
  })
}
