import Link from 'next/link'
import { Logo } from './Logo'

export function Footer() {
  return (
    <footer className="relative z-10 pb-10 pt-16 text-center text-white sm:text-left">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-12 grid gap-10 md:grid-cols-3">
          <div className="space-y-8">
            <Logo className="mx-auto h-20 sm:mx-0 sm:h-24" />
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-slate-600 sm:mx-0">
              South Florida&rsquo;s trusted wholesale supply partner for high-volume packaging and
              tissue products.
            </p>
            <Link href="/inventory" className="inline-block text-sm font-semibold text-brand-blue hover:text-brand-blue-dark">
              Inventory Hub
            </Link>
          </div>

          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-ultra text-brand-blue">Area Serviced</h3>
            <p className="text-sm leading-loose text-slate-700">Serving South Florida</p>
          </div>

          <div>
            <h3 className="mb-4 text-xs font-bold uppercase tracking-ultra text-brand-blue">Contact</h3>
            <a href="tel:7547011797" className="mb-2 block text-sm font-medium text-slate-700 transition-colors hover:text-brand-blue">
              (754) 701-1797
            </a>
            <a href="mailto:info@woodyspaper.com" className="block text-sm font-medium text-slate-700 transition-colors hover:text-brand-blue">
              info@woodyspaper.com
            </a>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-3xs font-bold uppercase tracking-mega text-black sm:flex-row">
          <p>&copy; {new Date().getFullYear()} Woody&rsquo;s Paper</p>
          <p className="italic tracking-tight text-black">Supply Chain Optimization</p>
        </div>
      </div>
    </footer>
  )
}
