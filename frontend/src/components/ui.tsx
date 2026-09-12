import { Slot } from "@radix-ui/react-slot";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { cn } from "@/lib/utils";

export function Toaster() {
  return <SonnerToaster richColors closeButton />;
}

// --- shadcn/ui button (cva variants + Radix Slot for asChild) ---
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
        secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
        outline:
          "border border-zinc-300 bg-transparent hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        ghost: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        link: "underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// Back-compat alias used across pages (outline variant).
export function GhostButton({ className, variant = "outline", ...props }: ButtonProps) {
  return <Button variant={variant} className={className} {...props} />;
}

// --- shadcn/ui badge ---
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
        secondary: "border-transparent bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        success: "border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
        destructive: "border-transparent bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
        outline: "text-zinc-700 dark:text-zinc-300",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// --- shadcn/ui switch (Radix) ---
export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-zinc-200 transition-colors",
        "data-[state=checked]:bg-zinc-900 dark:data-[state=checked]:bg-zinc-100",
        "focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700",
        className,
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg transition-transform",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:bg-zinc-900",
        )}
      />
    </SwitchPrimitives.Root>
  );
}

// --- shadcn/ui input / textarea ---
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
        "disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
        "disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-9 rounded-md border border-zinc-300 bg-transparent px-3 py-1 text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500",
        "disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900",
        className,
      )}
      {...props}
    />
  );
}

// --- shadcn/ui card ---
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-zinc-200 bg-white text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-4 pb-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
