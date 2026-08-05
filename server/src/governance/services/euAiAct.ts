// EU AI Act assessment content (SELECTED_FEATURES_AUG2026 #35).
//
// Three things live here: the risk-tier classification questionnaire, the FRIA
// question set, and the scoring that turns answers into a tier.
//
// The questionnaire is ordered so that the decisive questions come first:
// Article 5 (prohibited) before Annex III (high-risk) before Article 50
// (transparency). That ordering is what makes the outcome defensible — a system
// that is prohibited cannot be "downgraded" by a later answer.
//
// Nothing here decides on its own. The wizard proposes a tier and the compliance
// officer confirms or overrides it with a written justification, because the
// classification is a legal judgement about a specific deployment and the wizard
// only sees the answers it was given.

export type RiskTier = "unacceptable" | "high" | "limited" | "minimal";

export interface TierQuestion {
  id: string;
  /** Which part of the Act this question comes from. */
  citation: string;
  section: "prohibited" | "high_risk" | "transparency" | "context";
  question: string;
  /** Shown under the question — the concrete cases the Act has in mind. */
  help: string;
  /** A "yes" answer implies this tier. */
  impliesTier?: RiskTier;
}

// ── Section 1: Article 5 — prohibited practices ──────────────────────────────
// Any "yes" here ends the assessment: the system cannot be deployed in the EU.
const PROHIBITED: TierQuestion[] = [
  {
    id: "p1",
    citation: "AI Act Art. 5(1)(c)",
    section: "prohibited",
    question: "Does the system score or rank people by social behaviour or personal traits, in a way that leads to detrimental treatment?",
    help: "Social scoring by public or private actors, where the score is used against people in contexts unrelated to the data's origin.",
    impliesTier: "unacceptable",
  },
  {
    id: "p2",
    citation: "AI Act Art. 5(1)(a)-(b)",
    section: "prohibited",
    question: "Does it use subliminal, manipulative or deceptive techniques, or exploit vulnerability due to age, disability or economic situation?",
    help: "Techniques that materially distort behaviour in a way likely to cause significant harm.",
    impliesTier: "unacceptable",
  },
  {
    id: "p3",
    citation: "AI Act Art. 5(1)(f)",
    section: "prohibited",
    question: "Does it infer emotions of people in the workplace or in education?",
    help: "Emotion recognition on employees or students. Narrow medical and safety exceptions exist.",
    impliesTier: "unacceptable",
  },
  {
    id: "p4",
    citation: "AI Act Art. 5(1)(e)",
    section: "prohibited",
    question: "Does it build or expand facial recognition databases by untargeted scraping of images from the internet or CCTV?",
    help: "Bulk collection of facial images without a specific, targeted basis.",
    impliesTier: "unacceptable",
  },
  {
    id: "p5",
    citation: "AI Act Art. 5(1)(g)-(h)",
    section: "prohibited",
    question: "Does it categorise people biometrically by sensitive traits, or perform real-time remote biometric identification in public spaces?",
    help: "Inferring race, political opinions, union membership, religion or sexual orientation from biometrics; or live facial identification in public. Narrow law-enforcement exceptions apply.",
    impliesTier: "unacceptable",
  },
];

// ── Section 2: Annex III — high-risk use cases ───────────────────────────────
const HIGH_RISK: TierQuestion[] = [
  {
    id: "h1",
    citation: "AI Act Annex III(4)",
    section: "high_risk",
    question: "Is it used in employment decisions — recruitment, screening, promotion, task allocation or termination?",
    help: "CV screening, candidate ranking, performance-based allocation or dismissal decisions.",
    impliesTier: "high",
  },
  {
    id: "h2",
    citation: "AI Act Annex III(3)",
    section: "high_risk",
    question: "Is it used in education — admissions, assessment of learning outcomes, or monitoring during exams?",
    help: "Admission decisions, automated marking, proctoring.",
    impliesTier: "high",
  },
  {
    id: "h3",
    citation: "AI Act Annex III(5)(b)-(c)",
    section: "high_risk",
    question: "Is it used to assess creditworthiness, or to price or risk-assess life and health insurance?",
    help: "Credit scoring for natural persons; insurance pricing and risk assessment.",
    impliesTier: "high",
  },
  {
    id: "h4",
    citation: "AI Act Annex III(5)(a)",
    section: "high_risk",
    question: "Is it used to determine access to essential public services or benefits?",
    help: "Eligibility for welfare, housing, healthcare or emergency services.",
    impliesTier: "high",
  },
  {
    id: "h5",
    citation: "AI Act Annex III(6)",
    section: "high_risk",
    question: "Is it used by law enforcement — risk assessment of individuals, evidence evaluation or predictive policing?",
    help: "Includes polygraph-style tools and assessing the reliability of evidence.",
    impliesTier: "high",
  },
  {
    id: "h6",
    citation: "AI Act Annex III(7)",
    section: "high_risk",
    question: "Is it used in migration, asylum or border control?",
    help: "Visa and asylum application assessment, risk assessment of travellers.",
    impliesTier: "high",
  },
  {
    id: "h7",
    citation: "AI Act Annex III(8)",
    section: "high_risk",
    question: "Is it used in the administration of justice or democratic processes?",
    help: "Assisting judicial decisions, or influencing elections and referenda.",
    impliesTier: "high",
  },
  {
    id: "h8",
    citation: "AI Act Annex III(1)",
    section: "high_risk",
    question: "Does it perform biometric identification, categorisation or emotion recognition outside the prohibited cases above?",
    help: "Post-remote biometric identification, or emotion recognition outside work and education.",
    impliesTier: "high",
  },
  {
    id: "h9",
    citation: "AI Act Annex III(2)",
    section: "high_risk",
    question: "Is it a safety component in critical infrastructure?",
    help: "Traffic management, or the supply of water, gas, heating or electricity.",
    impliesTier: "high",
  },
  {
    id: "h10",
    citation: "AI Act Art. 6(1)",
    section: "high_risk",
    question: "Is it a safety component of a product already regulated under EU product-safety law?",
    help: "Medical devices, machinery, lifts, toys, vehicles — where the AI part requires third-party conformity assessment.",
    impliesTier: "high",
  },
];

