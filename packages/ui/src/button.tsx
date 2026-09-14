import { Slot } from '@radix-ui/react-slot'
import { cn } from '@repo/ui/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        warm: 'bg-warm text-white hover:bg-warm/90 dark:text-background',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-sm px-3 text-xs',
        lg: 'h-11 px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ asChild, className, size, variant, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonVariants({ className, size, variant }))} {...props} />
}
