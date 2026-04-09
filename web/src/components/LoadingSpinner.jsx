export default function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-8 h-8 border-2 border-gray-700 border-t-indigo-500 rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">Fetching options data…</p>
      <p className="text-gray-600 text-xs">This takes 30–60 seconds</p>
    </div>
  )
}
