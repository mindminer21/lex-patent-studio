# U.S. Legal, Ethics, and Product Risk Memo: Public AI Patent Drafting and Strategy Subscription

**Date:** July 30, 2026
**Scope:** U.S. issue spotting for a founder who is a patent attorney; public legal SaaS using third-party LLMs and public patent knowledge; assumed no existing law-firm/client data.
**Important:** This is issue spotting and product-risk analysis, not legal advice. State law, the founder’s admission jurisdictions, USPTO registration status, entity structure, actual user flow, vendor contracts, and marketing copy require counsel review before launch.

## Executive conclusion

The **highest-risk configuration** is a direct-to-inventor subscription that takes invention facts and autonomously recommends claim scope, filing strategy, or produces a filing-ready application. Those functions closely track the USPTO’s regulatory definition of practice before the Office: consulting or advising in contemplation of a patent filing and drafting specifications or claims. A “not legal advice” footer does not change what the product functionally does.[1]

The **lowest-risk credible launch** is a **B2B drafting/research copilot for registered patent practitioners and legal teams**, where a human practitioner controls strategy, verifies every output, signs nothing through the system, and remains responsible for the representation. The rules expressly allow practitioners to use non-practitioner assistants under supervision, but do not authorize the software itself to represent users.[1] A later inventor-facing product should be limited to education and user-directed self-help, with clear escalation to a separately engaged patent professional for individualized drafting or strategy.

“No client data” materially helps only if it is enforced by architecture and use policy. Public inventors will predictably enter unpublished invention details, which may be trade secrets, export-controlled technical data, or information whose disclosure can affect patent rights. Treat prompt content as **highly sensitive user data even when no attorney-client relationship exists**.

## Priority risk matrix

| Risk | Why it matters | Relative risk | Core mitigation |
|---|---|---:|---|
| UPL / unauthorized patent practice | Personalized claim drafting and filing strategy are expressly within 37 CFR 11.5’s description of patent practice | **Critical** for direct-to-public; medium for practitioner-only | Practitioner-only launch; no autonomous representation; jurisdictional review; human professional controls strategy |
| Accidental attorney-client relationship | Founder credentials, individualized human responses, or “attorney-reviewed” branding may create reasonable expectations despite boilerplate | **High** | Separate SaaS and law-firm flows; conspicuous clickwrap; no human legal advice outside engagement; conflicts/engagement gate |
| Confidentiality / privilege / trade secrets | Users may disclose inventions to the platform and third-party LLMs; privilege is not automatic | **High** | No-training enterprise APIs; short retention; U.S. processing; explicit “not privileged” warning; confidential mode only after vendor diligence |
| Hallucinations / reliance / filing harm | Bad claims, invented citations, omitted embodiments, missed deadlines, or wrong strategy can destroy value; FTC has acted against unsupported “AI lawyer” claims | **High** | Non-filing product; source validation; hard human-review gates; testing and substantiation; no “lawyer replacement” claims |
| Export controls / foreign filing / sanctions | Sending technical data to foreign model infrastructure or foreign persons can be an export; access from sanctioned parties/jurisdictions creates separate risk | **High** for technical/defense users | U.S.-only processing; geo/sanctions screening; export attestation and escalation; no sensitive categories without review |
| Licensed-content redistribution | Public availability does not always mean public domain or commercially redistributable | **Medium–High** | Source/license registry; link/cite rather than republish; snippet limits; exclude proprietary annotations/treatises; takedown process |
| Privacy / security / consumer protection | Account and prompt data remain regulated personal data; inaccurate “no retention/no training” statements can be deceptive | **Medium–High** | Accurate privacy notices; data map; deletion; DPA/subprocessor list; security program; verify every marketing statement |
| Professional entity / fee sharing / advertising | If the service becomes legal representation, ordinary SaaS ownership, revenue sharing, ads, conflicts, and insurance assumptions may fail | **High if legal services are offered** | Separate legal-service entity and engagement; Rule 5.4/7.x/state review; malpractice and cyber coverage |

## 1. Unauthorized practice of law and patent practice

### Why the direct-to-public model is exposed

37 CFR 11.5 defines patent practice to include:

- consulting with or advising a client in contemplation of filing;
- drafting a patent specification or claims;
- drafting amendments and replies; and
- other law-related services connected to contemplated or pending USPTO matters.[1]

