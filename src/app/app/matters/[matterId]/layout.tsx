import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/adapters";
import { MatterTabs } from "./MatterTabs";

export default async function MatterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const matter = await adapters.data.getMatter(session.organizationId, matterId);
  if (!matter) notFound();

  return (
    <div className="max-w-[1500px]">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1
          className="m-0 text-2xl font-medium tracking-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          {matter.matterNumber}
        </h1>
        <p className="m-0 max-w-[640px] text-[0.95rem] text-[var(--muted)]">
          {matter.title}
        </p>
        <span className="text-[0.78rem] text-[var(--muted)]">
          {matter.jurisdiction} · {matter.technologyArea} · {matter.lifecycle} ·
          synthetic demo matter
        </span>
      </header>
      <MatterTabs matterId={matterId} />
      {children}
    </div>
  );
}
