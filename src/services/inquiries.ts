export type Inquiry = {
  company: string
  email: string
  details: string
  /** Honeypot. Real visitors leave this empty; filled values are dropped. */
  honey?: string
  /** When the visitor started on the form (ms), for the too-fast check. */
  startedAt?: number
}

/*
 * Spam protection (all checks happen in the visitor's browser, so a bot that
 * posts straight to FormSubmit skips them; they stop bots and spammers that use
 * the form itself):
 * - honeypot: a hidden field people never fill;
 * - too fast: people can't write an inquiry within MIN_FILL_MS of opening the page;
 * - spam phrases: messages containing any of SPAM_PHRASES are dropped, here
 *   (ignoring case) and by FormSubmit via `_blacklist`.
 * Dropped messages look "sent" to the sender, so bots learn nothing.
 */

/** Phrases that never appear in a real supply inquiry. FormSubmit allows ~20. */
export const SPAM_PHRASES = [
  'casino',
  'viagra',
  'cialis',
  'porn',
  'escort',
  'bitcoin',
  'crypto',
  'forex',
  'betting',
  'backlink',
  'guest post',
  'seo service',
  'seo expert',
  'rank your website',
  'first page of google',
  'web design service',
  'make money',
  'adult dating',
  'loan offer',
]

/** Fastest a person could plausibly fill in and send the form. */
const MIN_FILL_MS = 3_000

function containsSpamPhrase(inquiry: Inquiry): boolean {
  const text = `${inquiry.company} ${inquiry.email} ${inquiry.details}`.toLowerCase()
  return SPAM_PHRASES.some((phrase) => text.includes(phrase))
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

/** How long to wait for the mail service before telling the visitor it failed. */
const SEND_TIMEOUT_MS = 15_000

/**
 * Emails the inquiry through FormSubmit to the inbox behind FORMSUBMIT_ID
 * (activated for INQUIRY_ADDRESS). Resolves when the message is accepted for
 * delivery; rejects when it is not, or after SEND_TIMEOUT_MS.
 */
export async function submitInquiry(inquiry: Inquiry): Promise<void> {
  // Bot or spam: pretend it was sent (see "Spam protection" above).
  if (inquiry.honey?.trim() || containsSpamPhrase(inquiry)) return

  // Too fast to be a person. Say so rather than fake success, in case it is one.
  if (inquiry.startedAt && Date.now() - inquiry.startedAt < MIN_FILL_MS) {
    throw new Error('That was very quick. Please check your details and press Send Inquiry again.')
  }

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
      // A hung connection would otherwise leave the button on "Sending…" forever.
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        _subject: `Supply inquiry — ${company}`,
        _template: 'table',
        _captcha: 'false',
        _replyto: email,
        _blacklist: SPAM_PHRASES.join(', '),
        Business: company,
        Email: email,
        'Product list / requirements': details,
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('The mail service took too long to answer. Try again in a moment.')
    }
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
