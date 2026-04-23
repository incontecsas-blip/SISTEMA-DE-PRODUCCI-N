// src/app/layout.tsx
import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/context/AuthContext'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Sistema de Producción',
  description: 'Gestión de producción, bodega y ventas',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${jakarta.variable} ${jetbrains.variable}`}>
      <body className="font-sans bg-slate-100 text-slate-800 antialiased">
        <AuthProvider>
          {children}
          {/* Toaster centrado arriba */}
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#fff',
                color: '#1e293b',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                fontFamily: 'var(--font-jakarta)',
                fontSize: '13px',
                padding: '12px 16px',
                maxWidth: '420px',
              },
              success: {
                iconTheme: { primary: '#10b981', secondary: '#fff' },
                style: { borderLeft: '3px solid #10b981' },
              },
              error: {
                iconTheme: { primary: '#ef4444', secondary: '#fff' },
                style: { borderLeft: '3px solid #ef4444' },
              },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  )
}