That language maps directly onto “AI patent drafting and strategy.” The regulation allows a registered practitioner to employ non-practitioner assistants **under the practitioner’s supervision**; it does not grant independent practice authority to an AI product or its corporate operator.[1] A user’s ability to appear pro se does not necessarily authorize a third-party vendor to practice for the user.

State UPL rules also matter because the service is offered nationally and may address ownership, assignments, trade secrecy, contracts, foreign filing, and other state-law issues. ABA Model Rule 5.5 is only a model, not binding law, but illustrates the recurring prohibition against practicing where unauthorized and assisting another’s UPL.[2] *Sperry v. Florida* protects federally authorized patent-agent practice from conflicting state restrictions; it does not obviously federalize or authorize an unregistered autonomous SaaS provider.[3]

### Product implications

- **Do not assume the founder’s license “covers” every automated output.** If the founder is not actually reviewing and taking responsibility for each matter, the license may increase user expectations without supplying supervision.
- **Disclaimers are evidence, not immunity.** Regulators and courts can look to function, personalization, marketing, and user expectations.
- **Avoid direct recommendations** such as “file a provisional,” “claim X broadly,” “do not disclose Y,” “you are likely patentable,” or “this claim avoids the prior art” in an unrepresented-user flow.
- **Do not auto-file, insert signatures, calculate or guarantee deadlines, or communicate as the user’s representative.**
- Commission a **50-state UPL/product survey** focused on document automation and legal-tech services before opening individualized features to consumers.

## 2. Attorney-client relationship, prospective clients, and disclaimers

A relationship may be inferred from conduct and reasonable expectations under applicable state law; a universal website disclaimer is not conclusive. ABA Model Rule 1.18 also imposes duties concerning information received from a “prospective client,” even where no relationship follows.[4] ABA Formal Opinion 10-457 explains that website warnings and conditions can help shape whether a visitor reasonably expects consultation or confidentiality, but the site and communications must avoid misleading users.[5]

### Controls

1. **Separate three experiences:**
   - SaaS product: no legal representation, no founder-specific advice.
   - General education: public, nonpersonalized content.
   - Legal service: separate law-firm entity/flow, conflict check, jurisdiction check, signed engagement letter, defined scope, and malpractice coverage.
2. Use conspicuous, affirmative **clickwrap** before any invention facts are entered:
   - the SaaS company is not acting as the user’s lawyer;
   - use does not create an attorney-client relationship;
   - communications are not promised to be privileged;
   - outputs are drafts/information, may be wrong or incomplete, and require qualified review;
   - the product does not file, monitor deadlines, or represent the user;
   - do not enter classified, export-controlled, third-party confidential, or client information.
3. Repeat the boundary **in context**, not only in Terms: intake screen, chat header, export/download screen, and every “strategy” output.
4. Do not use product names or claims such as **“AI patent lawyer,” “attorney in your pocket,” “filing-ready,” “lawyer-quality,” “guaranteed patentability,”** or “attorney reviewed” unless literally true, scoped, and substantiated.
5. Any founder/human response that becomes individualized legal advice should stop until the conflicts and engagement process is complete. Send an express non-engagement notice when appropriate.

If the product is treated as providing legal services, additional issues follow: conflicts, competence, supervision, advertising/solicitation, fee sharing and nonlawyer ownership (Model Rule 5.4 and state variants), trust accounting/refunds, recordkeeping, multijurisdictional practice, and professional-liability insurance.

## 3. Confidentiality, privilege, retention, and model training

USPTO Rule 11.106 bars practitioners from revealing representation information without authorization and requires reasonable efforts to prevent unauthorized access or disclosure.[6] The USPTO’s AI guidance warns that AI-assisted searching and drafting can disclose client-sensitive information to system owners and that practitioners must consider confidentiality, foreign filing licenses, and export controls.[7] ABA Formal Opinion 512 similarly requires competence, confidentiality analysis, supervision, candor, and reasonable fees when lawyers use generative AI; informed consent may be required where information will be disclosed to a self-learning tool or material risks cannot otherwise be mitigated.[8] California’s State Bar guidance states that lawyers should understand how AI vendors collect, use, store, and disclose inputs and should not rely only on marketing assurances.[9]

