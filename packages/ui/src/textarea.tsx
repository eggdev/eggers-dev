import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
