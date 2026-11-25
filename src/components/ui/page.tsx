import { cn } from "@/lib/utils";

export function Page({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-3 pb-16 pt-5 sm:px-5 lg:px-7", wide ? "max-w-[1760px]" : "max-w-[1560px]", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-ink sm:text-[24px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