**Confidentiality and attorney-client privilege are different.** Ethical confidentiality is broader; privilege is an evidentiary doctrine that is jurisdiction- and fact-specific. A consumer’s SaaS prompt is not privileged merely because a patent attorney founded the company. Disclosure to a vendor can complicate privilege or work-product claims unless the vendor is functioning as a necessary confidential agent under appropriate facts and agreements. The product should never promise privilege categorically.

### Required data controls

- Use third-party LLM terms that contractually provide **no training on prompts/outputs**, no human review except tightly controlled support, defined subprocessors, and deletion obligations.
- Prefer **zero-retention or shortest feasible retention**, U.S.-only storage/inference, encryption in transit/at rest, tenant isolation, least-privilege access, audit logs, and tested deletion.
- Make prompt logging **off by default**; collect only what is needed. Separate operational metrics from content. No public galleries or “share by default.”
- Publish a clear subprocessor list, retention schedule, incident process, and user-content ownership/license terms. Do not take a broad perpetual license to invention content.
- Provide an immediate delete function and backup-deletion schedule; document legal-hold exceptions.
- Prohibit uploads of law-firm client data in the public tier. If a confidential professional tier is offered, use a DPA/security addendum and vendor diligence suitable for legal data.
- Warn that sharing an invention can affect trade-secret status and patent rights. Do not claim that vendor processing is a “public disclosure” or is always harmless; make the risk fact-specific and advise professional review before disclosure or filing decisions.
- Verify privacy statements technically. Section 5 of the FTC Act reaches unfair or deceptive practices, including inaccurate statements about AI performance, privacy, retention, or training.[10]

## 4. Reliance, hallucinations, and quality claims

The USPTO requires anyone presenting a paper—including a pro se applicant—to certify, after reasonable inquiry, that legal contentions are warranted and factual contentions have or are likely to have evidentiary support. Sanctions can include striking papers or terminating proceedings.[11] The USPTO AI guidance says AI-assisted documents must be reviewed by a person who believes the submission is true and proper.[7]

The FTC’s final DoNotPay order is a direct warning: the agency challenged “robot lawyer” and human-lawyer-substitute claims where the company had not adequately tested the service or used attorneys to test legal-feature accuracy; the final order bars comparable claims without sufficient evidence.[12]

### Product controls

- Label all outputs **“draft—not reviewed—not filing-ready.”** Require an affirmative review acknowledgement before download.
- No automatic filing, signatures, deadline docketing, inventorship determinations, duty-of-disclosure decisions, or final claim strategy.
- Ground legal propositions in versioned primary sources (CFR, U.S. Code, MPEP, Federal Register, cases) with clickable citations and “current as of” dates.
- Validate every cited patent/publication number and quoted passage against the source. Refuse to fabricate missing authority.
- Run deterministic checks: claim antecedent basis, claim dependencies, defined terms, figure-reference consistency, support mapping, forbidden new matter warnings, and specification-to-claim traceability.
- Build attorney-reviewed test sets covering common and adversarial inventions; track material-error rates by task/model/version. Re-test after every model or prompt change.
- Red-team overclaiming, invented prior art, omitted embodiments, unsupported broad claims, inconsistent definitions, wrong entity status, foreign-filing advice, and fake deadlines.
- Maintain incident reporting, output traceability, model/version logs, rollback, and customer notice criteria.
- Market only measured capabilities. Avoid equivalence to lawyers, allowance-rate claims, time/cost savings, or “USPTO compliant” claims without documented methodology and representative testing.
- Use NIST AI RMF’s GOVERN–MAP–MEASURE–MANAGE structure as a governance baseline, including validity/reliability, security, transparency, privacy, and accountability.[13]

Contractual limitation-of-liability, warranty disclaimers, arbitration, and damages caps may reduce commercial exposure, but cannot be assumed to waive UPL, professional discipline, FTC/state consumer protection, gross negligence, or all consequential filing-loss claims. Obtain technology E&O, cyber, and—if legal services are offered—professional-liability coverage.

## 5. Export controls, foreign filing licenses, and sanctions

