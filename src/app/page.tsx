// src/app/page.tsx
// La ruta raíz redirige según el estado de autenticación
// El middleware se encarga de la redirección, esto es solo un fallback

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/dashboard')
}
