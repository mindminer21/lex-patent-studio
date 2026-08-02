import { getAdapters } from "@/lib/adapters";

/** §8.2 /activity — the matter's immutable audit trail. */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const events = await adapters.data.listAuditEvents(session.organizationId, {
    matterId,
  });

  return (
    <div className="max-w-[900px]">
      <h2 className="m-0 mb-1 text-lg font-medium" style={{ fontFamily: "Georgia, serif" }}>
        Activity
      </h2>
      <p className="mt-0 mb-4 text-[0.85rem] text-[var(--muted)]">
        Immutable audit events for every material action in this matter:
        actor, role, action, subject, and timestamp. Review decisions carry
        the document-version hash they were made against.
      </p>

      {events.length === 0 ? (
        <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.85rem] text-[var(--muted)]">
          No recorded events.
        </p>
      ) : (
        <ol className="m-0 list-none border-t border-[var(--ink)] p-0">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-b border-[var(--line)] py-2.5 text-[0.8rem]"
            >
              <span className="text-[0.72rem] leading-relaxed text-[var(--muted)]">
                {event.createdAt.slice(0, 16).replace("T", " ")}Z
              </span>
              <span className="leading-relaxed">
                <strong>{event.action}</strong>{" "}
                <span className="text-[var(--muted)]">
                  · {event.subjectType} {event.subjectId} · {event.actorUserId}
                  {event.actorRole ? ` (${event.actorRole})` : ""}
                </span>
                {event.detail && <span className="block">{event.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
