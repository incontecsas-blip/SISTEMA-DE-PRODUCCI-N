// src/app/api/admin/create-user/route.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()

    // 1. Verificar que el usuario actual sea master
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cs: { name: string; value: string; options?: CookieOptions }[]) =>
            cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
        },
      }
    )

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ message: 'No autenticado. Recarga la página e intenta de nuevo.' }, { status: 401 })
    }

    const { data: userProfile, error: profileErr } = await supabase
      .from('users')
      .select('rol, tenant_id')
      .eq('id', authUser.id)
      .single()

    if (profileErr || !userProfile) {
      return NextResponse.json({ message: 'No se pudo verificar el perfil del usuario.' }, { status: 401 })
    }

    if (userProfile.rol !== 'master') {
      return NextResponse.json({ message: 'Solo el Admin Master puede crear usuarios.' }, { status: 403 })
    }

    // 2. Parsear body
    const body = await req.json()
    const { nombre, email, password, rol } = body

    if (!nombre || !email || !password || !rol) {
      return NextResponse.json({ message: 'Faltan campos: nombre, email, password y rol son obligatorios.' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ message: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 })
    }

    // 3. Verificar licencias
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
        { message: `Límite de licencias alcanzado (${activos}/${tenant.licencias_total}).` },
        { status: 400 }
      )
    }

    // 4. Verificar que SUPABASE_SERVICE_ROLE_KEY existe
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { message: 'Variable SUPABASE_SERVICE_ROLE_KEY no configurada en el servidor. Agrégala en las variables de entorno de Render.' },
        { status: 500 }
      )
    }

    // 5. Crear usuario en auth.users con service_role
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: newAuthUser, error: authError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })

    if (authError || !newAuthUser.user) {
      const msg = authError?.message ?? 'Error al crear usuario en Auth'
      console.error('Auth create error:', authError)
      return NextResponse.json(
        { message: msg.includes('already registered') ? 'Este email ya está registrado en el sistema.' : msg },
        { status: 500 }
      )
    }

    // 6. Crear perfil en tabla users
    const { error: profileError } = await adminClient
      .from('users')
      .insert({
        id: newAuthUser.user.id,
        tenant_id: userProfile.tenant_id,
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        rol,
        activo: true,
        created_by: authUser.id,
      })

    if (profileError) {
      console.error('Profile create error:', profileError)
      // Rollback auth user
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id)
      return NextResponse.json(
        { message: 'Error al crear perfil: ' + profileError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Usuario creado exitosamente',
      user_id: newAuthUser.user.id,
    })

  } catch (e: unknown) {
    console.error('create-user unexpected error:', e)
    return NextResponse.json(
      { message: e instanceof Error ? e.message : 'Error inesperado en el servidor' },
      { status: 500 }
    )
  }
}