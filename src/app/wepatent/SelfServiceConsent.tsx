"use client";

import { useState } from "react";

const acknowledgements = [
  "I understand this self-service product is not a law firm, does not provide legal advice, and does not create an attorney-client relationship.",
  "I understand every generated document is an automated working draft that may be wrong, incomplete, or unsuitable for my situation.",
  "I agree to have patent-related draft documents reviewed and approved by qualified patent counsel before filing, disclosure, legal reliance, or consequential business use.",
  "I understand the service does not monitor deadlines or guarantee patentability, ownership, freedom to operate, validity, enforceability, allowance, or any result.",
];

export default function SelfServiceConsent() {
  const [accepted, setAccepted] = useState<boolean[]>(() => acknowledgements.map(() => false));
  const ready = accepted.every(Boolean);

  function toggle(index: number) {
    setAccepted((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value));
  }

  return (
    <section className="consent-panel" aria-labelledby="consent-title">
      <p className="kicker">Required before substantive invention intake</p>
      <h2 id="consent-title">Know where the software stops—and counsel begins.</h2>
      <div className="acknowledgements">
        {acknowledgements.map((text, index) => (
          <label className="acknowledgement" key={text}>
            <input type="checkbox" checked={accepted[index]} onChange={() => toggle(index)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
      <p className="consent-legal">By continuing, you also agree to the versioned <a href="/wepatent/terms">Self-Service Terms</a>, including AI limitations, warranty disclaimers, liability limits, user responsibilities, and dispute provisions, subject to applicable law.</p>
      <button className="button venture-button" type="button" disabled={!ready}>Continue to invention intake</button>
      <p className="prototype-note" role="status">Prototype only: this control demonstrates the required clickwrap. No intake is submitted or stored.</p>
    </section>
  );
}
