// src/app/api/admin/create-user/route.ts
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    // ── 1. Leer token del header Authorization ──────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { message: 'No autenticado. Recarga la página e intenta de nuevo.' },
        { status: 401 }
      )
    }
    const accessToken = authHeader.replace('Bearer ', '').trim()

    // ── 2. Verificar token con Supabase ─────────────────────
    // Usamos service_role para verificar el token y hacer operaciones admin
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { message: 'Variable SUPABASE_SERVICE_ROLE_KEY no configurada. Agrégala en las variables de entorno de Render.' },
        { status: 500 }
      )
    }

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verificar que el token es válido y obtener el usuario
    const { data: { user: authUser }, error: tokenError } = await adminClient.auth.getUser(accessToken)
    if (tokenError || !authUser) {
      return NextResponse.json(
        { message: 'Token inválido o expirado. Recarga la página.' },
        { status: 401 }
      )
    }

    // ── 3. Verificar que sea master ──────────────────────────
    const { data: userProfile, error: profileErr } = await adminClient
      .from('users')
      .select('rol, tenant_id')
      .eq('id', authUser.id)
      .single()

    if (profileErr || !userProfile) {
      return NextResponse.json(
        { message: 'No se pudo verificar el perfil del usuario.' },
        { status: 401 }
      )
    }

    if (userProfile.rol !== 'master') {
      return NextResponse.json(
        { message: 'Solo el Admin Master puede crear usuarios.' },
        { status: 403 }
      )
    }

    // ── 4. Parsear y validar body ────────────────────────────
    const body = await req.json()
    const { nombre, email, password, rol } = body

    if (!nombre || !email || !password || !rol) {
      return NextResponse.json(
        { message: 'Faltan campos obligatorios: nombre, email, contraseña y rol.' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { message: 'La contraseña debe tener al menos 8 caracteres.' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { message: 'El email no tiene un formato válido.' },
        { status: 400 }
      )
    }

    // ── 5. Verificar licencias ───────────────────────────────
    const { count: activos } = await adminClient
      .from('users')
      .select('id', { count: 'exact' })
      .eq('tenant_id', userProfile.tenant_id)
      .eq('activo', true)

    const { data: tenant } = await adminClient
      .from('tenants')
      .select('licencias_total')
      .eq('id', userProfile.tenant_id)
      .single()

    if (tenant && (activos ?? 0) >= tenant.licencias_total) {
      return NextResponse.json(
        { message: `Límite de licencias alcanzado (${activos}/${tenant.licencias_total}). Contacta al proveedor para ampliar tu plan.` },
        { status: 400 }
      )
    }

    // ── 6. Crear usuario en auth.users ───────────────────────
    const { data: newAuthUser, error: authError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })

    if (authError || !newAuthUser.user) {
      const msg = authError?.message ?? 'Error al crear usuario'
      console.error('Auth admin createUser error:', authError)
      return NextResponse.json(
        {
          message: msg.includes('already registered')
            ? `El email ${email} ya está registrado en el sistema.`
            : 'Error al crear cuenta: ' + msg
        },
        { status: 500 }
      )
    }

    // ── 7. Crear perfil en tabla users ───────────────────────
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
      console.error('Profile insert error:', profileError)
      // Rollback: eliminar el usuario de auth
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