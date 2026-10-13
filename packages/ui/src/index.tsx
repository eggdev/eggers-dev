'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ClassValue, clsx } from 'clsx';
import { X } from 'lucide-react';
import type * as React from 'react';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
const variants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
      },
      size: { default: 'h-9 px-4 py-2', sm: 'h-8 px-3 text-xs', icon: 'size-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(variants({ variant, size }), className)} {...props} />;
}
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  );
}
export function Badge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function Switch(props: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input transition-colors data-[state=checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-background shadow-xs transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}
export function Dialog({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border bg-background p-6 shadow-lg">
          <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            {description ?? 'Edit the details below.'}
          </DialogPrimitive.Description>
          <div className="mt-5">{children}</div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-sm p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
