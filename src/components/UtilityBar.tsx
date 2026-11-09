export function UtilityBar() {
  return (
    <div className="fixed inset-x-0 top-0 z-60 h-utility bg-brand-blue text-white">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 text-3xs sm:text-xs">
        <div className="flex items-center gap-4 sm:gap-6">
          <a href="tel:7547011797" className="flex items-center gap-1.5 rounded-full font-bold transition-colors hover:text-brand-sky focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-sky">
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5" aria-hidden="true">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
            (754) 701-1797
          </a>
          <a href="mailto:info@woodyspaper.com" className="flex items-center gap-1.5 rounded-full font-medium transition-colors hover:text-brand-sky focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-sky">
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5" aria-hidden="true">
              <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
              <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
            </svg>
            <span className="hidden sm:inline">info@woodyspaper.com</span>
            <span className="sm:hidden">Email us</span>
          </a>
        </div>
        <p className="hidden font-bold uppercase tracking-ultra md:block">
          Wholesale to Retail | South Florida
        </p>
      </div>
    </div>
  )
}
