import { json, route } from '@/server/http'
import { endSession } from '@/server/sessions'

export const POST = route(async () => {
  await endSession()
  return json({ ok: true })
})