35 U.S.C. § 184 restricts foreign filing of inventions made in the United States before authorization or the statutory period.[14] More broadly, transmitting controlled technical data abroad or releasing controlled technology to a foreign person can constitute an export or deemed export under the EAR; ITAR may also apply to defense technical data. 15 CFR 734.13 defines export to include transmission outside the United States and release of controlled technology/source code to a foreign person in the United States.[15] The USPTO specifically warns practitioners that use of AI systems can implicate foreign filing licenses and export rules and that a foreign filing license is not a substitute for every export authorization in every context.[7]

OFAC restrictions are program-specific, but a public subscription should assess customers, payment counterparties, geographic locations, and services. OFAC’s compliance framework recommends management commitment, risk assessment, internal controls, testing/auditing, and training.[16]

### Controls

- Default invention-content processing to **U.S.-located infrastructure and U.S.-person support access**; prohibit vendor routing to foreign regions without review.
- At intake ask whether the invention was made in the United States and whether it involves defense, aerospace, nuclear, encryption, advanced semiconductor, military, or other controlled technology. High-risk answers stop automated processing and route to export counsel.
- Do not treat a foreign filing license as a blanket license for unrelated cloud transfers or technical assistance.
- Screen account holders, beneficial owners where appropriate, payment parties, and IP/geolocation against applicable OFAC restrictions and denied-party lists; block VPN/country anomalies for restricted services and retain auditable screening records.
- Contractually prohibit sanctioned/embargoed use and export-control evasion, but back the clause with technical controls.
- Build a vendor data-flow map showing every country in which prompts, logs, backups, support, and subprocessors may be accessed.

## 6. Public, copyrighted, and licensed knowledge

“Publicly accessible” is not the same as “public domain” or “licensed for commercial redistribution.” 17 U.S.C. § 105 generally excludes U.S. government works from federal copyright, while § 106 reserves reproduction, adaptation, distribution, and display rights to copyright owners.[17] The Supreme Court’s government-edicts doctrine excludes certain official legal works from copyright, but it does not free private annotations, headnotes, treatises, editorial enhancements, or licensed databases.[18]

USPTO’s own terms say most government-produced material is public domain but warn that not all material on its sites is a U.S. government work. They state patent text/drawings are **typically** not copyright-restricted, while acknowledging exceptions and third-party content.[19] MPEP 608.01(w) also contemplates patent documents containing copyright material where the owner permits facsimile reproduction of the patent document but otherwise reserves rights.[20]

### Controls

- Maintain a **source and license registry**: owner, URL/API, acquisition method, license/terms version, permitted use, excerpt limits, attribution, expiration, and deletion duty.
- Favor official U.S. Code/CFR/Federal Register/MPEP and clearly licensed patent bulk data. Do not scrape around access controls or exceed API terms.
- For patents, link to the official document and use only the minimum excerpt needed. Detect copyright notices, embedded standards, papers, software, photos, and trademarks.
- Do not ingest or reproduce proprietary treatises, paid databases, private prosecution templates, vendor summaries, annotations, or headnotes without a license that covers training/RAG and user-facing output.
- Implement output similarity/long-quotation controls so RAG does not emit substantial source passages. Keep source attribution and a takedown/DMCA workflow.
- Review third-party LLM terms for output ownership, indemnities, training rights, and infringement handling; do not promise users exclusive or noninfringing output beyond what can be supported.

## Recommended launch positioning

### Dual-brand recommendation

Use the same underlying agent only behind **two separately branded and permissioned products**:

- **Lex Patent Studio** for law firms and in-house legal departments, marketed as **“Your next patent associate.”** The surrounding copy must make clear that the system is a supervised tool and not a licensed person or autonomous legal provider. The responsible practitioner supplies legal judgment, reviews outputs, communicates with the client, and controls filings.
- **Invention Atlas** *(working name)* for VCs, founders, early-stage companies, and R&D teams. Position it as invention documentation, issue spotting, and counsel-readiness—not legal advice or representation. Require express agreement that outputs are drafts and that qualified patent counsel must review and approve patent documents before filing or consequential legal reliance.

Separate brand names, domains, visual systems, marketing claims, onboarding, clickwrap, email/support identities, billing descriptors, analytics properties, prompt policies, output labels, and permission sets. Common ownership and shared infrastructure may be disclosed where appropriate, but no UI should make a non-lawyer reasonably believe they are using the practitioner product or have retained its founder.

#### LegalZoom-informed terms architecture (independently drafted)

