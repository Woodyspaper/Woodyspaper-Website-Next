import { unclaim } from '@/server/customers'
import { json, route } from '@/server/http'
import { requireUser } from '@/server/sessions'

/** Undo the match between this website account and its customer account. */
export const POST = route(async () => {
  await unclaim(await requireUser())
  return json({ ok: true })
})
