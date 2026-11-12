import { useState } from 'react'
import { LogIn, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function Login({ datos, onEntrar }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      onEntrar(await datos.entrar(email, password))
    } catch (err) {
      setError(err.message || 'Error de conexión. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gradient-to-br from-[#D8F3DC] via-[#B7E4C7] to-[#95D5B2]">
      {/* Patrón de fondo decorativo */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-0 w-96 h-96 bg-[#2D6A4F] rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#40916C] rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-[#52B788] rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
      </div>

      {/* Card de Login */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 border border-[#B7E4C7]/50">
          {/* Logo y Título */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#2D6A4F] to-[#40916C] rounded-2xl mb-4 shadow-lg">
              <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-[#1B4332] mb-2">
              Enseña por Bolivia
            </h1>
            <p className="text-[#5B6770] text-sm">
              Sistema de Control Presupuestario y Ejecución Financiera
            </p>
          </div>

          {/* Mensaje de Bienvenida */}
          <div className="bg-gradient-to-r from-[#D8F3DC] to-[#B7E4C7] rounded-xl p-4 mb-6 border border-[#95D5B2]">
            <p className="text-[#1B4332] text-sm font-medium text-center">
              👋 ¡Bienvenido! Ingresa tus credenciales para acceder al sistema
            </p>
          </div>

          {/* Formulario */}
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Campo Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-[#1B4332] mb-2">
                Correo electrónico
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-[#74C69D]" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border-2 border-[#B7E4C7] rounded-xl focus:outline-none focus:border-[#2D6A4F] focus:ring-2 focus:ring-[#52B788]/20 transition-all bg-white/80 text-[#1F2937] placeholder-[#7D8896]"
                  placeholder="tu@correo.com"
                  required
                />
              </div>
            </div>

            {/* Campo Contraseña */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-[#1B4332] mb-2">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-[#74C69D]" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 border-2 border-[#B7E4C7] rounded-xl focus:outline-none focus:border-[#2D6A4F] focus:ring-2 focus:ring-[#52B788]/20 transition-all bg-white/80 text-[#1F2937] placeholder-[#7D8896]"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#74C69D] hover:text-[#2D6A4F] transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Botón de Login */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#2D6A4F] to-[#40916C] hover:from-[#1B4332] hover:to-[#2D6A4F] text-white font-bold py-3.5 px-4 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Ingresando...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  <span>Iniciar Sesión</span>
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-[#D8F3DC]">
            <p className="text-center text-xs text-[#7D8896]">
              ¿Problemas para ingresar? Contacta al administrador del sistema
            </p>
            <div className="flex items-center justify-center gap-1 mt-3">
              <div className="w-2 h-2 bg-[#52B788] rounded-full animate-pulse"></div>
              <span className="text-xs text-[#5B6770]">Sistema en línea</span>
            </div>
          </div>
        </div>

        {/* Información adicional */}
        <div className="mt-6 text-center">
          <p className="text-sm text-[#1B4332]/70 font-medium">
            Control Presupuestario v1.0
          </p>
          <p className="text-xs text-[#5B6770] mt-1">
            © 2026 Enseña por Bolivia. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </div>
  )
}