import { notFound } from "next/navigation";
import { DISCLOSURE_EVENT_KINDS } from "@/lib/wepatent/domain/intake";
import { getAdapters } from "@/lib/server/adapters";
import { requireOnboarded } from "@/lib/server/session";
import { addDisclosureEventAction } from "../actions";

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();
  const events = await data.listDisclosureEvents(context.organization.id, id);

  return (
    <>
      <div className="wp-boundary-banner">
        Disclosure and commercialization events can affect patent rights, but the legal effect of
        any event — including any deadline — is determined by counsel, not by this software. The
        product does not monitor deadlines.
      </div>
      {error && (
        <p className="form-error" role="alert">
          Could not add that event. Check the fields and try again.
        </p>
      )}
      <div className="wp-card">
        <h2>Timeline ({events.length} events)</h2>
        <ul className="wp-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <span className="when">{event.date}</span>
              <span>
                <span className="wp-badge neutral">{event.kind.replace(/_/g, " ")}</span>{" "}
                {event.description}
                {event.underNda && (
                  <>
                    {" "}
                    <span className="wp-badge neutral">under NDA (per user)</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="wp-card" style={{ marginTop: 22, maxWidth: 760 }}>
        <h2>Record an event</h2>
        <form action={addDisclosureEventAction} className="wp-form">
          <input type="hidden" name="inventionId" value={id} />
          <div className="field">
            <label htmlFor="event-date">Date</label>
            <input id="event-date" name="date" type="date" required />
          </div>
          <div className="field">
            <label htmlFor="event-kind">Kind</label>
            <select id="event-kind" name="kind" required defaultValue="disclosure">
              {DISCLOSURE_EVENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="event-description">Description</label>
            <textarea id="event-description" name="description" required minLength={3} />
          </div>
          <label className="acknowledgement">
            <input type="checkbox" name="underNda" />
            <span>This event was under NDA, to the best of my knowledge.</span>
          </label>
          <div>
            <button className="button venture-button" type="submit">
              Add event
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
