import { useState, useEffect, useRef } from 'react'
import { Pill, Button, InfoTip } from './ui'
import SetupPanel from './SetupPanel'
import { fmtMoney0, fmtPct0, expiryInfo, rowFigures, rowKey, upsidePerCollateral, shortsWorthless, liquidityCost, thinLegs } from './format'

// One ticker's thin-quote setups (Tier 1: the volume floor off; the spread cap and the
// two-sided quote unchanged; the user's floors unchanged). Display-only: its own labelled
// group under the ranked list, never interleaved with Tier 0 rows, never counted in ranks,
// never saveable. The headline is the liquidity cost of the selected row — what patience is
// worth — because a worst-case price is a floor, not a forecast.
export default function RelaxedGroup({ ticker, group, ladder, scannedAt, onView, onClose, dimmed = false, initialKey = null, onSelect }) {
  const rows = group?.rows ?? []
  const floor = ladder?.tier0?.volume_floor ?? 20
  const capPct = Math.round((ladder?.tier1?.spread_cap ?? 0.15) * 100)
  const [selectedKey, setSelectedKeyState] = useState(initialKey)
  const setSelectedKey = k => { setSelectedKeyState(k); onSelect?.(k) }
  const selected = rows.find(r => rowKey(r) === selectedKey) ?? rows[0] ?? null
  const selKey = selected ? rowKey(selected) : null
  const cost = selected ? liquidityCost(selected) : null
  const f0 = selected ? rowFigures(selected) : null
  // Opening answers the chip's question somewhere the reader can see: scroll the group in and hand it focus.
  const headRef = useRef(null), rowRefs = useRef({})
  useEffect(() => { headRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); headRef.current?.focus({ preventScroll: true }) }, [])
  function onRowKey(e, i) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
      setSelectedKey(rowKey(rows[j])); rowRefs.current[rowKey(rows[j])]?.focus()
    } else if (e.key === 'Enter') { onView?.(rows[i]) }
    else if (e.key === ' ') { e.preventDefault(); setSelectedKey(rowKey(rows[i])) }
  }

  return (
    <section
      aria-label={`Thin-quote setups: ${ticker}`}
      data-relaxed-group={ticker}
      className={`bg-lc-card rounded-lc shadow-lc p-6 flex flex-col gap-5 transition-opacity ${dimmed ? 'opacity-60' : ''}`}
    >
      {/* Head: the ticker, the tier, and what did and didn't move */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 ref={headRef} tabIndex={-1} className="font-display font-bold text-[1.4rem] leading-tight tracking-[-0.02em] outline-none flex items-baseline gap-2.5">
              {ticker} <span className="font-figtree font-medium text-[1rem] text-lc-ink-2 tracking-normal">thin-quote setups</span>
            </h2>
            <Pill tone="violet" title={`Tier 1: the ${floor}-contract volume floor is off. Two-sided quotes and the ${capPct}% spread cap still apply.`}>Tier 1 · volume floor off</Pill>
          </div>
          <p className="text-[0.9rem] text-lc-ink-2">
            Two-sided quotes and the {capPct}% spread cap still required · your credit and upside floors still apply · every leg priced at the side you’d hit, as above
            {scannedAt ? ` · scanned ${scannedAt}` : ''}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>Hide</Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[0.95rem] text-lc-ink-2">Even with the volume floor off, no setup cleared your floors.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,66fr)_minmax(0,34fr)] gap-4 items-start max-lc:grid-cols-1">
          <div className="min-w-0 flex flex-col gap-4">
            {/* The headline: what patience is worth, for the selected setup */}
            {cost && (
              <div className="rounded-lc-plus bg-lc-ground px-5 py-4 flex flex-col gap-2" data-liquidity-cost>
                <div className="flex items-center gap-2 text-[0.85rem] font-semibold text-lc-ink-2">
                  What patience is worth <span className="font-medium [font-variant-numeric:tabular-nums]">· {selected.leg_c_strike} / {selected.leg_a_strike} / {selected.leg_b_strike}</span>
                  <InfoTip text="At the bid/ask prices every leg at the side you'd hit: the bid on what you sell, the ask on what you buy — the figure every table on this page shows. At the mid is the same structure priced at the middle of each quote. The gap is what a patient limit order inside the spread could recover — often some of it, never guaranteed." />
                </div>
                <div className="flex items-end gap-6 flex-wrap">
                  <Figure label="At the bid/ask" value={fmtMoney0(cost.worst)} sub={f0?.debit ? 'the debit as shown, per contract' : 'the credit as shown, per contract'} />
                  <Figure label="At the mid" value={fmtMoney0(cost.atMid)} sub="same legs, mid of each quote" />
                  <Figure label="Gap" value={fmtMoney0(cost.gap)} sub={f0 && f0.maxProfit > 0 ? `mid minus bid/ask · ${(cost.gap / f0.maxProfit * 100).toFixed(1)}% of max profit` : 'mid minus bid/ask, per contract'} />
                </div>
              </div>
            )}

            {/* The rows: the Upside table's grammar, its own list, no ranks */}
            <div className="overflow-x-auto">
              <table className="w-full text-[0.95rem] border-separate border-spacing-0" data-tier="1">
                <thead>
                  <tr className="text-[0.78rem] font-semibold text-lc-ink-2 align-bottom">
                    <Th>Expires</Th><Th>Put / Call / Call</Th><Th right>Credit /ct<br /><span className="font-medium">at the bid/ask</span></Th><Th right>Gap<br /><span className="font-medium">mid − bid/ask</span></Th><Th right>Max profit /ct</Th><Th right>Max profit per<br />$ of collateral</Th><Th right>Shorts<br />worthless</Th><Th>Thin legs</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const key = rowKey(r), on = key === selKey
                    const f = rowFigures(r), lc = liquidityCost(r), thin = thinLegs(r, floor)
                    const exp = expiryInfo(r.expiration)
                    return (
                      <tr key={key} ref={el => { rowRefs.current[key] = el }} data-tier="1" data-selected={on || undefined} aria-selected={on}
                        onClick={() => setSelectedKey(key)} onDoubleClick={() => onView?.(r)}
                        onKeyDown={e => onRowKey(e, i)} tabIndex={on ? 0 : -1}
                        className={`cursor-pointer border-b border-lc-line/70 ${on ? 'bg-lc-violet-soft' : 'hover:bg-lc-ground'}`}>
                        <Td>{exp.short}{exp.dte != null ? <span className="text-lc-ink-2"> · {exp.dte}d</span> : null}</Td>
                        <Td><span className="text-lc-ink-2">{r.leg_c_strike} / </span><span className="font-semibold">{r.leg_a_strike}</span><span className="text-lc-ink-2"> / {r.leg_b_strike}</span></Td>
                        <Td right className={f.debit ? 'text-lc-loss-ink font-bold' : 'font-bold'}>{fmtMoney0(f.credit)}</Td>
                        <Td right className="font-semibold" title={lc ? `at the mid ${fmtMoney0(lc.atMid)}` : undefined}>{lc ? fmtMoney0(lc.gap) : '—'}</Td>
                        <Td right className="font-semibold">{fmtMoney0(f.maxProfit)}</Td>
                        <Td right>{(upsidePerCollateral(r) * 100).toFixed(1)}%</Td>
                        <Td right>{fmtPct0(shortsWorthless(r))}</Td>
                        <Td wrap><span className="text-[0.85rem] text-lc-ink-2" title={thin.length ? thin.map(t => `${t.leg}: ${t.volume} traded today`).join(' · ') : undefined}>{thin.length ? thin.map(t => t.leg).join(' · ') : 'none'}</span></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[0.82rem] text-lc-ink-2">Thin legs are quoted but traded fewer than {floor} contracts today (hover for the count). Click or ↑/↓ for a row’s dashboard; Enter or double-click views it in the editor.</p>
          </div>

          <div className="min-w-0">
            {selected && (
              <SetupPanel
                row={selected} mode="upside" dimmed={dimmed}
                statusPill={<Pill tone="violet">Tier 1 · volume floor off</Pill>}
                actions={<Button variant="secondary" onClick={() => onView?.(selected)}>View in editor</Button>}
                note="Not saveable — thin-quote setups don’t enter the Tradebook."
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Figure({ label, value, sub, hi }) {
  return (
    <div className="flex flex-col">
      <span className="text-[0.78rem] font-semibold text-lc-ink-2">{label}</span>
      <span className={`font-display font-extrabold text-[1.4rem] leading-tight tracking-[-0.01em] ${hi ? 'text-lc-ink' : 'text-lc-ink'}`}>{value}</span>
      <span className="text-[0.78rem] text-lc-ink-2">{sub}</span>
    </div>
  )
}
function Th({ children, right }) { return <th className={`px-2 py-2 leading-tight ${right ? 'text-right' : 'text-left'}`}>{children}</th> }
function Td({ children, right, wrap, className = '' }) { return <td className={`px-2 py-2.5 ${wrap ? '' : 'whitespace-nowrap'} [font-variant-numeric:tabular-nums] ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</td> }
