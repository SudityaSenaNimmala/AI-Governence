#!/usr/bin/env node
//
// Simple terminal chatbot — for testing the CloudFuze AI Governance SDK.
//
// This calls the real OpenAI API and reports every exchange back to your
// AI Hub SDK / Traces page using @cloudfuze/ai-gov-sdk, exactly the way a
// real customer's app would. Unlike sdk-js/examples/demo.mjs, this one makes
// a REAL model call, so it costs a small amount of real OpenAI credit per
// message (gpt-4o-mini is cheap — a short test conversation is a fraction of
// a cent).
//
// ── Setup ───────────────────────────────────────────────────────────────────
//
// Required environment variables:
//   OPENAI_API_KEY        your real OpenAI key (starts with "sk-")
//   CF_AIGOV_URL          e.g. http://localhost:8787
//   CF_AIGOV_PUBLIC_KEY   from AI Hub → SDK → Projects (starts with "pk-lf-")
//   CF_AIGOV_SECRET_KEY   from AI Hub → SDK → Projects (starts with "sk-lf-")
//
// Optional:
//   OPENAI_MODEL          defaults to "gpt-4o-mini"
//
// The safest way to set these is a local .env file (see .env.example in this
// folder) that you edit yourself in your editor — that way the real key is
// never typed into a chat with anyone, including an AI assistant. Then run:
//
//   node --env-file=.env chatbot.mjs        (Node 20.6+)
//
// Or, if your Node is older, set them inline on the command line yourself,
// directly in your own terminal — not by asking someone else to type it for
// you:
//
//   OPENAI_API_KEY=sk-... CF_AIGOV_URL=http://localhost:8787 \
//   CF_AIGOV_PUBLIC_KEY=pk-lf-... CF_AIGOV_SECRET_KEY=sk-lf-... \
//   node chatbot.mjs
//
// ── Using it ─────────────────────────────────────────────────────────────────
//
// Type a message and press Enter. Type "exit" (or Ctrl+C) to end the
// conversation — that's when the whole session gets flushed to AI Hub as one
// trace, with one "generation" per message you sent.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CloudFuzeTracer } from '../sdk-js/src/index.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CF_AIGOV_URL = process.env.CF_AIGOV_URL;
const CF_AIGOV_PUBLIC_KEY = process.env.CF_AIGOV_PUBLIC_KEY;
const CF_AIGOV_SECRET_KEY = process.env.CF_AIGOV_SECRET_KEY;

const missing = [
  !OPENAI_API_KEY && 'OPENAI_API_KEY',
  !CF_AIGOV_URL && 'CF_AIGOV_URL',
  !CF_AIGOV_PUBLIC_KEY && 'CF_AIGOV_PUBLIC_KEY',
  !CF_AIGOV_SECRET_KEY && 'CF_AIGOV_SECRET_KEY',
].filter(Boolean);
if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
  console.error('See the top of this file, or Test/.env.example, for how to set them.');
  process.exit(1);
}

const tracer = new CloudFuzeTracer({
  baseUrl: CF_AIGOV_URL,
  publicKey: CF_AIGOV_PUBLIC_KEY,
  secretKey: CF_AIGOV_SECRET_KEY,
  environment: 'test',
});

async function askOpenAI(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI request failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  console.log(`CloudFuze SDK test chatbot — model: ${OPENAI_MODEL}`);
  console.log(`Reporting to: ${CF_AIGOV_URL}`);
  console.log('Type a message, or "exit" to quit.\n');

  const rl = createInterface({ input: stdin, output: stdout });
  const trace = tracer.startTrace({ name: 'sdk-test-chatbot', environment: 'test' });
  const history = [{ role: 'system', content: 'You are a concise, friendly test assistant.' }];
  let turns = 0;
  let closed = false;
  let shuttingDown = false;

  // readline auto-closes when its input stream ends (e.g. piped input running
  // out, or the terminal disconnecting) — that can happen WHILE an OpenAI call
  // from the previous turn is still in flight. Without this flag, the next
  // rl.question() throws ERR_USE_AFTER_CLOSE and crashes the whole process
  // (confirmed: it did, and it took an already-recorded exchange down with it
  // since the crash happened before the flush at the bottom of this function
  // ever ran). Checking `closed` after every await, instead of relying on
  // question() to throw, means the loop exits cleanly no matter when the
  // stream closes.
  rl.on('close', () => { closed = true; });

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    trace.update({ output: `${turns} message(s) exchanged.` });
    await tracer.flush();
    console.log('\nSession saved. Check AI Hub → SDK → Traces to see it.');
    rl.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown); // Ctrl+C still reports what happened so far

  while (!closed) {
    let input;
    try {
      input = await rl.question('You: ');
    } catch {
      break; // interface closed while we were waiting for input
    }
    if (closed) break;
    if (input.trim().toLowerCase() === 'exit') break;
    if (!input.trim()) continue;

    history.push({ role: 'user', content: input });
    const gen = trace.startGeneration({
      name: 'chat-turn',
      model: OPENAI_MODEL,
      input: history,
    });

    try {
      const completion = await askOpenAI(history);
      const reply = completion.choices?.[0]?.message?.content ?? '(no reply)';
      history.push({ role: 'assistant', content: reply });
      gen.end({
        output: reply,
        usage: {
          input: completion.usage?.prompt_tokens,
          output: completion.usage?.completion_tokens,
        },
      });
      console.log(`Bot: ${reply}\n`);
      turns += 1;
    } catch (err) {
      gen.end({ output: `ERROR: ${err.message}`, level: 'ERROR' });
      console.error(`Error: ${err.message}\n`);
    }

    // Flush after every single turn, not just at the end. A turn that already
    // happened — the real OpenAI call already cost real money — must not be
    // lost to a crash, a closed stream, or someone killing the terminal a
    // moment later. This is the fix for the data loss we just saw.
    await tracer.flush();
  }

  await shutdown();
}

main();
