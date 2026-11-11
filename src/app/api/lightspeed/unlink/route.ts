import { json, route } from '@/server/http'
import { unlink } from '@/server/lightspeed'
import { requireUser } from '@/server/sessions'

export const POST = route(async () => {
  await unlink(await requireUser())
  return json({ ok: true })
})
