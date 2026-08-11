# SDK test chatbot

A small terminal chatbot that calls the real OpenAI API and reports every
message to AI Hub → SDK → Traces, using the CloudFuze SDK
(`../sdk-js`) exactly the way a real customer's app would.

Unlike `sdk-js/examples/demo.mjs` (which fakes everything), this one makes
real OpenAI calls — real replies, real token counts, real (small) cost.

## 1. Get your two AI Hub keys

Go to **AI Hub → SDK → Projects** in the app, click **New project**, and copy
the `public_key` and `secret_key` shown.

## 2. Set up your OpenAI key safely

**Do not paste your real OpenAI key into a chat with anyone — including an AI
assistant.** Set it up yourself, locally:

```
cp .env.example .env
```

Then open `.env` in your own editor and fill in the real values:
- `OPENAI_API_KEY` — your real OpenAI key
- `CF_AIGOV_PUBLIC_KEY` / `CF_AIGOV_SECRET_KEY` — from step 1
- `CF_AIGOV_URL` — leave as `http://localhost:8787` if testing on this same computer

`.env` is already excluded from git (see `.gitignore`) — it will never get
committed or shared by accident.

## 3. Run it

If your Node.js is 20.6 or newer:
```
node --env-file=.env chatbot.mjs
```

If that flag isn't recognized (older Node), set the same values inline
yourself, directly in your own terminal:
```
OPENAI_API_KEY=sk-... CF_AIGOV_URL=http://localhost:8787 CF_AIGOV_PUBLIC_KEY=pk-lf-... CF_AIGOV_SECRET_KEY=sk-lf-... node chatbot.mjs
```

## 4. Chat, then check AI Hub

Type a few messages. Type `exit` (or press Ctrl+C) when done — that's when
the conversation gets sent as one trace, with one recorded "generation" per
message you sent.

Then go to **AI Hub → SDK → Traces**, pick this project, and you'll see the
session — real token counts, real cost, and each back-and-forth as a separate
step you can click into.
