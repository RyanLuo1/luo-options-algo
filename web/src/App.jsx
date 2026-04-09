import './index.css'
import Header      from './components/Header'
import MacroEvents from './components/MacroEvents'
import Holdings    from './components/Holdings'
import RankedTable from './components/RankedTable'
import LoadingSpinner from './components/LoadingSpinner'

// Static placeholder data — will be replaced with live API data in Step 6
const PLACEHOLDER_ROWS = [
  { rank: 1,  ticker: 'META', side: 'Put',  expiration: '2026-05-01', week: 'Week 4', dist_pct: '3%',  delta: 0.3616, strike: 610.00, premium: 18.775, price: 628.39, volume: 113,  oi: 879,   ratio: 0.082621, earnings_flag: 'EARNINGS 4/29' },
  { rank: 2,  ticker: 'META', side: 'Put',  expiration: '2026-05-01', week: 'Week 4', dist_pct: '5%',  delta: 0.2842, strike: 595.00, premium: 13.725, price: 628.39, volume: 29,   oi: 202,   ratio: 0.076852, earnings_flag: 'EARNINGS 4/29' },
  { rank: 3,  ticker: 'NVDA', side: 'Call', expiration: '2026-04-17', week: 'Week 1', dist_pct: '3%',  delta: 0.3613, strike: 190.00, premium: 3.450,  price: 183.91, volume: 9732, oi: 16719, ratio: 0.048165, earnings_flag: 'CLEAR' },
  { rank: 4,  ticker: 'NVDA', side: 'Put',  expiration: '2026-04-17', week: 'Week 1', dist_pct: '5%',  delta: 0.2210, strike: 174.50, premium: 2.150,  price: 183.91, volume: 7,    oi: 45,    ratio: 0.052890, earnings_flag: 'CLEAR' },
  { rank: 5,  ticker: 'META', side: 'Call', expiration: '2026-04-17', week: 'Week 1', dist_pct: '3%',  delta: 0.3801, strike: 648.00, premium: 8.100,  price: 628.39, volume: 210,  oi: 1420,  ratio: 0.033921, earnings_flag: 'CLEAR' },
]

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      <Header
        marketOpen={false}
        lastRun="2026-04-09 15:13:21"
        onRun={() => alert('API wiring coming in Step 6')}
        loading={false}
      />

      <MacroEvents macroEvents="CPI 4/10  |  PPI 4/14  |  FOMC 4/29" />

      <Holdings
        tickers={['META', 'NVDA']}
        skipped={[]}
        source="manual"
      />

      <main className="flex-1">
        <RankedTable rows={PLACEHOLDER_ROWS} duplicatesRemoved={1} />
      </main>

    </div>
  )
}
