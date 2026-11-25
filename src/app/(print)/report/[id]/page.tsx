"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { useSentinel } from "@/lib/store";
import { analyzeIncident } from "@/lib/intelligence/engine";
import { analysisIsStale, buildPostmortem, postmortemMarkdown } from "@/lib/postmortem";
import { downloadText } from "@/lib/utils";
import { Button, Skeleton, buttonClass } from "@/components/ui/primitives";
import { PostmortemView } from "@/components/incidents/postmortem-view";
import { SentinelMark } from "@/components/shell/brand";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const ready = useSentinel((s) => s.hydrated);
  const incident = useSentinel((s) => s.incidents.find((i) => i.id === id));
  const cached = useSentinel((s) => s.analyses[id]);
  const incidents = useSentinel((s) => s.incidents);
  const changes = useSentinel((s) => s.changes);

  const pm = useMemo(() => {
    if (!ready || !incident) return null;
    const now = Date.now();
    const analysis = cached && !analysisIsStale(incident, cached, now) ? cached : analyzeIncident({ incident, incidents, changes, now });
    return buildPostmortem(incident, analysis, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, incident?.id, incident?.status, cached]);

  useEffect(() => {
    if (pm) document.title = `Postmortem ${pm.incidentId} · Sentinel`;
  }, [pm]);

  return (
    <div className="min-h-dvh bg-[#e9ebf1] print:bg-white">
      <div className="no-print sticky top-0 z-10 border-b border-black/10 bg-[#0b0f19] text-ink">
        <div className="mx-auto flex h-14 max-w-[900px] items-center gap-3 px-4">
          <SentinelMark />
          <span className="text-[13px] font-medium">Postmortem report</span>
          <div className="ml-auto flex items-center gap-2">
            <Link href={`/incidents/${id}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back to incident
            </Link>
            {pm && (
              <Button variant="secondary" onClick={() => downloadText(`postmortem-${pm.incidentId.toLowerCase()}.md`, postmortemMarkdown(pm))}>
                <Download className="h-3.5 w-3.5" /> Markdown
              </Button>
            )}
            <Button variant="primary" onClick={() => window.print()} disabled={!pm}>
              <Printer className="h-3.5 w-3.5" /> Print or save as PDF
            </Button>
          </div>
        </div>
      </div>
      <main className="print-sheet mx-auto my-8 max-w-[900px] rounded-[6px] bg-white px-8 py-10 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)] sm:px-14 sm:py-14">
        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40 !bg-[#e5e7ee]" />
            <Skeleton className="h-8 w-3/4 !bg-[#e5e7ee]" />
            <Skeleton className="h-40 w-full !bg-[#eef0f5]" />
          </div>
        ) : !incident || !pm ? (
          <p className="text-[14px] text-[#2a3142]">
            Incident {id} was not found.{" "}
            <Link href="/incidents" className="text-[#5b4bc4] underline">
              Back to incidents
            </Link>
          </p>
        ) : (
          <>
            <div className="mb-8 flex items-center justify-between">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[#0b0f19]">
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                  <path d="M2 13h4.2l2.3-6.5 3.6 11 2.6-8 1.6 3.5H22" stroke="#5b4bc4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Sentinel
              </span>
              <span className="text-[11.5px] text-[#5b6475]">Acme Cloud · Production</span>
            </div>
            <PostmortemView pm={pm} variant="paper" />
          </>
        )}
      </main>
    </div>
  );
}
