'use client';

import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>>(
    ({ className, ...props }, ref) => (
        <SheetPrimitive.Overlay
            className={cn(
                'fixed inset-0 z-50 bg-black/45 backdrop-blur-md data-[state=open]:animate-[arcodDrawerOverlayIn_300ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[arcodDrawerOverlayOut_240ms_cubic-bezier(0.4,0,1,1)]',
                className
            )}
            {...props}
            ref={ref}
        />
    )
);
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
    'fixed z-50 gap-4 bg-background/95 p-6 backdrop-blur-xl overflow-hidden transition-[box-shadow] will-change-[transform,opacity,filter] [transform-style:preserve-3d]',
    {
        variants: {
            side: {
                top: 'inset-x-0 top-0 border-b shadow-2xl data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
                bottom: 'inset-x-0 bottom-0 border-t shadow-2xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
                left: 'inset-y-0 left-0 h-full w-3/4 border-r shadow-[0_28px_120px_-28px_rgba(0,0,0,0.75)] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
                right: 'inset-y-0 right-0 h-full w-3/4 origin-right border-l shadow-[0_28px_120px_-28px_rgba(0,0,0,0.75)] data-[state=open]:animate-[arcodDrawerIn_420ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[arcodDrawerOut_280ms_cubic-bezier(0.4,0,1,1)] sm:max-w-sm'
            }
        },
        defaultVariants: {
            side: 'right'
        }
    }
);

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
    ({ side = 'right', className, children, ...props }, ref) => (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
                <div className="pointer-events-none absolute inset-0 z-0" style={{ background: 'radial-gradient(circle at top left, hsl(var(--primary) / 0.14), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.045), transparent 22%)' }} />
                <SheetPrimitive.Close className='absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-white/5 p-2 opacity-80 ring-offset-background transition-all hover:bg-white/10 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none'>
                    <X className='h-4 w-4' />
                    <span className='sr-only'>Close</span>
                </SheetPrimitive.Close>
                <div className='relative z-[1] h-full'>{children}</div>
            </SheetPrimitive.Content>
        </SheetPortal>
    )
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
);
SheetFooter.displayName = 'SheetFooter';

const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(
    ({ className, ...props }, ref) => <SheetPrimitive.Title ref={ref} className={cn('text-lg font-semibold text-foreground', className)} {...props} />
);
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
    React.ElementRef<typeof SheetPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => <SheetPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />);
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
