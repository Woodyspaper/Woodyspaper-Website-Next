/* Input checks shared by the account API routes. Each returns a clean value or an error message. */

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200
export const NAME_MAX = 100
export const EMAIL_MAX = 254

type Checked = { ok: true; value: string } | { ok: false; error: string }

/** Emails are stored and compared in lower case. */
export function checkEmail(input: unknown): Checked {
  if (typeof input !== 'string') return { ok: false, error: 'Enter your email address.' }
  const value = input.trim().toLowerCase()
  // Deliberately loose: something@something.tld. The emailed code is the real test.
  if (!value || value.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }
  return { ok: true, value }
}

export function checkName(input: unknown): Checked {
  if (typeof input !== 'string') return { ok: false, error: 'Enter your name.' }
  const value = input.trim().replace(/\s+/g, ' ')
  if (!value) return { ok: false, error: 'Enter your name.' }
  if (value.length > NAME_MAX) return { ok: false, error: `Name must be ${NAME_MAX} characters or fewer.` }
  return { ok: true, value }
}

/** Not trimmed: spaces are allowed in passwords. */
export function checkPassword(input: unknown): Checked {
  if (typeof input !== 'string' || input.length < PASSWORD_MIN) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN} characters.` }
  }
  if (input.length > PASSWORD_MAX) {
    return { ok: false, error: `Password must be ${PASSWORD_MAX} characters or fewer.` }
  }
  return { ok: true, value: input }
}

export function checkCode(input: unknown): Checked {
  const value = typeof input === 'string' ? input.replace(/\s+/g, '') : ''
  if (!/^\d{6}$/.test(value)) return { ok: false, error: 'Enter the 6-digit code from the email.' }
  return { ok: true, value }
}
