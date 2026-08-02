import type { Metadata } from "next";
import { LegalStub } from "@/components/marketing/LegalStub";

export const metadata: Metadata = { title: "AI disclosure — Lex Patent Studio" };

export default function AiDisclosurePage() {
  return (
    <LegalStub
      kicker="Legal / AI disclosure"
      title="How AI is used here."
      lede="Plain-language disclosure of what the AI does, what it cannot do, and the human review required around it."
      positions={[
        "Lex Patent Studio uses large language models from OpenAI, Anthropic, and (when enabled) xAI, accessed through a server-side gateway; the model used for each run is displayed with the output.",
        "AI outputs are drafts and decision support for a supervising practitioner — they are not legal advice, not a practitioner's judgment, and not guaranteed to be correct or complete.",
        "Every legal proposition in work product is either cited to a retrievable source in the run's evidence set or labeled as analysis; quotations and citations are verified against source text before being marked verified.",
        "AI can make errors, including plausible-sounding ones. Deterministic checks, second-model critique, and mandatory human review exist because of this; the responsible practitioner reviews all work before use.",
        "No AI output can approve work, set review state, file, sign, or communicate externally; those actions are reserved to authenticated humans.",
        "The product is not an 'AI lawyer' and does not replace a licensed practitioner; it compares to associate workflows on economics and throughput only, with claims substantiated by published evaluation evidence.",
      ]}
    />
  );
}
