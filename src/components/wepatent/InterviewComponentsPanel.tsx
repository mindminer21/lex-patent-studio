"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The interview's right-hand components box (M4, Jeff's direction
 * 2026-08-05: "invention components should populate in a box on the right
 * side that appears only after there is enough information to distill
 * components").
 *
 * This component renders ONLY when the caller's gate is open — the gate
 * itself is `shouldShowComponentsPanel` in `domain/interview.ts`, the one
 * predicate the server and the live client both call.
 *
 * Contents are the component inventory and nothing else: name + short
 * descriptor, each carrying its ai_proposed / confirmed state. Editing is
 * inline and autosaves (debounced + on blur — no Save button); confirm and
 * delete go through the ps-ledger guard server-side, where AI may only
 * propose. The coverage meter and the full P/S ledger stay in the Studio.
 *
 * Below 980px the panel collapses to a one-line summary the user opens on
 * demand, so the thread keeps the screen on a phone.
 */

export type ComponentView = {
  id: string;
  name: string;
  description: string;
  state: "ai_proposed" | "user_confirmed" | "user_edited";
};

const STATE_LABELS: Record<ComponentView["state"], string> = {
  ai_proposed: "AI proposed",
  user_confirmed: "Confirmed by you",
  user_edited: "Edited by you",
};

const AUTOSAVE_DELAY_MS = 700;

function ComponentRow({
  component,
  index,
  onUpdated,
  onDeleted,
  onError,
}: {
  component: ComponentView;
  index: number;
  onUpdated: (component: ComponentView) => void;
  onDeleted: (componentId: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(component.name);
  const [description, setDescription] = useState(component.description);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ name: component.name, description: component.description });

  // No prop→state resync: this row is the ONLY writer of these two fields
  // (extraction dedupes by name and never rewrites an existing component),
  // so re-syncing could only ever clobber what the user is typing.

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function save(next: { name: string; description: string }): Promise<void> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const trimmed = { name: next.name.trim(), description: next.description.trim() };
    if (trimmed.name.length < 2) return; // never autosave a name away to nothing
    if (
      trimmed.name === latest.current.name.trim() &&
      trimmed.description === latest.current.description.trim()
    ) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/components/${component.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed),
      });
      if (!response.ok) {
        onError("That component edit could not be saved. Please try again.");
        return;
      }
      const payload = (await response.json()) as { component: ComponentView };
      latest.current = { name: payload.component.name, description: payload.component.description };
      onUpdated(payload.component);
    } catch {
      onError("Network error while saving that component.");
    } finally {
      setSaving(false);
    }
  }

  function queueSave(next: { name: string; description: string }): void {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), AUTOSAVE_DELAY_MS);
  }

  async function confirm(): Promise<void> {
    setSaving(true);
    try {
      const response = await fetch(`/api/components/${component.id}/confirm`, { method: "POST" });
      if (!response.ok) {
        onError("That component could not be confirmed. Please try again.");
        return;
      }
      const payload = (await response.json()) as { component: ComponentView };
      onUpdated(payload.component);
    } catch {
      onError("Network error while confirming that component.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    setSaving(true);
    try {
      const response = await fetch(`/api/components/${component.id}`, { method: "DELETE" });
      if (!response.ok) {
        onError("That component could not be removed. Please try again.");
        return;
      }
      onDeleted(component.id);
    } catch {
      onError("Network error while removing that component.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="wp-component-row" data-testid="component-row" data-state={component.state}>
      <input
        className="wp-component-name"
        aria-label={`Component ${index + 1} name`}
        value={name}
        maxLength={200}
        onChange={(event) => {
          setName(event.target.value);
          queueSave({ name: event.target.value, description });
        }}
        onBlur={() => void save({ name, description })}
      />
      <input
        className="wp-component-descriptor"
        aria-label={`Component ${index + 1} descriptor`}
        placeholder="Short descriptor"
        value={description}
        maxLength={2_000}
        onChange={(event) => {
          setDescription(event.target.value);
          queueSave({ name, description: event.target.value });
        }}
        onBlur={() => void save({ name, description })}
      />
      <p className="wp-component-meta">
        <span
          className={`wp-badge ${
            component.state === "ai_proposed" ? "needs_confirmation" : "source_supported"
          }`}
        >
          {STATE_LABELS[component.state]}
        </span>
        {component.state === "ai_proposed" && (
          <button
            className="button button-small"
            type="button"
            disabled={saving}
            onClick={() => void confirm()}
          >
            Confirm
          </button>
        )}
        <button
          className="button button-small"
          type="button"
          disabled={saving}
          onClick={() => void remove()}
        >
          Remove
        </button>
      </p>
    </li>
  );
}

export default function InterviewComponentsPanel({
  components,
  onUpdated,
  onDeleted,
}: {
  components: ComponentView[];
  onUpdated: (component: ComponentView) => void;
  onDeleted: (componentId: string) => void;
}) {
  const [compact, setCompact] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const body = (
    <>
      <p className="hint">
        Distilled from your answers. AI items are proposals until you confirm them; edits save
        as you type. Full editing lives in the Studio.
      </p>
      {components.length === 0 ? (
        <p className="hint" data-testid="components-empty">
          Nothing has been distilled into a discrete component yet — parts you describe will
          land here.
        </p>
      ) : (
        <ul className="wp-component-list">
          {components.map((component, index) => (
            <ComponentRow
              key={component.id}
              component={component}
              index={index}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
              onError={setError}
            />
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="status">
          {error}
        </p>
      )}
    </>
  );

  if (compact) {
    return (
      <details className="wp-card wp-components-panel" data-testid="interview-components">
        <summary>Invention components ({components.length})</summary>
        {body}
      </details>
    );
  }

  return (
    <section
      className="wp-card wp-components-panel"
      data-testid="interview-components"
      aria-label="Invention components"
    >
      <h2>Invention components ({components.length})</h2>
      {body}
    </section>
  );
}
