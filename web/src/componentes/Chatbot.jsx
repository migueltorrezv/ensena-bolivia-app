import { useEffect, useRef, useState } from 'react'
import { Bot, MessageSquare, Send, X } from 'lucide-react'
import { preguntarGemini } from '../lib/geminiChat.js'
import { useSesion } from './Sesion.jsx'

export function Chatbot() {
  const { datos, gestion, moneda, criterio } = useSesion()
  const [abierto, setAbierto] = useState(false)
  const [entrada, setEntrada] = useState('')
  const [cargando, setCargando] = useState(false)
  const [mensajes, setMensajes] = useState([
    {
      rol: 'asistente',
      texto: 'Hola. Puedo analizar la ejecución presupuestaria, saldos por financiador, áreas o alertas de sobregiro. ¿Qué deseas consultar?',
    },
  ])
  const finRef = useRef(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, abierto])

  const enviar = async (e) => {
    e.preventDefault()
    const pregunta = entrada.trim()
    if (!pregunta || cargando) return

    const nuevosMensajes = [...mensajes, { rol: 'usuario', texto: pregunta }]
    setMensajes(nuevosMensajes)
    setEntrada('')
    setCargando(true)

    try {
      const historialApi = nuevosMensajes.slice(1)
      const respuesta = await preguntarGemini(historialApi, datos, { gestion, moneda, criterio })
      setMensajes([...nuevosMensajes, { rol: 'asistente', texto: respuesta }])
    } catch (err) {
      setMensajes([
        ...nuevosMensajes,
        { rol: 'asistente', texto: `No pude consultar los datos: ${err.message}` },
      ])
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed right-5 bottom-5 z-50">
      {abierto ? (
        <div className="flex h-[600px] max-h-[calc(100vh-6rem)] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-borde bg-superficie shadow-2xl">
          <div className="flex items-center justify-between bg-tinta px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-[#26A567]" />
              <div>
                <p className="text-sm font-semibold leading-tight">Asistente Financiero</p>
                <p className="text-[11px] text-white/70">Gestión {gestion} · {moneda}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-md p-1 text-white/75 hover:bg-white/10 hover:text-white"
              aria-label="Cerrar asistente"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-sm">
            {mensajes.map((m, idx) => (
              <div
                key={idx}
                className={`whitespace-pre-wrap rounded-lg px-3 py-2 leading-relaxed ${
                  m.rol === 'usuario'
                    ? 'ml-8 bg-tinta text-white'
                    : 'mr-6 border border-borde bg-fondo text-texto'
                }`}
              >
                {m.texto}
              </div>
            ))}
            {cargando && (
              <div className="mr-6 rounded-lg border border-borde bg-fondo px-3 py-2 text-xs text-texto-2">
                Consultando los datos del presupuesto...
              </div>
            )}
            <div ref={finRef} />
          </div>

          <form onSubmit={enviar} className="flex items-center gap-1.5 border-t border-borde bg-superficie p-2.5">
            <input
              type="text"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder="Ej. ¿Cómo va la ejecución por financiador?"
              className="flex-1 rounded-lg border border-borde bg-fondo px-3 py-2 text-sm focus:border-tinta focus:outline-none"
            />
            <button
              type="submit"
              disabled={cargando || !entrada.trim()}
              className="inline-flex size-9 items-center justify-center rounded-lg bg-tinta text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex h-16 items-center gap-3 rounded-full bg-tinta px-6 text-white shadow-lg transition-transform hover:scale-105"
          aria-label="Abrir asistente financiero"
          title="Asistente financiero"
        >
          <MessageSquare className="size-6" />
          <span className="text-base font-semibold">Asistente</span>
        </button>
      )}
    </div>
  )
}
