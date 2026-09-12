import { Card, Pill, LockIcon } from './ui'

// Number-free teasers for the locked tabs. No pricing, no upsell button, no
// performance claims: the sample components are shape only.
const COPY = {
  picks: {
    title: 'Picks',
    body: 'A curated model book: the setups we would actually put on from each scan, kept small and updated as scans come in. Each pick carries its legs, credit, probability, and collateral, the same way a screener row does.',
  },
  performance: {
    title: 'Performance',
    body: 'The model book’s return set beside SPY on one chart, updated as trades settle at expiration. What happened, not what might.',
  },
}

export default function LockedTeaser({ tab }) {
  const c = COPY[tab]
  if (!c) return null
  return (
    <div className="pt-8 max-w-[52rem]">
      <div className="flex items-center gap-3 mb-3">
        <h1 className="font-display font-bold text-[2rem] leading-[1.05] tracking-[-0.02em] text-lc-ink">{c.title}</h1>
        <Pill tone="quiet"><LockIcon /> Paid · not available yet</Pill>
      </div>
      <p className="text-[1.05rem] leading-[1.6] text-lc-ink-2 max-w-[62ch] mb-6">{c.body}</p>
      <Card className="max-w-[40rem]" aria-hidden="true">
        {tab === 'picks' ? <PicksSample /> : <PerformanceSample />}
      </Card>
    </div>
  )
}

function PicksSample() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1].map(i => (
        <div key={i} className="flex items-center gap-3 bg-lc-ground rounded-lc-half px-4 h-12">
          <span className="w-9 h-2 rounded-full bg-lc-bar-deep" />
          <span className="flex-1 h-2 rounded-full bg-lc-line" />
          <span className="w-14 h-2 rounded-full bg-lc-bar-deep" />
          <Pill tone="violet" size="sm">pick</Pill>
        </div>
      ))}
    </div>
  )
}

function PerformanceSample() {
  // Two curves that cross and end level: no ordering between the book and SPY.
  return (
    <div className="bg-lc-ground rounded-lc-half p-4">
      <svg viewBox="0 0 400 120" className="w-full h-auto block" fill="none">
        <path d="M12 80 C80 92, 140 60, 200 70 S320 50, 388 58" stroke="#6547E6" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M12 66 C80 60, 140 80, 200 62 S320 66, 388 58" stroke="#D9D2E3" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 7" />
      </svg>
      <div className="flex justify-between mt-2">
        <Pill tone="violet" size="sm">the book</Pill>
        <Pill tone="quiet" size="sm">SPY</Pill>
      </div>
    </div>
  )
}
