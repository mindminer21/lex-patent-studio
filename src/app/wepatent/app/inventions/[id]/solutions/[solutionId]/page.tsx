import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdapters } from "@/lib/server/adapters";
import { getSolutionEvidence } from "@/lib/server/services/ps-ledger";
import { requireOnboarded } from "@/lib/server/session";

const STATE_LABELS: Record<string, string> = {
  ai_proposed: "AI proposed — awaiting your review",
  user_confirmed: "Confirmed by you",
  user_edited: "Edited by you",
};

/**
 * Solution evidence gallery (Intake Studio M3, feature PRD §7): the visual
 * map from inventive concept to embodying structure — image/page region
 * crops (CSS-clipped client render of the stored bytes), quoted text
 * snippets with anchors, 3D geometry summaries, and interview-turn
 * excerpts. Every chip opens the source viewer at its anchor.
 */
export default async function SolutionEvidencePage({
  params,
}: {
  params: Promise<{ id: string; solutionId: string }>;
}) {
  const { id, solutionId } = await params;
  const context = await requireOnboarded();
  const { data } = getAdapters();
  const invention = await data.getInvention(context.organization.id, id);
  if (!invention) notFound();
  const evidence = await getSolutionEvidence(context.organization.id, solutionId);
  if (!evidence || evidence.solution.inventionId !== id) notFound();
  const { solution, items } = evidence;

  const cropStyle = (region: { x: number; y: number; w: number; h: number }, src: string) => {
    const positionX = region.w >= 1 ? 0 : (region.x / (1 - region.w)) * 100;
    const positionY = region.h >= 1 ? 0 : (region.y / (1 - region.h)) * 100;
    return {
      width: 260,
      height: Math.max(80, Math.round(260 * (region.h / region.w))),
      backgroundImage: `url(${src})`,
      backgroundSize: `${100 / region.w}% ${100 / region.h}%`,
      backgroundPosition: `${positionX}% ${positionY}%`,
    } as const;
  };

  return (
    <>
      <div className="wp-boundary-banner">
        Working draft — counsel review required. Evidence marked &ldquo;AI proposed&rdquo; is
        an unreviewed proposal until you act on it.
      </div>
      <div className="wp-topbar">
        <h1>Solution evidence gallery</h1>
        <Link className="button button-small" href={`/wepatent/app/inventions/${id}/studio`}>
          Back to the studio
        </Link>
      </div>

      <div className="wp-card">
        <p className="venture-kicker">Solution</p>
        <h2>{solution.statement}</h2>
        <p>
          <span
            className={`wp-badge ${solution.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
          >
            {STATE_LABELS[solution.state]}
          </span>
        </p>
        {solution.sourceAnchors.length > 0 && (
          <p className="hint">Anchors: {solution.sourceAnchors.join(" · ")}</p>
        )}
      </div>

      <div className="wp-card" style={{ marginTop: 18 }} data-testid="evidence-gallery">
        <h2>Evidence ({items.length})</h2>
        {items.length === 0 && (
          <p>
            No evidence linked yet. Draw region anchors in the source viewer, associate
            components, or answer interview questions to build the evidence map.
          </p>
        )}
        {items.map((item, index) => {
          switch (item.kind) {
            case "region": {
              const rawUrl = `/api/inventions/${id}/sources/${item.sourceId}/raw`;
              const viewerUrl = `/wepatent/app/inventions/${id}/sources/${item.sourceId}/view?focus=${item.associationId}`;
              return (
                <div key={index} className="wp-studio-pair" data-testid="evidence-region">
                  <p style={{ marginBottom: 4 }}>
                    <span className="wp-badge neutral">region anchor</span>{" "}
                    <span
                      className={`wp-badge ${item.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
                    >
                      {STATE_LABELS[item.state]}
                    </span>
                  </p>
                  {item.sourceClass === "image" && (
                    <div
                      className="wp-evidence-crop"
                      style={cropStyle(item.region, rawUrl)}
                      role="img"
                      aria-label={`Cropped region of ${item.sourceName}`}
                      data-testid="evidence-crop"
                    />
                  )}
                  <p className="hint">{item.locator}</p>
                  <Link className="button button-small" href={viewerUrl}>
                    Open source at this anchor
                  </Link>
                </div>
              );
            }
            case "component":
              return (
                <div key={index} className="wp-studio-pair" data-testid="evidence-component">
                  <p style={{ marginBottom: 4 }}>
                    <span className="wp-badge neutral">component</span>{" "}
                    <span
                      className={`wp-badge ${item.state === "ai_proposed" ? "needs_confirmation" : "source_supported"}`}
                    >
                      {STATE_LABELS[item.state]}
                    </span>
                  </p>
                  <p style={{ marginTop: 0 }}>
                    <strong>{item.componentName}</strong>
                    {item.componentDescription ? ` — ${item.componentDescription}` : ""}
                  </p>
                </div>
              );
            case "text_snippet":
              return (
                <div key={index} className="wp-studio-pair" data-testid="evidence-text">
                  <p style={{ marginBottom: 4 }}>
                    <span className="wp-badge neutral">
                      {item.artifactType === "transcript" ? "transcript excerpt" : "text snippet"}
                    </span>{" "}
                    <span className="hint">anchor: {item.anchor}</span>
                  </p>
                  <blockquote style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                    {item.excerpt}
                  </blockquote>
                  {item.sourceId && (
                    <p style={{ marginBottom: 0 }}>
                      <Link
                        className="button button-small"
                        href={`/wepatent/app/inventions/${id}/sources/${item.sourceId}/view`}
                      >
                        Open source at this anchor
                      </Link>
                    </p>
                  )}
                </div>
              );
            case "geometry":
              return (
                <div key={index} className="wp-studio-pair" data-testid="evidence-geometry">
                  <p style={{ marginBottom: 4 }}>
                    <span className="wp-badge neutral">3D geometry summary</span>{" "}
                    <span className="hint">computed by code, no AI</span>
                  </p>
                  <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{item.summary}</p>
                  <Link
                    className="button button-small"
                    href={`/wepatent/app/inventions/${id}/sources/${item.sourceId}/view`}
                  >
                    Open the 3D viewer
                  </Link>
                </div>
              );
            case "interview_turn":
              return (
                <div key={index} className="wp-studio-pair" data-testid="evidence-turn">
                  <p style={{ marginBottom: 4 }}>
                    <span className="wp-badge neutral">interview answer</span>{" "}
                    <span className="hint">anchor: turn:{item.turnId}</span>
                  </p>
                  <p style={{ marginTop: 0 }}>
                    <strong>Q:</strong> {item.question}
                  </p>
                  {item.answerExcerpt && (
                    <p style={{ marginTop: 0 }}>
                      <strong>A:</strong> {item.answerExcerpt}
                    </p>
                  )}
                  <Link
                    className="button button-small"
                    href={`/wepatent/app/inventions/${id}/interview`}
                  >
                    Open the interview transcript
                  </Link>
                </div>
              );
          }
        })}
      </div>
    </>
  );
}
