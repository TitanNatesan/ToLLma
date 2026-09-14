import { Slot } from "@radix-ui/react-slot";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as TooltipPrimitives from "@radix-ui/react-tooltip";
import * as DropdownMenuPrimitives from "@radix-ui/react-dropdown-menu";
import * as ScrollAreaPrimitives from "@radix-ui/react-scroll-area";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as DialogPrimitives from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";
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
        default: "bg-tollma-600 text-white hover:bg-tollma-700 dark:bg-tollma-600 dark:text-white dark:hover:bg-tollma-500",
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
        icon: "h-8 w-8",
        xs: "h-6 w-6 rounded",
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

export function IconButton({ className, variant = "ghost", size = "icon", ...props }: ButtonProps) {
  return <Button variant={variant} size={size} className={cn("shrink-0", className)} {...props} />;
}

// --- shadcn/ui badge ---
const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-tollma-600 text-white dark:bg-tollma-600 dark:text-white",
        secondary: "border-transparent bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        success: "border-transparent bg-tollma-100 text-tollma-800 dark:bg-tollma-900 dark:text-tollma-200",
        destructive: "border-transparent bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
        outline: "text-zinc-700 dark:text-zinc-300",
        warning: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
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
        "data-[state=checked]:bg-tollma-600 dark:data-[state=checked]:bg-tollma-500",
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
        "focus-visible:outline-none focus-visible:border-tollma-500 focus-visible:ring-2 focus-visible:ring-tollma-500/40",
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
        "focus-visible:outline-none focus-visible:border-tollma-500 focus-visible:ring-2 focus-visible:ring-tollma-500/40",
        "disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700",
        className,
      )}
      {...props}
    />
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  sizeVariant?: "default" | "sm";
  wrapperClassName?: string;
}

export function Select({
  className,
  wrapperClassName,
  sizeVariant = "default",
  children,
  disabled,
  ...props
}: SelectProps) {
  const widthClasses = className
    ?.split(/\s+/)
    .filter((c) => /^(w-|max-w-|min-w-|flex-)/.test(c))
    .join(" ");

  return (
    <div
      className={cn(
        "relative inline-flex items-center",
        widthClasses || "w-full",
        disabled && "opacity-50",
        wrapperClassName,
      )}
    >
      <select
        disabled={disabled}
        className={cn(
          "w-full appearance-none rounded-md border text-zinc-900 transition-colors cursor-pointer",
          "border-zinc-300 bg-white hover:border-zinc-400 shadow-xs",
          "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tollma-500/40 focus-visible:border-tollma-500 dark:focus-visible:ring-tollma-500/40",
          "disabled:cursor-not-allowed",
          sizeVariant === "sm" ? "h-8 pl-2.5 pr-7 text-xs" : "h-9 pl-3 pr-8 text-sm",
          "[&>option]:bg-white [&>option]:text-zinc-900 dark:[&>option]:bg-zinc-900 dark:[&>option]:text-zinc-100",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-2 text-zinc-400 dark:text-zinc-500 shrink-0",
          sizeVariant === "sm" ? "size-3.5" : "size-4",
        )}
      />
    </div>
  );
}

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export function Checkbox({
  className,
  label,
  checked,
  disabled,
  id,
  ...props
}: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "group inline-flex items-center gap-2 text-xs select-none transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <div className="relative flex items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <div
          className={cn(
            "flex size-4 items-center justify-center rounded-[4px] border transition-all duration-150 shadow-xs",
            "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
            "group-hover:border-zinc-400 dark:group-hover:border-zinc-500",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-tollma-500/40 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-zinc-950",
            "peer-checked:border-tollma-600 peer-checked:bg-tollma-600 peer-checked:text-white",
            "dark:peer-checked:border-tollma-500 dark:peer-checked:bg-tollma-500 dark:peer-checked:text-white",
          )}
        >
          <Check
            className={cn(
              "size-3 stroke-[3] transition-transform duration-150",
              checked ? "scale-100 opacity-100" : "scale-50 opacity-0",
            )}
          />
        </div>
      </div>
      {label && (
        <span className="text-zinc-700 group-hover:text-zinc-900 dark:text-zinc-300 dark:group-hover:text-zinc-100 font-medium">
          {label}
        </span>
      )}
    </label>
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

// --- Separator ---
export function Separator({ className, orientation = "horizontal", ...props }: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        "shrink-0 bg-zinc-200 dark:bg-zinc-800",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

// --- Tooltip ---
export const TooltipProvider = TooltipPrimitives.Provider;

export function Tooltip({ children, content, side = "top" }: { children: React.ReactNode; content: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitives.Root delayDuration={400}>
      <TooltipPrimitives.Trigger asChild>{children}</TooltipPrimitives.Trigger>
      <TooltipPrimitives.Portal>
        <TooltipPrimitives.Content
          side={side}
          className="z-50 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white shadow-md dark:bg-zinc-100 dark:text-zinc-900"
          sideOffset={4}
        >
          {content}
          <TooltipPrimitives.Arrow className="fill-zinc-900 dark:fill-zinc-100" />
        </TooltipPrimitives.Content>
      </TooltipPrimitives.Portal>
    </TooltipPrimitives.Root>
  );
}

// --- Dropdown Menu ---
export const DropdownMenu = DropdownMenuPrimitives.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitives.Trigger;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Content>) {
  return (
    <DropdownMenuPrimitives.Portal>
      <DropdownMenuPrimitives.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-md border border-zinc-200 bg-white p-1 shadow-md dark:border-zinc-800 dark:bg-zinc-900",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitives.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Item>) {
  return (
    <DropdownMenuPrimitives.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        "focus:bg-zinc-100 dark:focus:bg-zinc-800",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-2 py-1.5 text-xs font-semibold text-zinc-500", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Separator>) {
  return <DropdownMenuPrimitives.Separator className={cn("my-1 h-px bg-zinc-200 dark:bg-zinc-800", className)} {...props} />;
}

// --- Scroll Area ---
export function ScrollArea({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitives.Root>) {
  return (
    <ScrollAreaPrimitives.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollAreaPrimitives.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitives.Viewport>
      <ScrollAreaPrimitives.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none transition-colors w-2 p-0.5"
      >
        <ScrollAreaPrimitives.Thumb className="relative flex-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
      </ScrollAreaPrimitives.Scrollbar>
    </ScrollAreaPrimitives.Root>
  );
}

// --- Dialog (for modal dialogs) ---
export const Dialog = DialogPrimitives.Root;
export const DialogTrigger = DialogPrimitives.Trigger;
export const DialogPortal = DialogPrimitives.Portal;

export function DialogOverlay({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitives.Overlay>) {
  return (
    <DialogPrimitives.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitives.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitives.Content
        className={cn(
          "fixed left-1/2 top-[15%] z-50 w-full max-w-lg -translate-x-1/2 rounded-xl border border-zinc-200 bg-white p-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950",
          "max-h-[80vh] overflow-y-auto",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitives.Content>
    </DialogPortal>
  );
}
