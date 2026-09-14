import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('grid gap-1.5 text-sm font-medium', className)} {...props} />
}
