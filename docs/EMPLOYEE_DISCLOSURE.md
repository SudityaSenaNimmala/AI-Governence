# Employee Disclosure — CloudFuze AI Governance Agent

**Effective date:** _[to be filled at deployment]_
**Owner:** Satya Pinniti, AI Governance
**Approved by:** CloudFuze Legal

> This document MUST be reviewed by HR and Legal before rollout. Wording below is
> a starting draft, not final legal text.

## What is this?

CloudFuze is rolling out an internal AI & Agent Governance program. As part of
this program, a small software agent will run on your work computer to help us
understand which AI tools and AI assistants are in use across the company.

This is **not** a productivity-monitoring tool. It is an inventory tool, similar
to the asset-management software IT already runs on your machine.

## What the agent collects

The agent reports the following back to CloudFuze's internal governance system:

- Names and versions of AI-related applications installed (e.g. ChatGPT desktop,
  Claude desktop, Cursor, GitHub Copilot, etc.).
- AI extensions installed in your IDE (VS Code, Cursor, JetBrains, etc.).
- Configuration directories for AI coding assistants (e.g. `.cursor/`, `.claude/`).
- AI services your browser has visited (e.g. `chatgpt.com`, `gemini.google.com`),
  along with the **domain** and visit count — never the page content, never the
  URL query string.
- Presence (not value) of AI provider API keys in `.env` files and dotfiles.
  We record the provider name and a 6-character fingerprint, never the full key.
- Names of folders that look like AI agent projects (containing references to
  LangChain, AutoGen, OpenAI SDK, Anthropic SDK, etc.).

## What the agent does NOT collect

- The **content** of your AI prompts, conversations, or chats.
- The **values** of your API keys, passwords, or credentials.
- Your keystrokes, screenshots, microphone, webcam, or screen content.
- Browser history for non-AI websites.
- Files in your `Documents`, `Desktop`, `Pictures`, etc. — only AI-tool
  configuration locations are scanned.

## How file uploads to AI services are handled

When you upload a file to an AI service (ChatGPT, Claude, Gemini, etc.) through
your browser, the browser extension does the following **on your machine, in
your browser**:

1. Reads the filename, file size, and MIME type.
2. For text-readable files (e.g. `.env`, `.csv`, `.json`, source code, plain
   text, configuration files), **reads the file contents locally** and runs
   the same secret/PII pattern catalog used for prompts.
3. **Counts** the matches by category (e.g. "found 5 SSN patterns, 2 OpenAI
   API keys") — never the matched values themselves.
4. Sends to the governance server **only**: filename, size, MIME type, file
   category, the **count of matches per pattern**, and the severity tier.

The actual file contents — the text, the spreadsheet rows, the SSNs themselves
— **never leave your machine**. Binary files (PDFs, Word, Excel, archives,
images) are not opened or read; only their filename and size are recorded.

## Why we are doing this

The CEO has asked the AI Governance team to:

1. Understand which AI tools are being used so we can buy proper licenses,
   negotiate enterprise terms, and provide official support.
2. Identify any AI tools that handle customer data in ways that violate our
   security or compliance commitments.
3. Build a sanctioned-tools catalog so you have a clear answer to "is it OK
   to use X for work?".

## How the data is used

- Only the AI Governance team and a small number of Security/IT staff have
  access to per-employee data.
- Aggregated, anonymized data may be shared with leadership.
- We will **not** use this data for individual performance reviews.
- Data is retained for 24 months and then deleted.

## Your rights

- You can see the agent running in your system tray at any time.
- You can request a copy of what the agent has reported about your machine
  by emailing `ai-governance@cloudfuze.com`.
- You can request correction or deletion of incorrect data.
- If you have questions or concerns, please reach out to the AI Governance
  team or HR.

---

_By installing this agent or having it deployed to your work machine via IT,
you acknowledge that you have read and understood this notice. Continued use
of CloudFuze IT systems constitutes acceptance per the Employee Handbook
section §X.Y (Acceptable Use)._
