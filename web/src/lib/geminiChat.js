import { CONFIG } from '../config.js'

const MODELO = 'gemini-2.5-flash'

const HERRAMIENTAS = [
  {
    functionDeclarations: [
      {
        name: 'obtener_resumen_general',
        description: 'Obtiene el presupuesto total, monto ejecutado, saldo disponible y porcentaje de ejecución global.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'obtener_reporte_agrupado',
        description: 'Agrupa presupuesto y ejecución por una o más dimensiones.',
        parameters: {
          type: 'OBJECT',
          properties: {
            dimensiones: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Dimensiones válidas: "financiador", "region", "area", "rubro", "cuenta", "mes".',
            },
          },
          required: ['dimensiones'],
        },
      },
      {
        name: 'obtener_alertas',
        description: 'Lista las cuentas con ejecución alta (mayor al 80%), sobregiradas o con gasto sin presupuesto.',
        parameters: {
          type: 'OBJECT',
          properties: {
            umbral: { type: 'NUMBER', description: 'Porcentaje mínimo de alerta (por defecto 80).' },
          },
        },
      },
      {
        name: 'buscar_movimientos',
        description: 'Busca movimientos contables individuales por texto en la glosa o referencia.',
        parameters: {
          type: 'OBJECT',
          properties: {
            texto: { type: 'STRING', description: 'Palabra clave a buscar en la descripción del gasto.' },
          },
          required: ['texto'],
        },
      },
    ],
  },
]

async function ejecutarHerramienta(nombre, args, datos, contexto) {
  const { gestion, moneda, criterio } = contexto
  const filtrosBase = {
    gestiones: gestion ? [gestion] : [],
    incluir_anual: criterio === 'real',
  }

  if (nombre === 'obtener_resumen_general') {
    return await datos.rpc('resumen_general', { p_filtros: filtrosBase, p_moneda: moneda })
  }
  if (nombre === 'obtener_reporte_agrupado') {
    return await datos.rpc('reporte_json', {
      p_dimensiones: args.dimensiones || ['rubro'],
      p_filtros: filtrosBase,
      p_moneda: moneda,
    })
  }
  if (nombre === 'obtener_alertas') {
    return await datos.rpc('alertas_ejecucion', {
      p_filtros: filtrosBase,
      p_umbral: args.umbral || 80,
    })
  }
  if (nombre === 'buscar_movimientos') {
    return await datos.rpc('detalle_movimientos', {
      p_filtros: { ...filtrosBase, texto: args.texto || '' },
      p_limite: 15,
      p_desplazamiento: 0,
    })
  }
  return { error: 'Herramienta no reconocida' }
}

export async function preguntarGemini(historial, datos, contexto) {
  const apiKey = CONFIG.GEMINI_API_KEY || window.CONFIG?.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('Falta GEMINI_API_KEY en web/public/config.js. Configura una clave de Gemini para habilitar las respuestas.')
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${apiKey}`

  const instruccionSistema = {
    parts: [
      {
        text: `Eres el asistente financiero y presupuestario de ${CONFIG.ORGANIZACION || 'la organización'}.
Contexto actual seleccionado por el usuario en pantalla:
- Gestión (año): ${contexto.gestion}
- Moneda: ${contexto.moneda} (${contexto.moneda === 'BS' ? 'Bolivianos' : 'Dólares estadounidenses'})
- Criterio de presupuesto: ${contexto.criterio}

Reglas:
1. Usa SIEMPRE las herramientas disponibles para consultar los datos reales antes de responder cifras. Nunca inventes números.
2. Responde en español, de forma clara, ejecutiva y directa, formateando montos con separadores de miles y 2 decimales.`,
      },
    ],
  }

  const contents = historial.map((m) => ({
    role: m.rol === 'usuario' ? 'user' : 'model',
    parts: [{ text: m.texto }],
  }))

  // Bucle para resolver llamadas a herramientas (máximo 4 iteraciones)
  for (let i = 0; i < 4; i++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: instruccionSistema,
        contents,
        tools: HERRAMIENTAS,
      }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      throw new Error(err.error?.message || `Error HTTP ${resp.status}`)
    }

    const data = await resp.json()
    const candidato = data.candidates?.[0]?.content
    if (!candidato) throw new Error('Gemini no devolvió respuesta.')

    const llamadaFuncion = candidato.parts?.find((p) => p.functionCall)

    if (llamadaFuncion) {
      contents.push(candidato)
      const { name, args } = llamadaFuncion.functionCall
      const resultadoRpc = await ejecutarHerramienta(name, args || {}, datos, contexto)

      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name,
              response: { resultado: resultadoRpc },
            },
          },
        ],
      })
      continue
    }

    const textoFinal = candidato.parts?.map((p) => p.text).join('') || 'Sin respuesta.'
    return textoFinal
  }

  return 'No se pudo completar el análisis en los pasos permitidos.'
}