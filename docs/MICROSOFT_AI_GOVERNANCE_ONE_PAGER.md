# CloudFuze AI Governance for Microsoft

**One-pager for prospect conversations.** Plain language, no technical detail.
Written against what the product does today — the limitations section is honest on
purpose, so nothing here has to be walked back in a security review.

---

## The problem we solve

Your people are building AI agents inside Microsoft faster than IT can track them.
A marketing manager builds a Copilot Studio agent that reads the CRM. A developer
spins up an Azure AI Foundry model. Someone installs a third-party AI app from the
Teams store. Each one can reach company data, and most were never reviewed.

Then the person who built it leaves the company — and the agent keeps running, with
their access, and nobody owns it.

Microsoft gives you pieces of this picture across five or six admin centres.
Nobody has the whole list in one place, with a risk rating and an owner's name
against each item.

**That list is what we provide.**

---

## What we find in your Microsoft tenant

We connect once, read-only, and produce a single inventory of every AI agent and
AI-connected app across:

| What we discover | Where it lives |
|---|---|
| **Copilot Studio agents** | The custom agents your teams build, including drafts |
| **Microsoft 365 Copilot agents** | Declarative agents and Copilot extensions |
| **Personal Copilot agents** | Agents individual employees created for themselves |
| **Teams apps and bots** | From your app catalogue and what users actually installed |
| **SharePoint agents** | Agents attached to specific SharePoint sites |
| **Azure AI Foundry** | Model deployments and AI resources in your Azure subscriptions |
| **Azure OpenAI assistants** | Assistants created against your Azure OpenAI service |
| **Entra agent identities** | The new agent identity objects Microsoft is rolling out |
| **Power Automate flows** | Automations that call AI services |
| **Third-party AI apps** | Store apps and any external AI tool an employee connected to their work account — ChatGPT, Claude, and others |

That last row matters more than people expect. Employees connect outside AI tools
to their Microsoft account without asking anyone. Those connections are visible to
us because the permission grant lives in your tenant.

---

## What we tell you about each one

For every agent we find:

- **Who owns it** — resolved to a real person, by name
- **Whether the owner still works there** — if their account is disabled, we mark the
  agent orphaned and escalate it
- **What it can reach** — which connectors and permissions it holds, and whether
  consent was granted for the whole organisation or just one user
- **Whether anyone uses it** — how many times, by how many people, when it was last
  active, and which specific employees use it most
- **A risk score with reasons** — not a black box. Every score lists the signals
  behind it: no owner, organisation-wide consent, external data connector, broad
  permissions, guest access, dormant but still privileged, never reviewed,
  overdue for renewal
- **Where it is in its life** — awaiting approval, active, due for renewal, dormant,
  suspended, or retired

---

## What you can do about it

**Set rules once, applied continuously.** For example: escalate any orphaned agent;
flag anything with organisation-wide consent; review agents dormant for 90 days that
still hold permissions. Rules run on every scan and raise violations against the
specific agent.

**Deploy a compliance framework in one click.** We ship ready-made rule bundles for
GDPR, HIPAA, SOC 2, CCPA/CPRA, the EU AI Act, ISO/IEC 42001 and the NIST AI RMF —
109 rules in total, each tied to the clause it satisfies so an auditor can follow it. What normally takes
weeks of writing rules takes minutes.

**Recertification.** Owners are asked to confirm periodically that their agent is
still needed. Anything unconfirmed becomes visible instead of quietly persisting.

**Stop sensitive data reaching AI tools.** On machines where our endpoint software is
installed, we detect credentials, customer records and personal data being pasted or
typed into AI tools — including Microsoft Copilot — and can block the send before it
leaves. Prompt content stays on the machine; we record what type of data it was, not
the text.

**Cost and usage per person.** Which employees use which AI tools, how much, and what
it costs — down to the individual, not just the department.

---

## What it takes to get started

One read-only connection to Microsoft, approved by an admin. No agents to install in
Azure, nothing deployed into your tenant, no changes to how Copilot works. First
inventory typically within the same session.

The endpoint software for prompt-level protection is a separate, optional install on
staff machines.

---

## Limitations — read this before you promise anything

**We report and alert; we do not switch Microsoft agents off.**
Our Microsoft connection is read-only. When a policy "suspends" an agent, we mark it
suspended in CloudFuze, raise the violation and notify the owner — an administrator
then acts in Microsoft. We do not delete or disable anything in your tenant. This is
deliberate: read-only access is far easier to get approved, and most customers do not
want a third-party tool with permission to disable production agents. If a prospect
expects one-click kill from our console, set that expectation now.

**Some discovery uses Microsoft preview APIs.**
Newer surfaces — Microsoft 365 Copilot agents, Entra agent identities — are only
available through Microsoft endpoints still in preview. Microsoft can change or
withdraw those, and availability differs by tenant and licence. Where an endpoint is
unavailable we skip it and report what we did find, rather than failing the scan.
Expect coverage on these specific surfaces to move as Microsoft ships.

**Usage data depends on your licences and log retention.**
Sign-in and audit history need the appropriate Entra ID licence, and Microsoft only
retains those logs for a limited window. Without them we still show the agent, its
owner and its permissions — but "who used it and how often" may be thin or missing.
Worth confirming a prospect's licence level early.

**Connector destinations are not always visible.**
We can tell you an agent has an external data connector. Microsoft does not always
expose exactly which external address it sends to, so for some agents we can say
"this reaches outside your tenant" without naming the destination.

**Prompt-level protection is per machine, not tenant-wide.**
Detecting and blocking sensitive data in prompts requires our browser extension or
desktop software on that machine. There is no Microsoft API that lets us inspect
Copilot prompts tenant-wide. Coverage equals installs — so an employee on an
unmanaged personal device is not covered. The agent inventory needs no installs; only
prompt protection does.

**Not every compliance rule can be automatic.**
Of the 109 framework rules, roughly a third are checked automatically against your
agents. Another group depends on endpoint detection. The remainder are controls
software cannot decide — whether a Business Associate Agreement is signed, whether a
Data Processing Agreement is on file. We track those as attestations with a named
owner and evidence. We never mark them satisfied on their own, because an auditor
will ask for the evidence.

**Cost figures are close, not invoices.**
We calculate cost from measured token usage and published rates. Treat it as an
accurate management view of consumption and trend, not a reconciliation of your
Microsoft bill.

---

## The one-sentence version

Every AI agent in your Microsoft tenant, who owns it, what it can reach, whether
anyone still uses it, and which compliance rules it breaks — in one list, from a
read-only connection, on day one.
