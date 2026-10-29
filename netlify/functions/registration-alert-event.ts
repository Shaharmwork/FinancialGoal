import { runRegistrationAlert } from '../../server/run-registration-alert'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const response = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })

export default async (request: Request) => {
  if (request.method !== 'POST') return response(405)
  if (!request.headers.get('content-type')?.startsWith('application/json')) return response(415)
  // Bound the body even when Content-Length is absent or incorrect.
  const reader = request.body?.getReader()
  if (!reader) return response(400)
  let raw = ''
  let size = 0
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1024) { await reader.cancel(); return response(413) }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
    const event = JSON.parse(raw)
    if (!event || typeof event.id !== 'string' || typeof event.token !== 'string'
      || !uuid.test(event.id) || !uuid.test(event.token)) return response(400)
    // The service-only RPC validates and consumes the event's one-time token.
    // Request data can never select an email recipient or message body.
    try {
      await runRegistrationAlert({ id: event.id, token: event.token })
    } catch {
      console.error('Immediate registration alert failed; inspect queue and scheduled fallback')
      return response(503)
    }
    // Same response for spent/invalid tokens; no account information is exposed.
    return response(202)
  } catch {
    return response(400)
  } finally {
    reader.releaseLock()
  }
}
