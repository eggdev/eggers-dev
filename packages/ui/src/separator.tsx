import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Separator({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('h-px w-full bg-border', className)} {...props} />
}
