import { CONFIG } from '../config.js'

const MAX_RESULTADO = 6000
const MAX_HISTORIAL = 10

const HERRAMIENTAS = [
  {
    type: 'function',
    function: {
      name: 'obtener_resumen_general',
      description: 'Obtiene el presupuesto total, monto ejecutado, saldo disponible y porcentaje de ejecución global.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtener_reporte_agrupado',
      description: 'Agrupa presupuesto y ejecución por una o más dimensiones.',
      parameters: {
        type: 'object',
        properties: {
          dimensiones: {
            type: 'array',
            items: { type: 'string', enum: ['financiador', 'region', 'area', 'rubro', 'cuenta', 'mes'] },
            description: 'Dimensiones de agrupación.',
          },
        },
        required: ['dimensiones'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtener_alertas',
      description: 'Lista las cuentas con ejecución alta (mayor al umbral), sobregiradas o con gasto sin presupuesto.',
      parameters: {
        type: 'object',
        properties: { umbral: { type: 'number', description: 'Porcentaje mínimo de alerta (por defecto 80).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_movimientos',
      description: 'Busca movimientos contables individuales por texto en la glosa o referencia.',
      parameters: {
        type: 'object',
        properties: { texto: { type: 'string', description: 'Palabra clave a buscar.' } },
        required: ['texto'],
      },
    },
  },
]

async function ejecutarHerramienta(nombre, args, datos, contexto) {
  const { gestion, moneda, criterio } = contexto
  const filtrosBase = { gestiones: gestion ? [gestion] : [], incluir_anual: criterio === 'real' }

  if (nombre === 'obtener_resumen_general') {
    return datos.rpc('resumen_general', { p_filtros: filtrosBase, p_moneda: moneda })
  }
  if (nombre === 'obtener_reporte_agrupado') {
    return datos.rpc('reporte_json', { p_dimensiones: args.dimensiones || ['rubro'], p_filtros: filtrosBase, p_moneda: moneda })
  }
  if (nombre === 'obtener_alertas') {
    const umbral = Number(args.umbral) || 80
    return datos.rpc('alertas_ejecucion', { p_filtros: filtrosBase, p_umbral: umbral > 1 ? umbral / 100 : umbral })
  }
  if (nombre === 'buscar_movimientos') {
    return datos.rpc('detalle_movimientos', {
      p_filtros: { ...filtrosBase, texto: args.texto || '' }, p_limite: 15, p_desplazamiento: 0,
    })
  }
  return { error: 'Herramienta no reconocida' }
}

function recortar(valor) {
  const texto = JSON.stringify(valor ?? null)
  return texto.length > MAX_RESULTADO ? texto.slice(0, MAX_RESULTADO) + '… (resultado recortado)' : texto
}

export async function preguntarGemini(historial, datos, contexto) {
  if (!datos.chatIA) {
    throw new Error('El asistente necesita la API (modo supabase o api con API_URL configurada).')
  }

  const sistema = {
    role: 'system',
    content: `Eres el asistente financiero y presupuestario de ${CONFIG.ORGANIZACION || 'la organización'}.
Contexto seleccionado en pantalla:
- Gestión (año): ${contexto.gestion}
- Moneda: ${contexto.moneda} (${contexto.moneda === 'BS' ? 'Bolivianos' : 'Dólares estadounidenses'})
- Criterio de presupuesto: ${contexto.criterio}

Reglas:
1. Usa SIEMPRE las herramientas para consultar los datos reales antes de dar cifras. Nunca inventes números.
2. Responde en español, claro y directo, con montos con separador de miles y 2 decimales.`,
  }

  const mensajes = [
    sistema,
    ...historial.slice(-MAX_HISTORIAL).map((m) => ({
      role: m.rol === 'usuario' ? 'user' : 'assistant',
      content: m.texto,
    })),
  ]

  for (let i = 0; i < 4; i++) {
    const data = await datos.chatIA({ messages: mensajes, tools: HERRAMIENTAS })
    const msg = data.choices?.[0]?.message
    if (!msg) throw new Error('El asistente no devolvió respuesta.')

    if (msg.tool_calls?.length) {
      mensajes.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
      for (const llamada of msg.tool_calls) {
        let args = {}
        try { args = JSON.parse(llamada.function.arguments || '{}') } catch { /* argumentos vacíos */ }
        let resultado
        try {
          resultado = await ejecutarHerramienta(llamada.function.name, args, datos, contexto)
        } catch (e) {
          resultado = { error: e.message }
        }
        mensajes.push({ role: 'tool', tool_call_id: llamada.id, content: recortar(resultado) })
      }
      continue
    }
    return msg.content || 'Sin respuesta.'
  }
  return 'No se pudo completar el análisis en los pasos permitidos.'
}
