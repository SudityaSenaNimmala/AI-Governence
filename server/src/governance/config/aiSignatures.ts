import type { AiSignature } from "../types/agent.js";

export const aiSignatures: AiSignature[] = [
  {
    id: "openai-chatgpt",
    name: "ChatGPT (OpenAI)",
    vendor: "OpenAI",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "openai|chatgpt" },
      { field: "appDisplayName", pattern: "openai|chatgpt" },
      { field: "publisherName", pattern: "openai" },
    ],
    baseRiskLevel: "high",
    description: "General-purpose AI assistant with broad data access via copy-paste",
    icon: "MessageSquare",
  },
  {
    id: "microsoft-copilot",
    name: "Microsoft 365 Copilot",
    vendor: "Microsoft",
    category: "productivity-ai",
    matchPatterns: [
      { field: "displayName", pattern: "microsoft.*copilot|m365.*copilot|office.*copilot" },
      { field: "appDisplayName", pattern: "microsoft.*copilot|m365.*copilot" },
    ],
    knownAppIds: [
      "fb8d773d-7ef4-4c2f-b3b6-8b5a53e27c0c", // M365 Copilot
    ],
    baseRiskLevel: "medium",
    description: "Microsoft's embedded AI across Word, Excel, Teams, Outlook",
    icon: "Sparkles",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    vendor: "GitHub (Microsoft)",
    category: "code-assistant",
    matchPatterns: [
      { field: "displayName", pattern: "github.*copilot" },
      { field: "appDisplayName", pattern: "github.*copilot" },
      { field: "publisherName", pattern: "github" },
    ],
    baseRiskLevel: "medium",
    description: "AI code completion and chat for developers",
    icon: "Code",
  },
  {
    id: "anthropic-claude",
    name: "Claude (Anthropic)",
    vendor: "Anthropic",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "anthropic|claude" },
      { field: "appDisplayName", pattern: "anthropic|claude" },
      { field: "publisherName", pattern: "anthropic" },
    ],
    baseRiskLevel: "high",
    description: "General-purpose AI assistant",
    icon: "Bot",
  },
  {
    id: "google-gemini",
    name: "Gemini (Google)",
    vendor: "Google",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "gemini|google.*ai|bard" },
      { field: "appDisplayName", pattern: "gemini|google.*ai" },
      { field: "publisherName", pattern: "google" },
    ],
    baseRiskLevel: "high",
    description: "Google's AI assistant with broad capabilities",
    icon: "Gem",
  },
  {
    id: "cursor-ide",
    name: "Cursor IDE",
    vendor: "Anysphere",
    category: "code-assistant",
    matchPatterns: [
      { field: "displayName", pattern: "cursor" },
      { field: "appDisplayName", pattern: "cursor" },
      { field: "publisherName", pattern: "anysphere|cursor" },
    ],
    baseRiskLevel: "high",
    description: "AI-powered code editor with full codebase access",
    icon: "Terminal",
  },
  {
    id: "notion-ai",
    name: "Notion AI",
    vendor: "Notion",
    category: "productivity-ai",
    matchPatterns: [
      { field: "displayName", pattern: "notion" },
      { field: "appDisplayName", pattern: "notion" },
      { field: "publisherName", pattern: "notion" },
    ],
    baseRiskLevel: "medium",
    description: "AI features embedded in Notion workspace",
    icon: "FileText",
  },
  {
    id: "salesforce-einstein",
    name: "Salesforce Einstein",
    vendor: "Salesforce",
    category: "ai-platform",
    matchPatterns: [
      { field: "displayName", pattern: "salesforce.*einstein|einstein.*ai" },
      { field: "appDisplayName", pattern: "salesforce|einstein" },
      { field: "publisherName", pattern: "salesforce" },
    ],
    baseRiskLevel: "low",
    description: "AI features embedded in Salesforce CRM",
    icon: "Cloud",
  },
  {
    id: "grammarly",
    name: "Grammarly",
    vendor: "Grammarly",
    category: "productivity-ai",
    matchPatterns: [
      { field: "displayName", pattern: "grammarly" },
      { field: "appDisplayName", pattern: "grammarly" },
      { field: "publisherName", pattern: "grammarly" },
    ],
    baseRiskLevel: "medium",
    description: "AI writing assistant with access to typed content",
    icon: "PenTool",
  },
  {
    id: "perplexity",
    name: "Perplexity AI",
    vendor: "Perplexity",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "perplexity" },
      { field: "appDisplayName", pattern: "perplexity" },
      { field: "publisherName", pattern: "perplexity" },
    ],
    baseRiskLevel: "high",
    description: "AI-powered search and answer engine",
    icon: "Search",
  },
  {
    id: "codeium-windsurf",
    name: "Windsurf / Codeium",
    vendor: "Codeium",
    category: "code-assistant",
    matchPatterns: [
      { field: "displayName", pattern: "codeium|windsurf" },
      { field: "appDisplayName", pattern: "codeium|windsurf" },
      { field: "publisherName", pattern: "codeium|exafunction" },
    ],
    baseRiskLevel: "high",
    description: "AI code editor with full codebase access",
    icon: "Wind",
  },
  {
    id: "midjourney",
    name: "Midjourney",
    vendor: "Midjourney",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "midjourney" },
      { field: "appDisplayName", pattern: "midjourney" },
    ],
    baseRiskLevel: "medium",
    description: "AI image generation platform",
    icon: "Image",
  },
  {
    id: "jasper-ai",
    name: "Jasper AI",
    vendor: "Jasper",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "jasper" },
      { field: "appDisplayName", pattern: "jasper" },
      { field: "publisherName", pattern: "jasper" },
    ],
    baseRiskLevel: "medium",
    description: "AI content generation platform for marketing",
    icon: "Wand2",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    vendor: "Hugging Face",
    category: "ai-platform",
    matchPatterns: [
      { field: "displayName", pattern: "hugging.?face" },
      { field: "appDisplayName", pattern: "hugging.?face" },
      { field: "publisherName", pattern: "hugging.?face" },
    ],
    baseRiskLevel: "medium",
    description: "AI model hub and deployment platform",
    icon: "Cpu",
  },
  {
    id: "copilot-studio",
    name: "Copilot Studio",
    vendor: "Microsoft",
    category: "custom-agent",
    matchPatterns: [
      { field: "displayName", pattern: "copilot.*studio|power.*virtual.*agent" },
      { field: "appDisplayName", pattern: "copilot.*studio" },
    ],
    baseRiskLevel: "low",
    description: "Microsoft's low-code agent builder",
    icon: "Blocks",
  },
  {
    id: "power-automate",
    name: "Power Automate",
    vendor: "Microsoft",
    category: "custom-agent",
    matchPatterns: [
      { field: "displayName", pattern: "power.*automate|flow" },
      { field: "appDisplayName", pattern: "power.*automate" },
    ],
    baseRiskLevel: "low",
    description: "Microsoft automation platform with AI capabilities",
    icon: "Zap",
  },
  {
    id: "stability-ai",
    name: "Stable Diffusion / Stability AI",
    vendor: "Stability AI",
    category: "generative-ai",
    matchPatterns: [
      { field: "displayName", pattern: "stability|stable.?diffusion" },
      { field: "publisherName", pattern: "stability" },
    ],
    baseRiskLevel: "medium",
    description: "AI image generation models",
    icon: "Palette",
  },
];

