import { cn } from '@repo/ui/utils'
import type { ComponentProps } from 'react'

export function Alert({ className, ...props }: ComponentProps<'div'>) {
  return <div role="alert" className={cn('rounded-md border p-4 text-sm', className)} {...props} />
}
