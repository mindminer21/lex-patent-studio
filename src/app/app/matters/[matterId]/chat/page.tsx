import type { Metadata } from "next";
import { getAdapters } from "@/lib/adapters";
import { VerificationBadge } from "@/components/workspace/badges";
import { canInvokeWorkflow } from "@/lib/domain/roles";
import { ChatForm } from "./ChatForm";

export const metadata: Metadata = {
  title: "Chat — Lex Patent Studio",
};

/**
 * Grounded conversational workspace (§8.2 /chat). Local mode replies are
 * retrieval-only: real corpus search, real quote verification, labeled
 * analysis, explicit refusal when the record is insufficient. No model is
 * called and nothing is charged.
 */
export default async function MatterChatPage({
  params,
}: {
  params: Promise<{ matterId: string }>;
}) {
  const { matterId } = await params;
  const adapters = getAdapters();
  const session = await adapters.auth.getSession();
  if (!session) return null;

  const messages = await adapters.data.listChatMessages(
    session.organizationId,
    matterId,
  );
  const mayChat = canInvokeWorkflow(session.role, "B");

  return (
    <div className="max-w-[900px] space-y-4">
      <section aria-labelledby="chat-heading">
        <h2 id="chat-heading" className="m-0 text-xl font-medium" style={{ fontFamily: "Georgia, serif" }}>
          Grounded chat
        </h2>
        <p className="mt-1 max-w-[720px] text-[0.85rem] text-[var(--muted)]">
          Every reply is grounded in the license-gated corpus: quotations pass
          the verifier or are shown as failed, synthesis is labeled analysis,
          and Lex refuses instead of guessing when the record is insufficient.
          This thread is isolated to this matter. Replies are drafts for
          practitioner evaluation — never advice to an end client.
        </p>
      </section>

      {messages.length === 0 ? (
        <p className="border border-dashed border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem] text-[var(--muted)]">
          No messages yet. Ask a question below — the reply will cite
          retrievable authority with per-quotation verification states.
        </p>
      ) : (
        <ol className="m-0 list-none space-y-3 p-0" aria-label="Conversation">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`border p-3 ${
                message.author === "user"
                  ? "border-[var(--line)] bg-[var(--white)]"
                  : "border-[var(--forest)] bg-[var(--paper)]"
              }`}
            >
              <p className="m-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                {message.author === "user"
                  ? `You (${message.authorUserId})`
                  : `Lex — grounded reply${message.asOfDate ? ` · as of ${message.asOfDate}` : ""}`}
              </p>
              <p className="mb-0 mt-1 text-[0.92rem] leading-relaxed">{message.body}</p>
              {message.citations.length > 0 && (
                <ul className="mb-0 mt-2 list-none space-y-2 p-0">
                  {message.citations.map((citation) => (
                    <li
                      key={citation.id}
                      className="border-l-2 border-[var(--line)] pl-3 text-[0.85rem]"
                    >
                      {citation.kind === "authority" ? (
                        <>
                          <span className="flex flex-wrap items-center gap-2">
                            <strong>{citation.citation}</strong>
                            <VerificationBadge state={citation.verification} />
                          </span>
                          {citation.quote && (
                            <span className="mt-0.5 block italic">
                              &ldquo;{citation.quote}&rdquo;
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="inline-flex items-center border border-[#9a958a] bg-[#efece3] px-1.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[#5a564c]">
                          Analysis — not quoted authority
                        </span>
                      )}
                      {citation.note && (
                        <span className="mt-0.5 block text-[0.78rem] text-[var(--muted)]">
                          {citation.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {mayChat ? (
        <ChatForm matterId={matterId} />
      ) : (
        <p className="border border-[var(--line)] bg-[var(--white)] p-4 text-[0.9rem]">
          Your seat ({session.role}) cannot use the research chat. Contributor
          seats cover intake, fact contribution, source upload, and status
          visibility; generation and research surfaces are practitioner-lane
          (enforced server-side).
        </p>
      )}
    </div>
  );
}
