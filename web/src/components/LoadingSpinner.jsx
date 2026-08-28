export default function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-8 h-8 border-2 border-subtle border-t-accent rounded-full animate-spin" />
      <p className="text-tertiary text-sm">Fetching options data…</p>
      <p className="text-tertiary text-xs">This takes 30–60 seconds</p>
    </div>
  )
}
