type DriftingBox = {
  /** Placement is data, not design — kept as inline style rather than a class. */
  top: string
  left: string
  size: number
  duration: string
  strokeWidth: number
  visibility: string
}

const boxes: DriftingBox[] = [
  { top: '10%', left: '5%', size: 120, duration: '10s', strokeWidth: 0.5, visibility: 'hidden lg:block' },
  { top: '70%', left: '80%', size: 80, duration: '8s', strokeWidth: 0.5, visibility: 'hidden lg:block' },
  { top: '35%', left: '78%', size: 100, duration: '14s', strokeWidth: 0.3, visibility: 'hidden md:block' },
]

/** Soft blue wash plus slowly drifting carton outlines behind the page. */
export function BackgroundDecor() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute -left-50 -top-50 size-150 rounded-full bg-sky-400/10 blur-wash-lg" />
      <div className="absolute -bottom-25 -right-25 size-125 rounded-full bg-brand-blue/5 blur-wash" />

      {boxes.map((box) => (
        <div
          key={`${box.top}-${box.left}`}
          className={`absolute animate-float text-brand-blue opacity-10 ${box.visibility}`}
          style={{ top: box.top, left: box.left, animationDuration: box.duration }}
        >
          <svg width={box.size} height={box.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={box.strokeWidth}>
            <path d="M21 8l-9-4-9 4 9 4 9-4zM3 8v8l9 4 9-4V8M12 12v8" />
          </svg>
        </div>
      ))}
    </div>
  )
}
