import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
