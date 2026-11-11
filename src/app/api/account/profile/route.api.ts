import { changeName } from '@/server/accounts'
import { json, need, readBody, route } from '@/server/http'
import { requireUser } from '@/server/sessions'
import { checkName } from '@/server/validation'

/** Change the name on the signed-in account. */
export const POST = route(async (request) => {
  const user = await requireUser()
  const name = need(checkName((await readBody(request)).name))
  await changeName(user.id, name)
  return json({ ok: true, name })
})