LegalZoom’s public Terms of Use, reviewed July 30, 2026, use several risk-allocation categories relevant to a self-service legal-technology product: a not-a-law-firm/no-legal-advice boundary; no attorney-client relationship; no review for legal sufficiency; independent attorney access separated from the software provider; jurisdiction/currentness warnings; “as is/as available” warranty disclaimers; limits on consequential and punitive damages and an aggregate cap subject to applicable-law carve-outs; user indemnity; dispute procedures; and state-specific savings clauses.

The non-lawyer product should use the same *categories*, but not copy LegalZoom’s wording and not assume the clauses are enforceable for this product. Patent drafting, generative AI, founder-lawyer involvement, prospective-client duties, state consumer rules, UPL, gross negligence, professional discipline, and FTC authority require product-specific terms and jurisdiction review.

Minimum contract package:

1. Conspicuous notice plus affirmative, unchecked clickwrap at account creation and again before substantive invention intake/export.
2. Clear identity of the SaaS operator and separate identity of any connected law firm.
3. No legal advice, no legal-sufficiency review, no representation, and no privilege promise in the self-service lane.
4. Automated-draft warning and mandatory qualified-counsel review/approval before filing or consequential use.
5. No deadline monitoring, filing, patentability/FTO/validity/ownership opinion, or outcome guarantee unless expressly provided in a signed legal engagement.
6. User responsibility for input accuracy, completeness, rights to materials, lawful use, and review of outputs.
7. AI limitations, source/currentness/jurisdiction limitations, provider/subprocessor disclosure, retention terms, and sensitive-data restrictions.
8. “As is/as available” and express/implied warranty disclaimers to the fullest lawful extent.
9. Carefully drafted direct-damages cap; exclusion of indirect, incidental, special, exemplary, punitive, and consequential damages where permitted; conspicuous exceptions and non-waivable rights.
10. User indemnity limited to third-party claims arising from unlawful uploads, rights violations, or misuse—not an overbroad attempt to erase the operator’s own duties.
11. Refund/cancellation, dispute notice, arbitration/class-waiver decisions if chosen, governing law, venue, limitation period, severability, survival, assignment, and change-notice terms.
12. State- and customer-type savings clauses; accessible process for consumers who cannot lawfully be bound by a limitation.
13. Separate connected-counsel engagement terms, conflicts, scope, legal fees, informed AI consent, and non-engagement notice.
14. Versioned assent records tied to exports and material workflow events.

The product must enforce these boundaries in code. Terms alone do not neutralize a workflow that performs regulated patent practice, creates reasonable reliance, or makes unsubstantiated lawyer-equivalence claims.

### Phase 1 — recommended

**“Patent drafting and research copilot for registered patent practitioners and legal teams.”**

- Credential/account verification for practitioner-facing features.
- Practitioner supplies legal judgment, reviews all work, and controls client communications.
- Product never files, signs, dockets, or represents.
- U.S.-only confidential processing with no-training terms.
- Marketing emphasizes workflow acceleration and source-grounded first drafts, not lawyer replacement or allowance outcomes.

### Phase 2 — lower-function public access

**“Patent education and invention-document organization—not legal advice or representation.”**

- Educational explanations, structured inventor questionnaires, and user-directed organization of supplied facts.
- No personalized claim scope, filing path, patentability conclusion, deadline advice, clearance/FTO opinion, or foreign-filing recommendation.
- Clear referral/escalation to an independently engaged registered practitioner.

### Separate legal-service option

If attorney review is commercially important, offer it through a clearly separate law-firm engagement: jurisdiction and USPTO credential checks, conflicts, signed scope, fees, informed consent to technology, professional supervision, records, insurance, and express handoff. Do not blur the subscription purchase with legal engagement.

## Minimum pre-launch gates

