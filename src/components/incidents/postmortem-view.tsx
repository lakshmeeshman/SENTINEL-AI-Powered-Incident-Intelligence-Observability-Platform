import type { Postmortem } from "@/lib/postmortem";
import { cn, formatClock } from "@/lib/utils";

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Renders a postmortem. `paper` is the print-friendly light variant. */
export function PostmortemView({ pm, variant = "dark" }: { pm: Postmortem; variant?: "dark" | "paper" }) {
  const paper = variant === "paper";
  const h2 = cn("mb-3 mt-8 text-[15px] font-semibold tracking-[-0.01em]", paper ? "text-[#0b0f19]" : "text-ink");
  const p = cn("text-[13.5px] leading-[1.7]", paper ? "text-[#2a3142]" : "text-ink-muted");
  const muted = paper ? "text-[#5b6475]" : "text-ink-subtle";
  const rule = paper ? "border-[#e3e6ee]" : "border-hairline";
  const li = cn("flex gap-2.5 text-[13.5px] leading-relaxed", paper ? "text-[#2a3142]" : "text-ink-muted");
  const dot = cn("mt-[9px] h-1 w-1 shrink-0 rounded-full", paper ? "bg-[#5b4bc4]" : "bg-intel");

  return (
    <article className={cn(paper && "text-[#0b0f19]")}>
      <header className={cn("border-b pb-5", rule)}>
        <p className={cn("font-mono text-[11.5px]", muted)}>
          Postmortem · {pm.incidentId} · {pm.severity}
        </p>
        <h1 className={cn("mt-2 text-[24px] font-semibold leading-tight tracking-[-0.025em]", paper ? "text-[#0b0f19]" : "text-ink")}>{pm.title}</h1>
        {pm.draft && (
          <p className={cn("mt-3 inline-block rounded-[5px] px-2 py-1 text-[12px] font-medium", paper ? "bg-[#fff4d6] text-[#7a5300]" : "bg-warning/10 text-warning ring-1 ring-warning/25")}>
            Draft: this incident is still active, and sections will change as the response continues.
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {pm.meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className={cn("text-[11px]", muted)}>{m.label}</dt>
              <dd className={cn("mt-0.5 break-words text-[12.5px]", paper ? "text-[#0b0f19]" : "text-ink")}>{m.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <h2 className={h2}>Executive summary</h2>
      <p className={p}>{pm.executiveSummary}</p>

      <h2 className={h2}>Incident timeline</h2>
      <ol className={cn("border-l pl-5", rule)}>
        {pm.timeline.map((e, i) => (
          <li key={i} className="relative pb-3 last:pb-0">
            <span
              className={cn(
                "absolute -left-[24.5px] top-[7px] h-2 w-2 rounded-full ring-2",
                paper ? "ring-white" : "ring-panel",
                e.kind === "change" ? "bg-[#60a5fa]" : e.kind === "signal" ? "bg-[#f43f5e]" : e.kind === "resolution" ? "bg-[#34d399]" : paper ? "bg-[#8a93a6]" : "bg-ink-subtle"
              )}
            />
            <p className={cn("text-[13px] leading-snug", paper ? "text-[#2a3142]" : "text-ink-muted")}>
              <span className={cn("tabular mr-2 font-mono text-[11.5px]", muted)}>
                {fmtDate(e.at)} {formatClock(e.at)}
              </span>
              {e.label}
              {e.actor && <span className={cn("ml-1.5 text-[12px]", muted)}>({e.actor})</span>}
            </p>
          </li>
        ))}
      </ol>

      <h2 className={h2}>Root cause</h2>
      <p className={cn("text-[14px] font-semibold", paper ? "text-[#0b0f19]" : "text-ink")}>
        {pm.rootCause.title} <span className={cn("font-normal", muted)}>({pm.rootCause.category}, {pm.rootCause.confidence}% confidence)</span>
      </p>
      <p className={cn(p, "mt-2")}>{pm.rootCause.detail}</p>
      <p className={cn("mb-2 mt-4 text-[12.5px] font-medium", paper ? "text-[#0b0f19]" : "text-ink")}>Contributing factors</p>
      <ul className="space-y-1.5">
        {pm.rootCause.factors.map((f, i) => (
          <li key={i} className={li}>
            <span className={dot} />
            {f}
          </li>
        ))}
      </ul>

      <h2 className={h2}>Business impact</h2>
      <p className={p}>{pm.impact.summary}</p>
      <div className={cn("mt-4 grid grid-cols-2 overflow-hidden rounded-[8px] border sm:grid-cols-4", rule)}>
        {pm.impact.rows.map((r) => (
          <div key={r.label} className={cn("border-b border-r px-3 py-2.5", rule)}>
            <p className={cn("text-[11px]", muted)}>{r.label}</p>
            <p className={cn("tabular mt-0.5 text-[14px] font-semibold", paper ? "text-[#0b0f19]" : "text-ink")}>{r.value}</p>
          </div>
        ))}
      </div>

      <h2 className={h2}>Resolution</h2>
      <p className={p}>{pm.resolution}</p>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className={h2}>What went well</h2>
          <ul className="space-y-1.5">
            {pm.wentWell.map((w, i) => (
              <li key={i} className={li}>
                <span className={cn("mt-[9px] h-1 w-1 shrink-0 rounded-full", paper ? "bg-[#059669]" : "bg-good")} />
                {w}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className={h2}>What went wrong</h2>
          <ul className="space-y-1.5">
            {pm.wentWrong.map((w, i) => (
              <li key={i} className={li}>
                <span className={cn("mt-[9px] h-1 w-1 shrink-0 rounded-full", paper ? "bg-[#e11d48]" : "bg-critical")} />
                {w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h2 className={h2}>Action items</h2>
      <div className={cn("overflow-hidden rounded-[8px] border", rule)}>
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className={cn("border-b", rule, paper ? "bg-[#f6f7fa] text-[#5b6475]" : "bg-white/[0.02] text-ink-subtle")}>
              <th className="w-12 px-3 py-2 font-medium">Pri</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Owner</th>
              <th className="w-24 px-3 py-2 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {pm.actionItems.map((a) => (
              <tr key={a.action} className={cn("border-b last:border-0", rule)}>
                <td className="px-3 py-2 align-top font-mono text-[11px] font-semibold">
                  <span className={a.priority === "P0" ? "text-[#e11d48]" : a.priority === "P1" ? (paper ? "text-[#b45309]" : "text-warning") : muted}>{a.priority}</span>
                </td>
                <td className={cn("px-3 py-2 align-top", paper ? "text-[#0b0f19]" : "text-ink")}>{a.action}</td>
                <td className={cn("hidden px-3 py-2 align-top sm:table-cell", paper ? "text-[#2a3142]" : "text-ink-muted")}>{a.owner}</td>
                <td className={cn("tabular px-3 py-2 align-top", muted)}>{fmtDate(a.due)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={cn("mt-8 border-t pt-4 text-[11.5px]", rule, muted)}>
        Blameless postmortem generated by Sentinel on {fmtDate(pm.generatedAt)} at {formatClock(pm.generatedAt)}. Analysis:{" "}
        {pm.analysisMode === "ai" ? `AI-powered (Claude · ${pm.model})` : "Sentinel demo intelligence (deterministic engine)"}.
      </p>
    </article>
  );
}
