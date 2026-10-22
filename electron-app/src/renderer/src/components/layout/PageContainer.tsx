import { ReactNode } from 'react'

interface PageContainerProps {
  children: ReactNode
  className?: string
}

export function PageContainer({ children, className = '' }: PageContainerProps): React.JSX.Element {
  return (
    <div className={`h-screen bg-background text-foreground flex flex-col ${className}`}>
      {children}
    </div>
  )
}
