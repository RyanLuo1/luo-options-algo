export default function MacroEvents({ macroEvents }) {
  if (!macroEvents || macroEvents === 'None in next 4 weeks') {
    return (
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-2">
        <span className="text-gray-600 text-xs">No macro events in next 4 weeks</span>
      </div>
    )
  }

  // Parse "NFP 4/3  |  CPI 4/10  |  FOMC 4/29" into individual pills
  const events = macroEvents.split('|').map(e => e.trim()).filter(Boolean)

  return (
    <div className="bg-gray-900 border-b border-gray-800 px-6 py-2.5 flex items-center gap-2 flex-wrap">
      <span className="text-gray-500 text-xs mr-1">Macro:</span>
      {events.map((event, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/40"
        >
          {event}
        </span>
      ))}
    </div>
  )
}
