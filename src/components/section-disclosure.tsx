import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionDisclosure({
  icon,
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors",
          open && "border-b border-border",
        )}
      >
        <div className="h-9 w-9 border border-foreground grid place-items-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-xl leading-none truncate">{title}</p>
          {subtitle ? <p className="label-eyebrow !text-[0.625rem] mt-1">{subtitle}</p> : null}
        </div>
        {badge}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? children : null}
    </section>
  );
}
