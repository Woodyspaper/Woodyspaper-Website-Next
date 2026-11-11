import 'server-only'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

/*
 * Outgoing account email (confirmation, link and reset codes), sent through
 * the Microsoft 365 mailbox configured in .env.local:
 *
 *   SMTP_HOST=smtp.office365.com  SMTP_PORT=587  SMTP_USER=…  SMTP_PASS=…  MAIL_FROM=…
 *
 * In development with no SMTP_HOST, the message is printed to the server
 * console instead, so the flow can be tested without a mailbox. To send
 * another way (for example Microsoft Graph), replace the body of sendMail
 * and keep its signature.
 */
let transport: Transporter | undefined

export type Mail = { to: string; subject: string; text: string }

export async function sendMail({ to, subject, text }: Mail): Promise<void> {
  const host = process.env.SMTP_HOST
  if (!host) {
    if (process.env.NODE_ENV === 'production') throw new Error('Email is not configured: set SMTP_HOST.')
    console.log(`\n--- email (not sent: SMTP_HOST is not set) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`)
    return
  }
  transport ??= nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  })
}

const SIGN_OFF = "\n\nIf you didn't ask for this, you can ignore this email.\n\nWoody's Paper\n(754) 701-1797"

/** Sent after a password change made while signed in, so a change the owner didn't make gets noticed. */
export function passwordChangedEmail(): Omit<Mail, 'to'> {
  return {
    subject: "Your password was changed — Woody's Paper",
    text:
      'The password for your Woody’s Paper account was just changed.\n\n' +
      'If that was you, there is nothing more to do.\n\n' +
      'If it wasn’t, reset your password right away from the sign-in page ("Forgot your password?") ' +
      "and call us on (754) 701-1797.\n\nWoody's Paper",
  }
}

export function codeEmail(purpose: 'verify' | 'link' | 'reset', code: string, minutes: number): Omit<Mail, 'to'> {
  const lead = {
    verify: 'Use this code to confirm your email address for your Woody’s Paper account:',
    link: 'Use this code to link your Woody’s Paper store account to your website account:',
    reset: 'Use this code to reset the password for your Woody’s Paper account:',
  }[purpose]
  const subject = {
    verify: 'Confirm your email',
    link: 'Link your store account',
    reset: 'Reset your password',
  }[purpose]
  return {
    subject: `${subject} — Woody's Paper`,
    text: `${lead}\n\n    ${code}\n\nThe code expires in ${minutes} minutes.${SIGN_OFF}`,
  }
}
