import { useEffect, useState } from 'react'

export default function Toast({ message, visible }) {
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    if (visible) {
      setOpacity(1)
    } else {
      setOpacity(0)
    }
  }, [visible])

  if (!visible && opacity === 0) return null

  return (
    <div
      style={{
        position:   'fixed',
        bottom:     '24px',
        right:      '24px',
        zIndex:     9999,
        opacity,
        transition: 'opacity 0.3s ease',
      }}
      className="bg-surface border border-profit-dim rounded-lg shadow-xl px-4 py-3 flex items-center gap-2"
    >
      <span className="w-2 h-2 rounded-full bg-profit flex-shrink-0" />
      <span className="text-profit text-sm font-semibold">{message}</span>
    </div>
  )
}
