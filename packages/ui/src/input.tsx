import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