// Microsoft first-party app IDs to filter out of "unclassified" results
export const microsoftFirstPartyAppIds = new Set([
  "00000002-0000-0000-c000-000000000000", // Azure AD Graph
  "00000003-0000-0000-c000-000000000000", // Microsoft Graph
  "00000002-0000-0ff1-ce00-000000000000", // Office 365 Exchange
  "00000003-0000-0ff1-ce00-000000000000", // Office 365 SharePoint
  "00000004-0000-0ff1-ce00-000000000000", // Office 365 Lync Online
  "00000006-0000-0ff1-ce00-000000000000", // Microsoft Office
  "0cd196ee-71bf-4fd6-a57c-b728e7b18c21", // Windows Store
  "1fec8e78-bce4-4aaf-ab1b-5451cc387264", // Teams
  "4765445b-32c6-49b0-83e6-1d93765276ca", // Office Home
  "d3590ed6-52b3-4102-aeff-aad2292ab01c", // Office First Party
  "57fb890c-0dab-4b24-8ead-df10d4b92353", // OneDrive
  "66a88757-258c-4c72-893c-3e8bed4d6899", // OneDrive Web
  "871c010f-5e61-4fb1-83ac-98610a7e9110", // Outlook
  "27922004-5251-4030-b22d-91ecd9a37ea4", // Outlook Mobile
]);
