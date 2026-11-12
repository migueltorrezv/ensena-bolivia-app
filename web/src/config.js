const c = (typeof window !== 'undefined' && window.CONFIG) || {}

export const CONFIG = {
  MODO: String(c.MODO || 'demo').toLowerCase(),
  SUPABASE_URL: (c.SUPABASE_URL || '').trim().replace(/\/$/, ''),
  SUPABASE_KEY: (c.SUPABASE_KEY || '').trim(),
  API_URL: (c.API_URL || '').trim().replace(/\/$/, ''),
  ORGANIZACION: (c.ORGANIZACION || '').trim(),
}