// ── Section 3: Article 50 — transparency obligations ─────────────────────────
const TRANSPARENCY: TierQuestion[] = [
  {
    id: "t1",
    citation: "AI Act Art. 50(1)",
    section: "transparency",
    question: "Does it interact directly with people, such that they might not realise they are dealing with an AI?",
    help: "Chatbots, voice agents, virtual assistants.",
    impliesTier: "limited",
  },
  {
    id: "t2",
    citation: "AI Act Art. 50(2), 50(4)",
    section: "transparency",
    question: "Does it generate or manipulate images, audio, video or text published as genuine?",
    help: "Synthetic media and deepfakes; AI-generated text published to inform the public.",
    impliesTier: "limited",
  },
];

// ── Section 4: context — does not change the tier, informs obligations ───────
const CONTEXT: TierQuestion[] = [
  {
    id: "c1",
    citation: "AI Act Art. 27",
    section: "context",
    question: "Is your organisation a public body, or a private operator providing essential public services?",
    help: "Determines whether a Fundamental Rights Impact Assessment is required for high-risk use.",
  },
  {
    id: "c2",
    citation: "AI Act Art. 25",
    section: "context",
    question: "Do you place the system on the market under your own name, or substantially modify it?",
    help: "Doing so can make you a provider rather than only a deployer, which carries far heavier obligations.",
  },
];

export const TIER_QUESTIONS: TierQuestion[] = [
  ...PROHIBITED, ...HIGH_RISK, ...TRANSPARENCY, ...CONTEXT,
];

export const TIER_META: Record<RiskTier, { label: string; summary: string; obligations: string[] }> = {
  unacceptable: {
    label: "Unacceptable risk — prohibited",
    summary: "This practice is banned in the EU. It cannot be deployed, and no amount of controls makes it compliant.",
    obligations: [
      "Do not deploy in the EU, or for people in the EU.",
      "Document the decision and, if the system exists, decommission it.",
      "Escalate to legal counsel — penalties are the highest tier under the Act.",
    ],
  },
  high: {
    label: "High risk — full obligations",
    summary: "Permitted, but subject to the Act's heaviest requirements before and during use.",
    obligations: [
      "Assign and document human oversight capable of intervening and stopping the system (Art. 14, 26).",
      "Keep automatically generated logs for at least six months (Art. 12, 26(6)).",
      "Use the system per the provider's instructions and monitor its operation (Art. 26).",
      "Ensure input data is relevant and representative for the intended purpose (Art. 26(4)).",
      "Complete a Fundamental Rights Impact Assessment if you are a public body or essential-service operator (Art. 27).",
      "Inform affected people that a high-risk system is used in decisions about them (Art. 26(11)).",
      "Report serious incidents to the provider and the authority (Art. 73).",
    ],
  },
  limited: {
    label: "Limited risk — transparency obligations",
    summary: "Permitted with disclosure duties, so people know they are dealing with, or looking at, AI output.",
    obligations: [
      "Tell people they are interacting with an AI system (Art. 50(1)).",
      "Mark synthetic image, audio, video and text in machine-readable form (Art. 50(2)).",
      "Disclose deepfakes and AI-generated text published to inform the public (Art. 50(4)).",
      "Keep the disclosure clear and accessible at the first interaction.",
    ],
  },
  minimal: {
    label: "Minimal risk — no specific obligations",
    summary: "Outside the Act's specific requirements. Voluntary codes of conduct are encouraged.",
    obligations: [
      "No mandatory AI Act obligations for this system.",
      "Keep the classification on file and revisit it if the use case changes.",
      "AI literacy duties still apply to staff operating AI systems (Art. 4).",
    ],
  },
};

