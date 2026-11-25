import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { OnboardingDialog, ShortcutsDialog } from "@/components/shell/dialogs";
import { CreateIncidentDialog } from "@/components/incidents/create-incident-dialog";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <div className="relative z-10 flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <CreateIncidentDialog />
      <ShortcutsDialog />
      <OnboardingDialog />
    </>
  );
}
