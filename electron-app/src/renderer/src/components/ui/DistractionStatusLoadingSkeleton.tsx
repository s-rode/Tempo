const DistractionStatusLoadingSkeleton = () => {
  return (
    <section className="tempo-inspector-section" aria-label="Current activity" aria-busy="true">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-grow animate-pulse">
          <div className="mb-2 h-3 w-1/4 rounded bg-muted"></div>
          <div className="h-4 w-3/4 rounded bg-muted"></div>
        </div>
        <div className="h-4 w-16 animate-pulse rounded bg-muted"></div>
      </div>
    </section>
  )
}

export default DistractionStatusLoadingSkeleton
