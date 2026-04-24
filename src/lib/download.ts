// src/lib/download.ts
// Utilidades de descarga de archivos — funciona en todos los navegadores

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 150)
}

// ── CSV con BOM para Excel ─────────────────────────────────────
function escapeCsv(val: unknown): string {
  const str = val === null || val === undefined ? '' : String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n'))
    return `"${str.replace(/"/g, '""')}"`
  return str
}

export function downloadCsv(headers: string[], rows: (string | number | null | undefined)[][], filename: string) {
  const lines = [headers.map(escapeCsv).join(',')]
  rows.forEach(row => lines.push(row.map(escapeCsv).join(',')))
  const bom = '\uFEFF'
  downloadFile(bom + lines.join('\n'), filename, 'text/csv;charset=utf-8;')
}

// ── HTML imprimible como PDF ───────────────────────────────────
export function downloadHtmlPdf(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  filename: string,
  extraNote?: string
) {
  const headerRow = headers.map(h => `<th>${h}</th>`).join('')
  const bodyRows  = rows.map(row =>
    `<tr>${row.map(cell => `<td>${cell ?? '—'}</td>`).join('')}</tr>`
  ).join('')

  const now = new Date().toLocaleDateString('es-EC', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
      @page { margin: 1.5cm; }
    }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; margin: 24px; color: #1e293b; }
    .header { border-bottom: 2px solid #0ea5e9; padding-bottom: 12px; margin-bottom: 16px; }
    .header h1 { font-size: 18px; margin: 0 0 4px 0; color: #0369a1; }
    .header p  { margin: 0; color: #64748b; font-size: 10px; }
    table  { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th     { background: #0ea5e9; color: #fff; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
    td     { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    tr:last-child td { border-bottom: 2px solid #0ea5e9; font-weight: bold; }
    .footer { margin-top: 16px; color: #94a3b8; font-size: 9px; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; }
    .btn-print { background: #0ea5e9; color: white; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-bottom: 16px; }
    .btn-print:hover { background: #0284c7; }
  </style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">🖨 Imprimir / Guardar como PDF</button>
  <div class="header">
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div>
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="footer">
    <span>Sistema de Producción · ${now}</span>
    <span>${extraNote ?? ''}</span>
  </div>
  <script>
    // Auto-abrir diálogo de impresión al cargar
    window.onload = function() {
      setTimeout(function() { window.print(); }, 500);
    };
  </script>
</body>
</html>`

  // Abrir en nueva pestaña para imprimir
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}