import clsx from 'clsx'
import { Card } from './card'

const DistractionStatusLoadingSkeleton = ({ cardBgColor }: { cardBgColor: string }) => {
  return (
    <Card className={clsx('p-2 rounded-lg border-border', cardBgColor)}>
      <div className="flex items-center justify-between gap-x-2 sm:gap-x-3">
        <div className="animate-pulse flex-grow min-w-0">
          <div className="h-4 bg-muted rounded w-3/4 mb-1"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </div>
        <div className="animate-pulse">
          <div className="h-5 bg-muted rounded w-20"></div>
        </div>
      </div>
    </Card>
  )
}

export default DistractionStatusLoadingSkeleton