/**
 * Turn answers into a proposed tier.
 *
 * Precedence is strict and deliberate: prohibited beats high-risk beats limited.
 * A later "yes" can never soften an earlier one, because the Act's prohibitions are
 * absolute rather than weighed against other factors.
 */
export function classify(answers: Record<string, boolean>) {
  const yes = (ids: TierQuestion[]) => ids.filter((q) => answers[q.id] === true);

  const prohibited = yes(PROHIBITED);
  if (prohibited.length) {
    return {
      tier: "unacceptable" as RiskTier,
      reasons: prohibited.map((q) => ({ id: q.id, citation: q.citation, question: q.question })),
      fria_required: false,   // moot: it must not be deployed at all
    };
  }

  const high = yes(HIGH_RISK);
  if (high.length) {
    return {
      tier: "high" as RiskTier,
      reasons: high.map((q) => ({ id: q.id, citation: q.citation, question: q.question })),
      // Art. 27 attaches the FRIA duty to public bodies and essential-service
      // operators, not to every high-risk deployer.
      fria_required: answers.c1 === true,
    };
  }

  const limited = yes(TRANSPARENCY);
  if (limited.length) {
    return {
      tier: "limited" as RiskTier,
      reasons: limited.map((q) => ({ id: q.id, citation: q.citation, question: q.question })),
      fria_required: false,
    };
  }

  return {
    tier: "minimal" as RiskTier,
    reasons: [],
    fria_required: false,
  };
}

// ── FRIA — Article 27 ────────────────────────────────────────────────────────
export interface FriaQuestion {
  id: string;
  citation: string;
  prompt: string;
  help: string;
  /** Long-form answer vs a short list. */
  kind: "text" | "list";
}

export const FRIA_QUESTIONS: FriaQuestion[] = [
  {
    id: "f1",
    citation: "Art. 27(1)(a)",
    prompt: "Describe the process in which the system will be used",
    help: "Where it sits in the workflow, what decision it contributes to, and what happens next.",
    kind: "text",
  },
  {
    id: "f2",
    citation: "Art. 27(1)(b)",
    prompt: "Over what period, and how often, will the system be used?",
    help: "Duration of deployment and expected frequency — per day, per case, per applicant.",
    kind: "text",
  },
  {
    id: "f3",
    citation: "Art. 27(1)(c)",
    prompt: "Which categories of people and groups are affected, and roughly how many?",
    help: "Include anyone indirectly affected, and note vulnerable groups specifically.",
    kind: "text",
  },
  {
    id: "f4",
    citation: "Art. 27(1)(c)",
    prompt: "Which fundamental rights could be affected?",
    help: "For example human dignity, non-discrimination, privacy and data protection, effective remedy, workers' rights, rights of the child.",
    kind: "list",
  },
  {
    id: "f5",
    citation: "Art. 27(1)(d)",
    prompt: "What specific harms could occur, including when the system is wrong?",
    help: "Be concrete: a wrongly rejected application, a missed safety condition, unequal outcomes for a group.",
    kind: "text",
  },
  {
    id: "f6",
    citation: "Art. 27(1)(e)",
    prompt: "What human oversight is in place?",
    help: "Who reviews outputs, what authority they have to override, and how a decision is escalated.",
    kind: "text",
  },
  {
    id: "f7",
    citation: "Art. 27(1)(f)",
    prompt: "What will you do if those risks materialise?",
    help: "Internal governance route, complaint handling, and how affected people obtain redress.",
    kind: "text",
  },
  {
    id: "f8",
    citation: "Art. 27(4)",
    prompt: "Reference to the related data protection impact assessment (DPIA)",
    help: "The FRIA complements the GDPR DPIA rather than replacing it — reference the existing one.",
    kind: "text",
  },
  {
    id: "f9",
    citation: "Art. 26(11)",
    prompt: "How are affected people informed that a high-risk AI system is used in decisions about them?",
    help: "The wording used and where it appears.",
    kind: "text",
  },
  {
    id: "f10",
    citation: "Art. 27(1)(d)",
    prompt: "What mitigations reduce the identified risks?",
    help: "Bias testing, sampling review, thresholds requiring human sign-off, restricting scope of use.",
    kind: "list",
  },
];

/**
 * FRIA completeness. Deliberately not a pass mark: a FRIA is a document a person
 * writes and defends, so we report what is still blank rather than declaring it
 * adequate.
 */
export function friaCompleteness(answers: Record<string, string>) {
  const answered = FRIA_QUESTIONS.filter((q) => String(answers?.[q.id] || "").trim().length >= 10);
  const missing = FRIA_QUESTIONS.filter((q) => !answered.includes(q)).map((q) => ({
    id: q.id, citation: q.citation, prompt: q.prompt,
  }));
  return {
    answered: answered.length,
    total: FRIA_QUESTIONS.length,
    percent: Math.round((answered.length / FRIA_QUESTIONS.length) * 100),
    missing,
    complete: missing.length === 0,
  };
}
