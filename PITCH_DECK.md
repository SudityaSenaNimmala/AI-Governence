# CloudFuze AI Governance
## Sales Pitch Deck — Demo Edition

---

## SLIDE 1 — Title

# CloudFuze AI Governance
### See Every AI Tool. Control Every Prompt. Protect Every Secret.

**The only enterprise platform that governs AI activity across the browser, desktop, and CLI — from a single dashboard.**

---

## SLIDE 2 — The World Has Changed Overnight

> **"ChatGPT has more daily active users than Google had in its first five years."**

In the last 18 months, employees at every company have started using AI tools — **without asking IT.**

- Developers pasting code (and API keys) into ChatGPT
- Sales reps uploading customer lists into Claude
- Finance teams asking Gemini to review contract terms
- Engineers using GitHub Copilot, Cursor, and AI agents autonomously

**Your security team has zero visibility into any of it.**

---

## SLIDE 3 — The Risk Is Real and Happening Now

### What keeps CISOs up at night:

| Scenario | Consequence |
|---|---|
| Employee pastes AWS access key into ChatGPT | Credentials potentially in OpenAI's training data |
| Sales uploads CRM export to Claude for "analysis" | 50,000 customer records leave the org |
| Developer asks Copilot to review internal auth code | Proprietary IP sent to Microsoft |
| AI agent autonomously browses and executes code | No audit trail, no accountability |

### The compliance exposure:
- **GDPR / CCPA** — personal data transferred to third-party AI vendors without DPA
- **SOC 2 / ISO 27001** — no evidence of data handling controls
- **HIPAA** — PHI in prompts = breach notification requirement
- **Finance regulations** — material non-public information sent to LLMs

**Most companies are already in violation. They just don't know it yet.**

---

## SLIDE 4 — Existing Tools Don't Solve This

| Tool | What It Covers | What It Misses |
|---|---|---|
| **DLP (Symantec, Forcepoint)** | Email, file transfers | Browser AI activity, desktop apps |
| **CASB (Netskope, Zscaler)** | Web traffic at the network | Encrypted traffic, desktop apps, local agents |
| **Endpoint DLP (CrowdStrike)** | Files on disk | Real-time prompt interception |
| **Nightfall.ai** | Some SaaS integrations | ChatGPT desktop, Claude desktop, CLI agents |

### The gap nobody is solving:
✗ The ChatGPT Desktop App — 15M+ installs  
✗ Claude Desktop — Anthropic's fastest-growing product  
✗ Cursor, GitHub Copilot — used by every engineering team  
✗ AI CLI agents (Claude Code, Aider) — no governance at all

---

## SLIDE 5 — Introducing CloudFuze AI Governance

**One platform. Three layers of coverage. Zero workflow disruption.**