1. **Product classification:** approve Phase 1 or sharply limited Phase 2; no ambiguous “AI patent lawyer.”
2. **Regulatory review:** USPTO ethics/OED counsel plus state UPL review for launch states; 50-state plan before national consumer personalization.
3. **Entity/terms review:** SaaS/law-firm separation, Rule 5.4/5.5 implications, clickwrap, privacy policy, DPA, acceptable use, refund and liability terms.
4. **Data proof:** signed no-training/retention terms, U.S. data-flow map, subprocessors, deletion test, security test, incident plan.
5. **Quality proof:** attorney-reviewed benchmark, citation verifier, deterministic patent checks, model-change regression gate, no-filing control.
6. **Export/sanctions proof:** intake attestation, restricted-topic escalation, U.S. routing, screening and audit procedure.
7. **Content proof:** source/license registry, excerpt controls, proprietary-content exclusion, takedown process.
8. **Marketing proof:** legal and evidentiary review of every comparative/performance claim; no unsupported human-lawyer equivalence.

## Sources

1. [37 CFR 11.5, practice before the USPTO](https://www.ecfr.gov/current/title-37/chapter-I/subchapter-A/part-11/subpart-B/section-11.5).
2. [ABA Model Rule 5.5, Unauthorized Practice / Multijurisdictional Practice](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_5_5_unauthorized_practice_of_law_multijurisdictional_practice_of_law/) (model rule; state adoption varies).
3. [*Sperry v. Florida ex rel. Florida Bar*, 373 U.S. 379 (1963)](https://supreme.justia.com/cases/federal/us/373/379/).
4. [ABA Model Rule 1.18, Duties to Prospective Client](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_18_duties_of_prospective_client/) (model rule; state adoption varies).
5. [ABA Formal Opinion 10-457, Lawyer Websites (2010)](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-10-457.pdf).
6. [37 CFR 11.106, Confidentiality](https://www.ecfr.gov/current/title-37/chapter-I/subchapter-A/part-11/subpart-D/section-11.106).
7. USPTO, [Guidance on Use of AI-Based Tools in Practice Before the USPTO](https://www.federalregister.gov/documents/2024/04/11/2024-07629/guidance-on-use-of-artificial-intelligence-based-tools-in-practice-before-the-united-states), 89 Fed. Reg. 25609 (Apr. 11, 2024).
8. ABA Formal Opinion 512, [Generative Artificial Intelligence Tools (2024)](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf).
9. State Bar of California, [Practical Guidance for the Use of Generative AI in the Practice of Law](https://www.calbar.ca.gov/Portals/0/documents/ethics/Generative-AI-Practical-Guidance.pdf) (authoritative state-bar guidance; California-specific rules).
10. [Federal Trade Commission Act / Section 5](https://www.ftc.gov/legal-library/browse/statutes/federal-trade-commission-act).
11. [37 CFR 11.18, signature and certification](https://www.ecfr.gov/current/title-37/chapter-I/subchapter-A/part-11/subpart-B/section-11.18).
12. FTC, [Final DoNotPay Order and announcement](https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-finalizes-order-donotpay-prohibits-deceptive-ai-lawyer-claims-imposes-monetary-relief-requires) (Feb. 11, 2025); [case docket](https://www.ftc.gov/legal-library/browse/cases-proceedings/donotpay).
13. NIST, [AI Risk Management Framework 1.0](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf) (Jan. 2023).
14. [35 U.S.C. § 184](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title35-section184&num=0&edition=prelim).
15. [15 CFR 734.13, Export](https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-734/section-734.13); see also [15 CFR 734.18](https://www.ecfr.gov/current/title-15/subtitle-B/chapter-VII/subchapter-C/part-734/section-734.18).
16. OFAC, [A Framework for OFAC Compliance Commitments](https://ofac.treasury.gov/media/16331/download?inline); [Sanctions Programs and Country Information](https://ofac.treasury.gov/sanctions-programs-and-country-information).
17. [17 U.S.C. § 105](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-section105&num=0&edition=prelim); [17 U.S.C. § 106](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-section106&num=0&edition=prelim).
18. [*Georgia v. Public.Resource.Org, Inc.*, 590 U.S. 255 (2020)](https://www.supremecourt.gov/opinions/19pdf/18-1150_new_d18e.pdf).
19. USPTO, [Terms of Use—Copyright and Patent Information](https://www.uspto.gov/terms-use-uspto-websites).
20. USPTO, [MPEP 608.01(w), Copyright and Mask Work Notices](https://www.uspto.gov/web/offices/pac/mpep/s608.html#d0e44529).

*Sources were checked July 30, 2026. ABA Model Rules and opinions are influential guidance, not binding law unless adopted or applied by the relevant jurisdiction.*
