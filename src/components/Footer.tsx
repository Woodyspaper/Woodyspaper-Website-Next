'use client' // services/account (ACCOUNT_PAGE) is browser-only code

import Link from 'next/link'
import { ACCOUNT_PAGE } from '@/services/account'
import { Logo } from './Logo'

const headingClasses = 'mb-3 text-xs font-bold uppercase tracking-ultra text-brand-blue'
const linkClasses = 'text-sm font-medium text-slate-700 transition-colors hover:text-brand-blue'

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-slate-200 bg-white/70">
      <div className="mx-auto max-w-7xl px-4">
        {/* Phones: the brand on top, then Shop and Contact side by side. Desktop: three columns. */}
        <div className="grid grid-cols-[2fr_3fr] gap-x-6 gap-y-8 py-8 lg:grid-cols-[1.5fr_1fr_1fr]">
          <div className="col-span-2 lg:col-span-1">
            <Logo className="h-14" />
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">
              South Florida&rsquo;s wholesale supply partner for packaging, paper and tissue products.
            </p>
          </div>

          <nav aria-label="Footer">
            <h3 className={headingClasses}>Shop</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/inventory" className={linkClasses}>
                  Inventory
                </Link>
              </li>
              <li>
                <Link href={ACCOUNT_PAGE} className={linkClasses}>
                  My account
                </Link>
              </li>
              <li>
                <Link href="/#about" className={linkClasses}>
                  About us
                </Link>
              </li>
              <li>
                <Link href="/#contact" className={linkClasses}>
                  Supply inquiry
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <h3 className={headingClasses}>Contact</h3>
            <ul className="space-y-2">
              <li>
                <a href="tel:7547011797" className={linkClasses}>
                  (754) 701-1797
                </a>
              </li>
              <li>
                <a href="mailto:info@woodyspaper.com" className={`${linkClasses} wrap-anywhere`}>
                  info@woodyspaper.com
                </a>
              </li>
              <li className="text-sm text-slate-600">Serving South Florida</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-1 border-t border-slate-200 py-4 text-xs text-slate-500 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} Woody&rsquo;s Paper</p>
          <ul className="flex items-center gap-5">
            <li>
              <Link href="/privacy" className="transition-colors hover:text-brand-blue">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/privacy#cookies" className="transition-colors hover:text-brand-blue">
                Cookies
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