```
┌─────────────────────────────────────────────────────────────┐
│                CloudFuze AI Governance                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Browser    │  │   Desktop    │  │   CLI / Agent    │  │
│  │  Extension   │  │ App Hook     │  │   Monitor        │  │
│  │              │  │              │  │                  │  │
│  │  ChatGPT.com │  │ ChatGPT App  │  │  Claude Code     │  │
│  │  Claude.ai   │  │ Claude App   │  │  Cursor          │  │
│  │  Gemini      │  │ Cursor IDE   │  │  Aider / Cline   │  │
│  │  Copilot     │  │ Copilot App  │  │  OpenClaw        │  │
│  │  + 30 more   │  │ + more       │  │  Custom agents   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │  Dashboard  │                          │
│                    │  + Alerts   │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## SLIDE 6 — What We Do: The Three Pillars

### 1. DISCOVER — Know Every AI Tool in Your Org
- Automatically inventory all AI tools: desktop apps, browser visits, IDE extensions, API keys, running agents
- Shadow AI discovery: catch tools that aren't approved but are being used
- Real-time AI app registry with vendor, category, and risk classification

### 2. DETECT — See Every Sensitive Data Exposure
- Intercept prompts and file uploads **before** they reach the AI service
- Scan for: API keys, AWS credentials, SSNs, credit cards, PII, IBAN, internal IDs
- File upload scanning: PDF, Excel, DOCX, images (OCR), ZIP archives
- Full prompt text captured for compliance audit trail

### 3. GOVERN — Block, Alert, and Report
- **Block in real-time**: Modal popup stops the send and explains why
- **Native notifications**: Windows Action Center alert, even when app is minimized
- **Dashboard**: Every event, every user, every AI service — searchable and filterable
- **Policy engine**: Approved / restricted / blocked per-tool, per-team

---

## SLIDE 7 — Live Demo: What You're About to See

### Demo scenario: "The Developer Mistake"

A developer is using ChatGPT Desktop to ask for a code review. They accidentally paste:
- An OpenAI API key (`sk-...`)
- An AWS Access Key ID (`AKIA...`)
- A Social Security Number (`123-45-6789`)

**Watch CloudFuze:**

1. **Intercept** the prompt before it reaches OpenAI's servers
2. **Show a block modal** inside ChatGPT explaining what was detected
3. **Fire a Windows notification** visible across the desktop
4. **Log the event** in the governance dashboard with full prompt preview
5. **Attribute it** to the machine, user, and AI tool

**The same works in Claude Desktop, and in the browser on Claude.ai, ChatGPT.com, Gemini, Copilot, and 30+ more AI services.**

---

## SLIDE 8 — The Dashboard: Governance at a Glance

### What security teams see every morning:

```
┌─────────────────────────────────────────────────────────────┐
│  AI Activity — Last 30 Days                                  │
│                                                              │
│  Prompt Events: 12,847    File Uploads: 2,341                │
│  High/Critical:   847     Machines: 234 / 1,200              │
│                                                              │
│  Top AI Services by Usage:                                   │
│  1. ChatGPT (web)      4,221 events   87 sensitive           │
│  2. GitHub Copilot     3,102 events   12 sensitive           │
│  3. Claude (desktop)   2,891 events   134 sensitive ⚠        │
│  4. Gemini             1,847 events   8 sensitive            │
│                                                              │
│  Recent Critical Events:                                     │
│  ● 14:22 — AWS key in ChatGPT prompt — john.smith@co.com     │
│  ● 13:15 — .env file uploaded to Claude — dev-team           │
│  ● 11:40 — SSN in Copilot context — hr-dept                  │
└─────────────────────────────────────────────────────────────┘
```

---

## SLIDE 9 — Why CloudFuze Wins on Coverage

| Capability | CloudFuze | Nightfall | Netskope | CASB/DLP |
|---|:---:|:---:|:---:|:---:|
| ChatGPT **web** (browser) | ✅ | ✅ | ✅ | ✅ |
| ChatGPT **desktop app** | ✅ | ❌ | ❌ | ❌ |
| Claude **desktop app** | ✅ | ❌ | ❌ | ❌ |
| Cursor / VS Code Copilot | ✅ | ❌ | ❌ | ❌ |
| CLI agents (Claude Code, Aider) | ✅ | ❌ | ❌ | ❌ |
| File upload scanning (PDF/Excel/OCR) | ✅ | ✅ | Partial | ❌ |
| **Real-time block in the app** | ✅ | ❌ | ❌ | ❌ |
| Shadow AI discovery | ✅ | ❌ | Partial | ❌ |
| Cost & usage attribution | ✅ | ❌ | ❌ | ❌ |

**CloudFuze is the only solution that governs AI at the point of interaction — inside the app, before the data leaves.**

---

## SLIDE 10 — How It Gets Deployed

### Under 30 minutes from zero to governed fleet

```
Step 1 (5 min):   Deploy the governance server
                  → Docker container, your cloud or on-prem

Step 2 (10 min):  Push the agent to employee machines
                  → MSI via Intune / SCCM / any MDM

Step 3 (5 min):   Publish the browser extension
                  → Chrome/Edge enterprise policy push

Step 4 (instant): First scan runs automatically
                  → Full AI inventory in the dashboard

Step 5 (5 min):   Set your policy
                  → Approve / restrict / block tools per team
