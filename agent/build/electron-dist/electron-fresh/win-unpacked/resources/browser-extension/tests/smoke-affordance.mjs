// Smoke test for the AI-affordance regex. Verifies the matcher fires on
// known AI-trigger UI text and doesn't fire on benign buttons.

const STRONG_AI_PHRASE = new RegExp(
  [
    'ask ai\\b', 'ask copilot\\b', 'ask gemini\\b',
    'ai assistant\\b', 'ai chat\\b', 'ai mode\\b', 'ai suggest', 'ai write\\b',
    'ai prompt\\b', 'ai response\\b',
    'help me (write|draft|reply|respond|compose|brainstorm)',
    'summarize with ai\\b', 'rewrite with ai\\b', 'improve with ai\\b',
    'draft with ai\\b', 'explain with ai\\b',
    'use ai\\b', 'with ai\\b',
    'open copilot\\b', 'copilot chat\\b',
    'duet ai\\b', 'gitlab duo\\b',
    'einstein\\b', 'gemini\\b',
  ].join('|'),
  'i',
);
const AI_DATA_HINT = /(^|[-_])(ai|copilot|assistant|gemini|einstein|llm|gpt|claude)([-_]|$)/i;
const AI_VERB      = /\b(generate|write|draft|reply|respond|compose|summarize|improve|rewrite|suggest|fix|explain|brainstorm|magic)\b/i;
const SPARKLE      = /✨|sparkle|stars/i;

function check({ text = '', aria = '', data = '', cls = '' }) {
  const blob = text + ' ' + aria + ' ' + cls;
  if (STRONG_AI_PHRASE.test(blob)) return 'phrase';
  if (AI_DATA_HINT.test(data) && AI_VERB.test(blob)) return 'data+verb';
  if ((SPARKLE.test(cls) || SPARKLE.test(text)) && AI_VERB.test(blob)) return 'sparkle+verb';
  return null;
}

const POSITIVE = [
  { text: 'Ask AI',                                                   want: 'phrase' },
  { text: 'Ask Copilot',                                              want: 'phrase' },
  { text: 'AI Assistant',                                             want: 'phrase' },
  { text: 'Help me write',                                            want: 'phrase' },
  { text: 'Help me draft a reply',                                    want: 'phrase' },
  { text: 'Summarize with AI',                                        want: 'phrase' },
  { text: 'Improve with AI',                                          want: 'phrase' },
  { text: 'Open Copilot',                                             want: 'phrase' },
  { text: 'Gemini',                                                   want: 'phrase' },
  { text: 'Einstein Copilot',                                         want: 'phrase' },
  { text: 'GitLab Duo Chat',                                          want: 'phrase' },
  { text: '✨ Generate',                                              want: 'sparkle+verb' },
  { text: '✨ Rewrite',                                               want: 'sparkle+verb' },
  { text: 'Write reply',  data: 'cf-ai-button=true',                  want: 'data+verb' },
  { text: 'Generate',     data: 'data-copilot-trigger=true',          want: 'data+verb' },
  { text: 'Suggest',      data: 'assistant-action=suggest',           want: 'data+verb' },
  { text: 'Improve',      cls: 'sparkles-button',                     want: 'sparkle+verb' },
];

const NEGATIVE = [
  { text: 'Send' },
  { text: 'Submit' },
  { text: 'Save' },
  { text: 'Generate report' },
  { text: 'Compose new message' },
  { text: 'Reply' },
  { text: 'New issue' },
  { text: 'Insert image' },
  { text: 'AI for science fiction' },     // 'AI' as topic, not trigger
  { text: 'Copilot dataset description' },// 'copilot' as word, no verb
];

let pass = 0, fail = 0;
for (const t of POSITIVE) {
  const r = check(t);
  if (r === t.want) { pass++; console.log('  ok   POSITIVE', JSON.stringify(t), '→', r); }
  else { fail++; console.log('  FAIL POSITIVE', JSON.stringify(t), 'expected', t.want, 'got', r); }
}
for (const t of NEGATIVE) {
  const r = check(t);
  if (r === null) { pass++; console.log('  ok   NEGATIVE', JSON.stringify(t), '→ no match'); }
  else { fail++; console.log('  FAIL NEGATIVE', JSON.stringify(t), 'should be null, got', r); }
}
console.log(`\n${fail === 0 ? 'ALL OK' : 'FAIL'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
