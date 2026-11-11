import { sendCode } from '@/server/accounts'
import { json, route } from '@/server/http'
import { requireUser } from '@/server/sessions'

/** Email a fresh confirmation code to the signed-in account. */
export const POST = route(async () => {
  const user = await requireUser()
  if (!user.emailVerified) await sendCode(user.id, 'verify', user.email)
  return json({ ok: true })
})
