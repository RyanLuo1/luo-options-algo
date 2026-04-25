/**
 * Dual-handle range slider for selecting a week range (min … max).
 * Built from two stacked native <input type="range"> elements so each thumb
 * is independently grabbable. The visible track + active fill are drawn as
 * divs underneath; thumb appearance is styled via .dual-thumb in index.css.
 */
export default function WeeksRangeSlider({
  min = 1,
  max = 12,
  valueMin,
  valueMax,
  onChange,
  disabled = false,
}) {
  const span = max - min
  const leftPct  = ((valueMin - min) / span) * 100
  const rightPct = ((valueMax - min) / span) * 100

  function handleMinChange(e) {
    const v = Math.min(Number(e.target.value), valueMax)
    if (v !== valueMin) onChange(v, valueMax)
  }

  function handleMaxChange(e) {
    const v = Math.max(Number(e.target.value), valueMin)
    if (v !== valueMax) onChange(valueMin, v)
  }

  return (
    <div className="relative w-44 h-7 select-none">
      {/* Track background */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-gray-700 rounded" />

      {/* Active range fill */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 bg-indigo-500 rounded"
        style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
      />

      {/* Min handle */}
      <input
        type="range"
        className="dual-thumb"
        min={min}
        max={max}
        step={1}
        value={valueMin}
        onChange={handleMinChange}
        disabled={disabled}
        aria-label="Minimum weeks"
      />

      {/* Max handle */}
      <input
        type="range"
        className="dual-thumb"
        min={min}
        max={max}
        step={1}
        value={valueMax}
        onChange={handleMaxChange}
        disabled={disabled}
        aria-label="Maximum weeks"
      />
    </div>
  )
}
