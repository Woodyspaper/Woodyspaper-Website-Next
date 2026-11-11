import { changePassword } from '@/server/accounts'
import { json, need, readBody, route } from '@/server/http'
import { requireUser } from '@/server/sessions'
import { checkPassword } from '@/server/validation'

/** Change the signed-in account's password. Needs the current one. */
export const POST = route(async (request) => {
  const user = await requireUser()
  const body = await readBody(request)
  const current = typeof body.currentPassword === 'string' ? body.currentPassword.slice(0, 1000) : ''
  const next = need(checkPassword(body.newPassword))
  await changePassword(user, current, next)
  return json({ ok: true })
})
