import { json, route } from '@/server/http'
import { usesStoreSso } from '@/server/lightspeed'
import { currentUser } from '@/server/sessions'

/** Who is signed in, for the header. `user` is null when nobody is. */
export const GET = route(async () => {
  const user = await currentUser()
  if (!user) return json({ user: null })
  return json({
    user: {
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      storeSso: await usesStoreSso(user),
    },
  })
})
