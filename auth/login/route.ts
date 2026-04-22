// src/app/api/auth/login/route.ts
// Login en el servidor — escribe las cookies correctamente
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 })
    }

    const response = NextResponse.json({ ok: true })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            // Escribir cookies en la response — así el browser las recibe
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, {
                ...options,
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
              })
            })
          },
        },
      }
    )

    // 1. Autenticar con Supabase
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (authError || !data.user) {
      const msg = authError?.message ?? 'Error de autenticación'
      return NextResponse.json(
        { error: msg.includes('Invalid login credentials') ? 'Email o contraseña incorrectos' : msg },
        { status: 401 }
      )
    }

    // 2. Verificar que existe perfil en users
    const { data: perfil, error: perfilError } = await supabase
      .from('users')
      .select('id, rol, activo, tenant_id')
      .eq('id', data.user.id)
      .single()

    if (perfilError || !perfil) {
      await supabase.auth.signOut()
      return NextResponse.json(
        { error: 'No tienes perfil en el sistema. Contacta al administrador.' },
        { status: 403 }
      )
    }

    if (!perfil.activo) {
      await supabase.auth.signOut()
      return NextResponse.json(
        { error: 'Tu cuenta está desactivada. Contacta al administrador.' },
        { status: 403 }
      )
    }

    // 3. Retornar OK — las cookies ya están escritas en `response`
    return response

  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
