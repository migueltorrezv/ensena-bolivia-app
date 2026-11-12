// Dentro de un marco (vista previa) el navegador puede bloquear las descargas
export function descargasBloqueadas() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export function guardarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function nombreArchivo(titulo, ext) {
  const base = titulo.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  const d = new Date()
  const dos = (n) => String(n).padStart(2, '0')
  return `${base || 'reporte'}-${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}.${ext}`
}

export async function exportarTabla(formato, titulo, columnas, filas) {
  const nombre = nombreArchivo(titulo, formato)
  const valor = (columna, fila) => (
    typeof columna.valor === 'function' ? columna.valor(fila) : fila[columna.valor]
  )

  if (formato === 'xlsx') {
    const { default: ExcelJS } = await import('exceljs')
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet('Reporte')
    hoja.addRow(columnas.map((columna) => columna.titulo))
    filas.forEach((fila) => hoja.addRow(columnas.map((columna) => valor(columna, fila) ?? null)))
    columnas.forEach((columna, indice) => {
      const excelColumna = hoja.getColumn(indice + 1)
      excelColumna.width = Math.min(Math.max(columna.titulo.length + 2, 12), 48)
      if (columna.pct) excelColumna.numFmt = '0.00%'
      else if (columna.numero) excelColumna.numFmt = '#,##0.00'
    })
    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D6A4F' } }
    const contenido = await libro.xlsx.writeBuffer()
    return {
      blob: new Blob([contenido], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      nombre,
    }
  }

  if (formato === 'pdf') {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])
    const pdf = new jsPDF({ orientation: columnas.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
    const ancho = pdf.internal.pageSize.getWidth()
    pdf.setFontSize(15)
    pdf.text(pdf.splitTextToSize(titulo, ancho - 80), 40, 36)
    autoTable(pdf, {
      startY: 52,
      head: [columnas.map((columna) => columna.titulo)],
      body: filas.map((fila) => columnas.map((columna) => {
        const dato = valor(columna, fila)
        if (dato === null || dato === undefined) return ''
        if (typeof dato !== 'number') return String(dato)
        return new Intl.NumberFormat('es-BO', {
          style: columna.pct ? 'percent' : 'decimal',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(dato)
      })),
      styles: { fontSize: columnas.length > 6 ? 6 : 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [45, 106, 79] },
      margin: { left: 32, right: 32 },
    })

    const paginas = pdf.getNumberOfPages()
    for (let pagina = 1; pagina <= paginas; pagina++) {
      pdf.setPage(pagina)
      pdf.setFontSize(8)
      pdf.text(`${pagina} / ${paginas}`, ancho - 40, pdf.internal.pageSize.getHeight() - 16, { align: 'right' })
    }
    return { blob: pdf.output('blob'), nombre }
  }

  throw new Error(`Formato de exportación no compatible: ${formato}`)
}
