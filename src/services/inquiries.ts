export type Inquiry = {
  company: string
  email: string
  details: string
  /** Honeypot. Real visitors leave this empty; filled values are dropped. */
  honey?: string
}

export const INQUIRY_ADDRESS = 'admin@woodyspaper.com'

/**
 * FormSubmit's alias for the activated inbox. The activation email says to use
 * this in place of the address; posting to the address itself stays unactivated.
 */
const FORMSUBMIT_ID = 'b1f962fd7efd22af2b3b0d6e8eba1e85'

type FormSubmitResponse = {
  success?: boolean | string
  message?: string
}

/** Subject headers must stay on one line. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

/** Fallback link if the automatic send cannot be completed. */
export function buildInquiryMailto(inquiry: Inquiry): string {
  const company = oneLine(inquiry.company) || 'Website visitor'
  const subject = `Supply inquiry — ${company}`

  const body = [
    `Business: ${company}`,
    `Contact email: ${oneLine(inquiry.email)}`,
    '',
    'Product list / requirements:',
    inquiry.details.trim() || '(none provided)',
    '',
    '— Sent from woodyspaper.com',
  ].join('\n')

  return `mailto:${INQUIRY_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/**
 * Emails the inquiry to info@woodyspaper.com. Resolves when the message is
 * accepted for delivery; rejects when it is not.
 */
export async function submitInquiry(inquiry: Inquiry): Promise<void> {
  if (inquiry.honey?.trim()) return

  const company = oneLine(inquiry.company) || 'Website visitor'
  const email = oneLine(inquiry.email)
  const details = inquiry.details.trim()

  if (!email || !details) {
    throw new Error('Add a contact email and a product list before sending.')
  }

  let response: Response
  try {
    response = await fetch(`https://formsubmit.co/ajax/${FORMSUBMIT_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        _subject: `Supply inquiry — ${company}`,
        _template: 'table',
        _captcha: 'false',
        _replyto: email,
        _honey: '',
        Business: company,
        Email: email,
        'Product list / requirements': details,
      }),
    })
  } catch {
    throw new Error('We could not reach the mail service. Check your connection and try again.')
  }

  const data = (await response.json().catch(() => null)) as FormSubmitResponse | null
  const accepted = response.ok && (data?.success === true || data?.success === 'true')

  if (accepted) return

  const message = data?.message ?? ''
  if (/activation/i.test(message)) {
    throw new Error(
      'This mailbox needs a one-time confirmation. Open the activation email sent to admin@woodyspaper.com, then submit the inquiry again.',
    )
  }

  throw new Error(message || 'The inquiry could not be emailed. Try again in a moment.')
}
