import { useNavigate } from 'react-router-dom'
import { Pill, LockIcon } from './ui'
import { TABS } from './format'

// The four-tab app shell (DESIGN.md tab strip). Tradebook is a route; Picks and
// Performance are locked for the free plan and open a teaser in the content
// area (App owns `activeTab`). The strip is a real tablist.

export default function AppShell({ activeTab, onTabChange, plan = 'free', marketOpen, lastRun, onLogout, children }) {
  const navigate = useNavigate()

  function pick(tab) {
    if (tab.href) { navigate(tab.href); return }
    onTabChange?.(tab.id)
  }

  return (
    <div className="lc min-h-screen flex flex-col">
      <header className="shrink-0 px-6 pt-5">
        <div className="mx-auto max-w-[1400px] grid grid-cols-[auto_1fr_auto] items-center gap-4">
          {/* Wordmark */}
          <button
            type="button"
            onClick={() => onTabChange?.('screener')}
            className="flex items-center gap-2.5 text-lc-ink font-display font-bold text-[1.15rem] tracking-[-0.01em] shrink-0"
            aria-label="Luo Capital, go to the screener"
          >
            <Mark />
            Luo Capital
          </button>

          {/* Tab strip */}
          <div role="tablist" aria-label="App sections" className="justify-self-center flex gap-1 p-1.5 bg-lc-ground-deep/60 rounded-lc-plus">
            {TABS.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => pick(tab)}
                  className={`flex items-center gap-2 h-10 px-3.5 rounded-lc-half font-display font-bold text-[1rem] whitespace-nowrap transition-colors
                    ${active ? 'bg-lc-card text-lc-ink shadow-lc' : 'text-lc-ink-2 hover:text-lc-ink'}`}
                >
                  {tab.locked && <LockIcon className="w-3.5 h-3.5 text-lc-ink-3" />}
                  {tab.label}
                  {tab.free
                    ? <Pill tone="lime" size="sm">Free</Pill>
                    : <Pill tone="quiet" size="sm">Paid</Pill>}
                </button>
              )
            })}
          </div>

          {/* Status cluster */}
          <div className="flex items-center gap-3 shrink-0 justify-self-end">
            <MarketBadge open={marketOpen} lastRun={lastRun} />
            <Pill tone="quiet" aria-label={`Plan: ${plan}`}>{plan === 'paid' ? 'Paid plan' : 'Free plan'}</Pill>
            <button
              type="button"
              onClick={onLogout}
              className="text-[0.9rem] font-medium text-lc-ink-2 hover:text-lc-ink whitespace-nowrap"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 pb-10">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  )
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="3" y="16" width="22" height="6" rx="3" fill="#15121A" />
      <rect x="6" y="10" width="16" height="5" rx="2.5" fill="#6547E6" />
      <rect x="9" y="5" width="10" height="4" rx="2" fill="#D4F53C" />
    </svg>
  )
}

// Text carries the state; no color-only meaning.
function MarketBadge({ open, lastRun }) {
  const label = open === null || open === undefined ? 'Market —' : open ? 'Market open' : 'Market closed'
  return (
    <div className="text-right leading-tight whitespace-nowrap">
      <div className="text-[0.85rem] font-semibold text-lc-ink">{label}</div>
      <div className="text-[0.75rem] text-lc-ink-2 [font-variant-numeric:tabular-nums]">
        {lastRun ? `Last scan ${shortRun(lastRun)}` : 'No scan yet'}
      </div>
    </div>
  )
}

// "2026-09-12 15:57:54" → "15:57" today, else "Sep 12 15:57".
function shortRun(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s))
  if (!m) return s
  const [, y, mo, d, hh, mm] = m
  const now = new Date()
  const sameDay = Number(y) === now.getFullYear() && Number(mo) === now.getMonth() + 1 && Number(d) === now.getDate()
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return sameDay ? `${hh}:${mm}` : `${MONTHS[Number(mo) - 1]} ${Number(d)} ${hh}:${mm}`
}