```

**No network reconfiguration. No certificate deployment. No VPN dependency.**

The agent is a ~10MB binary. It runs as a Windows service. Employees never notice it.

---

## SLIDE 11 — Built for Enterprise

### Security & Privacy — what we capture vs. what we don't

| ✅ We capture | ❌ We never capture |
|---|---|
| Prompt text sent to AI services | Keystrokes |
| Filenames and file classes | Screenshots |
| Pattern match counts (API key, SSN, etc.) | Browser history (non-AI sites) |
| Which AI tool was used | Passwords |
| Machine ID + hostname | Personal emails or files |

**Employee disclosure template included.** Legal and HR sign-off process documented. Privacy-by-design from day one.

### Data stays in your control
- All data stored on your infrastructure (SQLite → Postgres for scale)
- No telemetry to CloudFuze
- Air-gapped deployment available

---

## SLIDE 12 — Use Cases by Buyer

### 🔐 CISO / Security Team
> "I need to know if employees are sending customer data to AI tools."

→ Shadow AI discovery + DLP events + blocking policy + audit trail

### ⚖️ Compliance / Legal
> "We need evidence that AI data handling meets GDPR/CCPA/HIPAA."

→ Full event log, machine attribution, policy enforcement records

### 🏗️ IT / Infrastructure
> "I need to approve which AI tools are allowed and block the rest."

→ AI app registry, sanction/block per-tool, MDM-deployable agent

### 💰 Finance / Risk
> "What is our AI spend and where is it going?"

→ API cost attribution by tool, user, and team

---

## SLIDE 13 — Traction & Proof Points

### Built for real enterprise scenarios
- ✅ ChatGPT Desktop (Store + installer) — governed
- ✅ Claude Desktop — governed
- ✅ 30+ AI web services — governed via browser extension
- ✅ Cursor, GitHub Copilot, Cline — IDE agents governed
- ✅ PDF / Excel / DOCX file upload scanning with OCR
- ✅ ZIP archive deep scan (up to 100 nested files)
- ✅ Legal and HR disclosure documentation ready

### Built by CloudFuze
CloudFuze has 10+ years of experience in enterprise data governance and cloud migration. AI Governance is the natural extension of our data protection platform.

---

## SLIDE 14 — Pricing Model

### Simple, predictable, seat-based

| Tier | What's included |
|---|---|
| **Starter** (up to 100 seats) | Browser extension + Dashboard + Basic DLP |
| **Business** (100–500 seats) | + Desktop app hooks + CLI agent monitoring |
| **Enterprise** (500+ seats) | + Custom policies + API + Priority support + On-prem |

*All tiers include the governance server, agent, and browser extension.*

**Early customer pricing available for pilot participants.**

---

## SLIDE 15 — The Ask

### What we're looking for:

**1. Pilot program** — 30-day deployment, 20–50 employees, full support included

**2. Design partners** — shape the product roadmap, preferred pricing for life

**3. Introductions** — if this isn't your decision, who in your org owns AI security?

---

### The question to ask your team today:

> *"Do we know what AI tools our employees are using, and what data they're sending to them?"*

**If the answer is no — you need CloudFuze AI Governance.**

---

## SLIDE 16 — Contact & Next Steps

**CloudFuze AI Governance**

📧 Satya Pinniti — satya.pinniti@cloudfuze.com  
🌐 cloudfuze.com  

**Pilot program:** 30 days, fully supported, no commitment required.

---

*"The question is no longer whether your employees are using AI.  
The question is whether you know what they're doing with it."*

---

**[END OF DECK]**

---

## APPENDIX — Technical FAQ for the IT/Security Audience

**Q: Does the agent require admin rights to install?**  
A: Yes, initial install requires admin (MSI deploys via Intune/SCCM). After install, the service runs as a standard Windows service account.

**Q: What happens if the server goes down?**  
A: The browser extension queues events locally (up to 1,000) and flushes on reconnect. The desktop hook continues to block sensitive data locally — no server dependency for enforcement.

**Q: Does it work on Mac?**  
A: Browser extension is Chrome/Edge (cross-platform). Desktop app hooks are Mac-compatible (Claude.app, ChatGPT.app). Mac agent in roadmap.

**Q: How does it handle ChatGPT TLS pinning?**  
A: ChatGPT pins its TLS certificate, so our HTTPS proxy routes around it using a socket bridge. The desktop app hook and browser extension provide equivalent coverage without touching the network stack.

**Q: What AI tools are supported out of the box?**  
A: 63 platforms in the built-in registry including OpenAI, Anthropic, Google, Microsoft Copilot, Cursor, Windsurf, Devin, Factory.AI, Ollama, and more. New tools can be added via the admin dashboard in 30 seconds.
