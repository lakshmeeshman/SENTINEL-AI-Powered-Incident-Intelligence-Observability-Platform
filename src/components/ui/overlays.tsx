"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────── Dialog ───────────── */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title?: React.ReactNode; description?: React.ReactNode; hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#03050a]/70 backdrop-blur-[3px] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          "glass fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 rounded-[11px] p-0 outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.2,0.9,0.3,1)]",
          className
        )}
        {...props}
      >
        {(title || description) && (
          <div className="border-b border-hairline px-5 pb-3.5 pt-4">
            {title && <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>}
            {description && <DialogPrimitive.Description className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{description}</DialogPrimitive.Description>}
          </div>
        )}
        {!title && <DialogPrimitive.Title className="sr-only">Dialog</DialogPrimitive.Title>}
        {!description && <DialogPrimitive.Description className="sr-only">Dialog content</DialogPrimitive.Description>}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-[5px] p-1 text-ink-subtle transition hover:bg-white/5 hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* ───────────── Popover ───────────── */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({ className, align = "end", sideOffset = 8, ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("glass z-50 rounded-[10px] outline-none data-[state=open]:animate-[pop-in_140ms_ease-out]", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* ───────────── Dropdown ───────────── */

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("glass z-50 min-w-48 rounded-[9px] p-1 outline-none data-[state=open]:animate-[pop-in_120ms_ease-out]", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({ className, inset, children, checked, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { inset?: boolean; checked?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "relative flex h-8 cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-[13px] text-ink-muted outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-ink data-[disabled]:opacity-40",
        inset && "pl-7",
        className
      )}
      {...props}
    >
      {checked !== undefined && <span className="absolute left-2 flex w-3.5 justify-center">{checked && <Check className="h-3.5 w-3.5 text-intel" />}</span>}
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-subtle", className)} {...props} />;
}

export function DropdownSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-hairline" />;
}

/* ───────────── Tooltip ───────────── */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-xs rounded-[6px] border border-hairline-strong bg-overlay px-2 py-1 text-[11.5px] text-ink shadow-xl data-[state=delayed-open]:animate-[pop-in_120ms_ease-out]"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ───────────── Switch ───────────── */

export function Switch({ checked, onCheckedChange, className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full ring-1 ring-inset transition-colors data-[state=checked]:bg-intel data-[state=checked]:ring-intel/60 data-[state=unchecked]:bg-white/[0.08] data-[state=unchecked]:ring-hairline-strong",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[15px]" />
    </SwitchPrimitive.Root>
  );
}
