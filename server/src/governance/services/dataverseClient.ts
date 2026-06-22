/**
 * Dataverse Client — Primary source for Copilot Studio agent discovery
 * Per PRD Section 4.1: Agents are discovered from the Dataverse bot entity table
 * Endpoint: https://{env}.crm.dynamics.com/api/data/v9.2/bots
 */

import type { DataverseBot } from "../types/graph.js";

export class DataverseClient {
  private token: string;
  private envUrl: string;

  constructor(token: string, envUrl: string) {
    this.token = token;
    // envUrl like "org12345.crm.dynamics.com"
    this.envUrl = envUrl.replace(/\/$/, "");
    if (!this.envUrl.startsWith("https://")) {
      this.envUrl = `https://${this.envUrl}`;
    }
  }

  private async fetchWithRetry(url: string, retries = 2): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        Prefer: 'odata.include-annotations="*"',
      },
    });

    if (response.status === 429 && retries > 0) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "5");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.fetchWithRetry(url, retries - 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new DataverseError(response.status, body, url);
    }

    return response;
  }

  /**
   * Discover all Copilot Studio bots (agents) from the bot entity table
   * Per PRD: botid is stable GUID, use as primary key in CloudFuze registry
   */
  async discoverBots(): Promise<DataverseBot[]> {
    // Three tiers: full fields → medium (no description) → minimal
    const fullSelect = [
      "botid", "name", "description", "schemaname",
      "statecode", "statuscode", "createdon", "modifiedon",
      "_createdby_value", "_modifiedby_value",
      "componentstate", "template", "configuration", "accesscontrolpolicy",
    ].join(",");

    const mediumSelect = [
      "botid", "name", "schemaname",
      "statecode", "statuscode", "createdon", "modifiedon",
      "_createdby_value", "_modifiedby_value",
      "componentstate", "template", "configuration", "accesscontrolpolicy",
    ].join(",");

    const minimalSelect = [
      "botid", "name", "schemaname",
      "statecode", "statuscode", "createdon", "modifiedon",
      "_createdby_value", "_modifiedby_value", "componentstate",
    ].join(",");

    for (const select of [fullSelect, mediumSelect, minimalSelect]) {
      try {
        const url = `${this.envUrl}/api/data/v9.2/bots?$select=${select}&$orderby=modifiedon desc`;
        const allBots: DataverseBot[] = [];
        let nextUrl: string | null = url;
        let pages = 0;

        while (nextUrl && pages < 10) {
          const response = await this.fetchWithRetry(nextUrl);
          const data = await response.json();
          if (data.value) {
            allBots.push(...data.value);
          }
          nextUrl = data["@odata.nextLink"] || null;
          pages++;
        }

        if (select === minimalSelect && allBots.length > 0) {
          console.log("[DV] Used minimal fields (template/configuration not available in this environment)");
        } else if (select === mediumSelect && allBots.length > 0) {
          console.log("[DV] Used medium fields (description not available, but template/configuration OK)");
        }
        console.log(`[DV] Bots discovered: ${allBots.map(b => `"${b.name}" (state=${b.statecode})`).join(", ")}`);
        return allBots;
      } catch (e) {
        if (select !== minimalSelect) {
          console.warn(`[DV] Bot query with ${select === fullSelect ? "full" : "medium"} fields failed, trying next:`, e instanceof Error ? e.message : "");
          continue;
        }
        throw e;
      }
    }

    return [];
  }

  /**
   * Discover Copilot agents from the botcomponent table
   * This table includes declarative copilots, personal agents, and SharePoint agents
   * that may not appear in the main bots table
   */
  async discoverBotComponents(): Promise<Array<{
    botcomponentid: string;
    name: string;
    componenttype: number;
    schemaname?: string;
    createdon: string;
    modifiedon: string;
    _parentbotid_value?: string;
    _createdby_value?: string;
    content?: string;
    data?: string;
  }>> {
    try {
      // componenttype 0 = Topic, 2 = Bot/Agent, 4 = Skill, etc.
      // We want type that represents agents/copilots
      const url = `${this.envUrl}/api/data/v9.2/botcomponents?$select=botcomponentid,name,componenttype,schemaname,createdon,modifiedon,_parentbotid_value,_createdby_value&$orderby=modifiedon desc&$top=200`;
      const response = await this.fetchWithRetry(url);
      const data = await response.json();
      return data.value || [];
    } catch {
      return [];
    }
  }

  /**
   * Discover copilot agents from the msdyn_copilot table (if available)
   * This is the newer table used for M365 Copilot personal/declarative agents
   */
  async discoverCopilotAgents(): Promise<Array<{
    msdyn_copilotid?: string;
    msdyn_name?: string;
    msdyn_description?: string;
    msdyn_agenttype?: number;
    msdyn_status?: number;
    createdon?: string;
    modifiedon?: string;
    _createdby_value?: string;
    _ownerid_value?: string;
  }>> {
    // Try Dataverse tables that contain actual copilot agents.
    // Note: msdyn_aimodels is excluded — it contains AI MODEL definitions, not agents.
    for (const table of ["msdyn_copilots", "msdyn_copilot", "msdyn_agents"]) {
      try {
        const url = `${this.envUrl}/api/data/v9.2/${table}?$top=100&$orderby=modifiedon desc`;
        const response = await this.fetchWithRetry(url);
        const data = await response.json();
        if (data.value && data.value.length > 0) {
          console.log(`[DV] Found ${data.value.length} agents in ${table} table`);
          return data.value;
        }
      } catch {
        // Table may not exist — try next
      }
    }
    return [];
  }

  /**
   * Discover declarative copilot extensions
   * These are the agents published to M365 Copilot (personal agents, SharePoint agents)
   */
  async discoverDeclarativeCopilots(): Promise<Array<{
    botid: string;
    name: string;
    description?: string;
    template?: string;
    accesscontrolpolicy?: string;
    statecode: number;
    createdon: string;
    modifiedon: string;
    _createdby_value?: string;
    configuration?: string;
  }>> {
    try {
      // Query bots table with expanded select to find declarative copilots
      // These have template = "dcBot" or configuration containing "declarativeCopilot"
      const url = `${this.envUrl}/api/data/v9.2/bots?$select=botid,name,description,template,accesscontrolpolicy,statecode,createdon,modifiedon,_createdby_value,configuration&$orderby=modifiedon desc&$top=100`;
      const response = await this.fetchWithRetry(url);
      const data = await response.json();
      const allBots = data.value || [];

      // Filter for declarative copilots (personal/SharePoint agents)
      // They typically have template containing "dcBot" or specific configuration patterns
      const declarativeBots = allBots.filter((bot: any) => {
        const tmpl = (bot.template || "").toLowerCase();
        const config = (bot.configuration || "").toLowerCase();
        const name = (bot.name || "").toLowerCase();
        return tmpl.includes("dcbot") || tmpl.includes("declarative") ||
          config.includes("declarativecopilot") || config.includes("sharepoint") ||
          config.includes("personal") || name.includes("sharepoint") ||
          bot.accesscontrolpolicy === "1" || // Often used for personal agents
          tmpl === ""; // Some personal agents have empty template
      });

      console.log(`[DV] Found ${declarativeBots.length} declarative copilots out of ${allBots.length} total bots`);
      return declarativeBots;
    } catch {
      return [];
    }
  }

  /**
   * Get a single bot by ID
   */
  async getBot(botId: string): Promise<DataverseBot> {
    const url = `${this.envUrl}/api/data/v9.2/bots(${botId})`;
    const response = await this.fetchWithRetry(url);
    return response.json();
  }

  /**
   * Get bot configuration including AI settings
   * Returns parsed configuration JSON from the bot entity
   */
  async getBotConfiguration(botId: string): Promise<BotConfiguration | null> {
    try {
      const url = `${this.envUrl}/api/data/v9.2/bots(${botId})?$select=configuration,template,language,accesscontrolpolicy,authenticationmode`;
      const response = await this.fetchWithRetry(url);
      const bot = await response.json();
      if (bot.configuration) {
        try {
          return JSON.parse(bot.configuration) as BotConfiguration;
        } catch {
          return null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get LLM model info from botcomponents (type 15 = agent definition)
   * The model name is stored in botcomponent.data.aISettings.model.modelNameHint
   */
  async getBotLLMInfo(botId: string): Promise<BotLLMInfo | null> {
    try {
      const url = `${this.envUrl}/api/data/v9.2/botcomponents?$filter=_parentbotid_value eq ${botId} and componenttype eq 15&$select=name,data,schemaname&$top=1`;
      const response = await this.fetchWithRetry(url);
      const result = await response.json();
      const component = result.value?.[0];
      if (!component?.data) return null;

      // Parse YAML-like data field
      const data = component.data as string;
      const info: BotLLMInfo = { rawData: data };

      // Extract model name hint
      const modelMatch = data.match(/modelNameHint:\s*(\S+)/);
      if (modelMatch) {
        info.modelNameHint = modelMatch[1];
        info.modelDisplayName = mapModelName(modelMatch[1]);
      }

      // Extract web browsing
      const webMatch = data.match(/webBrowsing:\s*(true|false)/);
      if (webMatch) info.webBrowsingEnabled = webMatch[1] === "true";

      // Extract instructions
      const instrMatch = data.match(/instructions:\s*(.+?)(?:\n\w|$)/s);
      if (instrMatch && instrMatch[1].trim()) info.instructions = instrMatch[1].trim();

      return info;
    } catch {
      return null;
    }
  }

  /**
   * Fetch ALL bot components to discover knowledge sources, data connections, and file access.
   * Copilot Studio stores file knowledge in botcomponents + dedicated knowledge entities.
   */
  async getBotKnowledgeSources(botId: string): Promise<BotKnowledgeSource[]> {
    const sources: BotKnowledgeSource[] = [];
    const seenIds = new Set<string>();

    const addSource = (s: BotKnowledgeSource) => {
      const key = `${s.type}:${s.name}:${s.url}`;
      if (!seenIds.has(key)) { seenIds.add(key); sources.push(s); }
    };

    // ── 1. Fetch ALL bot components ──
    try {
      const url = `${this.envUrl}/api/data/v9.2/botcomponents?$filter=_parentbotid_value eq ${botId}&$select=botcomponentid,name,componenttype,data,schemaname,createdon&$top=200`;
      const response = await this.fetchWithRetry(url);
      const result = await response.json();
      const components = result.value || [];

      console.log(`[DV] Bot ${botId}: ${components.length} components, types: [${[...new Set(components.map((c: Record<string, unknown>) => c.componenttype))].join(",")}]`);

      for (const comp of components) {
        const dataStr = comp.data as string || "";
        const compType = comp.componenttype as number;
        const compName = comp.name as string || "";

        // Type 15 = Agent definition — parse for knowledge config
        if (compType === 15 && dataStr) {
          const spMatches = dataStr.matchAll(/sharepoint[^"'\n]*?(?:https?:\/\/[^\s"',\n}]+)/gi);
          for (const m of spMatches) {
            const urlMatch = m[0].match(/(https?:\/\/[^\s"',\n}]+)/);
            if (urlMatch) addSource({ type: "sharepoint", name: "SharePoint Site", url: urlMatch[1], componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }

          const urlMatches = dataStr.matchAll(/url:\s*["']?(https?:\/\/[^\s"',\n}]+)/gi);
          for (const m of urlMatches) {
            if (!m[1].includes("sharepoint")) addSource({ type: "website", name: "Web Knowledge", url: m[1], componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }

          if (dataStr.includes("isFileAnalysisEnabled: true") || dataStr.includes("fileAnalysis")) {
            addSource({ type: "file_analysis", name: "File Analysis Enabled", url: "", componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
          if (dataStr.includes("useModelKnowledge: true")) {
            addSource({ type: "model_knowledge", name: "Model Knowledge (Web Grounding)", url: "", componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
        }

        // Non-topic, non-definition components with data → potential knowledge
        if (![0, 9, 15].includes(compType) && (dataStr || compName)) {
          const lower = (dataStr + compName).toLowerCase();

          // Detect file references
          if (lower.includes(".docx") || lower.includes(".pdf") || lower.includes(".xlsx") ||
              lower.includes(".pptx") || lower.includes(".txt") || lower.includes(".csv") ||
              lower.includes("file") || lower.includes("document") || lower.includes("upload")) {
            const fileName = compName || dataStr.match(/["']?([^"'\n]+\.\w{2,5})["']?/)?.[1] || `File (type ${compType})`;
            addSource({ type: "uploaded_file", name: fileName, url: "", componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
          // Detect SharePoint
          else if (lower.includes("sharepoint")) {
            const spUrl = dataStr.match(/(https?:\/\/[^\s"',\n}]*sharepoint[^\s"',\n}]*)/i)?.[1] || "";
            addSource({ type: "sharepoint", name: compName || "SharePoint", url: spUrl, componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
          // Detect Dataverse tables
          else if (lower.includes("dataverse") || lower.includes("entity") || lower.includes("table")) {
            addSource({ type: "dataverse_table", name: compName || "Dataverse Table", url: "", componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
          // Detect connectors/skills with URLs
          else if (compType === 1 && dataStr) {
            const connUrls = dataStr.matchAll(/(https?:\/\/[^\s"',\n}]+)/g);
            for (const m of connUrls) addSource({ type: "connector", name: compName || "Connector", url: m[1], componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
          // Catch any other knowledge component types
          else if (compType >= 60 && dataStr) {
            let kType: BotKnowledgeSource["type"] = "other";
            const anyUrl = dataStr.match(/(https?:\/\/[^\s"',\n}]+)/)?.[1] || "";
            if (anyUrl.includes("sharepoint")) kType = "sharepoint";
            else if (anyUrl.includes("blob.core")) kType = "azure_storage";
            else if (anyUrl) kType = "website";
            addSource({ type: kType, name: compName || `Knowledge (type ${compType})`, url: anyUrl, componentId: comp.botcomponentid, componentType: compType, addedOn: comp.createdon });
          }
        }
      }
    } catch (e) {
      console.warn("[DV] Failed to fetch bot components:", e instanceof Error ? e.message : e);
    }

    // ── 2. Query Copilot Studio knowledge entities (msdyn_*) ──
    const knowledgeEntities = [
      { entity: "msdyn_knowledgearticles", idField: "msdyn_knowledgearticleid", nameField: "msdyn_title", keywordsField: "msdyn_keywords" },
      { entity: "msdyn_aaborknowledgesources", idField: "msdyn_aaborknowledgesourceid", nameField: "msdyn_name", keywordsField: null },
      { entity: "msdyn_copilotknowledgesources", idField: "msdyn_copilotknowledgesourceid", nameField: "msdyn_name", keywordsField: null },
    ];

    for (const ke of knowledgeEntities) {
      try {
        const fields = [ke.idField, ke.nameField, "createdon", ke.keywordsField].filter(Boolean).join(",");
        const kcUrl = `${this.envUrl}/api/data/v9.2/${ke.entity}?$select=${fields}&$top=50&$orderby=createdon desc`;
        const kcResp = await this.fetchWithRetry(kcUrl);
        const kcResult = await kcResp.json();
        for (const row of kcResult.value || []) {
          const name = row[ke.nameField!] || "Knowledge Source";
          const kw = ke.keywordsField ? row[ke.keywordsField] : undefined;
          const isFile = /\.\w{2,5}$/.test(name);
          addSource({
            type: isFile ? "uploaded_file" : "knowledge_article",
            name,
            url: "",
            componentId: row[ke.idField],
            componentType: -1,
            addedOn: row.createdon,
            metadata: kw || undefined,
          });
        }
        console.log(`[DV] ${ke.entity}: found ${kcResult.value?.length || 0} entries`);
      } catch {
        // Entity doesn't exist in this environment — skip silently
      }
    }

    // ── 3. Query botcomponentcollections linked to this bot ──
    try {
      const bccUrl = `${this.envUrl}/api/data/v9.2/botcomponentcollections?$filter=_parentbotid_value eq ${botId}&$select=botcomponentcollectionid,name,componenttype,data,schemaname,createdon&$top=50`;
      const bccResp = await this.fetchWithRetry(bccUrl);
      const bccResult = await bccResp.json();
      for (const bcc of bccResult.value || []) {
        const name = bcc.name || "Collection Component";
        const data = bcc.data as string || "";
        const isFile = /\.\w{2,5}$/.test(name) || data.toLowerCase().includes("file");
        addSource({
          type: isFile ? "uploaded_file" : "other",
          name,
          url: "",
          componentId: bcc.botcomponentcollectionid,
          componentType: bcc.componenttype || -2,
          addedOn: bcc.createdon,
        });
      }
    } catch {
      // Entity may not exist — skip
    }

    // ── 4. Check annotations (file attachments) on bot entity ──
    try {
      const annoUrl = `${this.envUrl}/api/data/v9.2/annotations?$filter=_objectid_value eq ${botId}&$select=annotationid,subject,filename,filesize,mimetype,createdon&$top=50`;
      const annoResp = await this.fetchWithRetry(annoUrl);
      const annoResult = await annoResp.json();
      for (const a of annoResult.value || []) {
        if (a.filename) {
          addSource({
            type: "uploaded_file",
            name: a.filename,
            url: "",
            componentId: a.annotationid,
            componentType: -3,
            addedOn: a.createdon,
            metadata: a.mimetype ? `${a.mimetype}${a.filesize ? `, ${Math.round(a.filesize / 1024)}KB` : ""}` : undefined,
          });
        }
      }
    } catch {
      // Annotations query failed — skip
    }

    return sources;
  }

  /**
   * Get all bot components with their types for inspection/debugging
   */
  async getAllBotComponents(botId: string): Promise<Array<{ id: string; name: string; type: number; schemaname: string; hasData: boolean; dataPreview: string; dataSize: number }>> {
    try {
      const url = `${this.envUrl}/api/data/v9.2/botcomponents?$filter=_parentbotid_value eq ${botId}&$select=botcomponentid,name,componenttype,data,schemaname&$top=200`;
      const response = await this.fetchWithRetry(url);
      const result = await response.json();
      return (result.value || []).map((c: Record<string, unknown>) => {
        const data = c.data as string || "";
        return {
          id: c.botcomponentid as string,
          name: c.name as string || "",
          type: c.componenttype as number,
          schemaname: c.schemaname as string || "",
          hasData: !!data,
          dataPreview: data.slice(0, 800),
          dataSize: data.length,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Detect Power Platform connectors used by a bot and map them to
   * their well-known Microsoft Graph / O365 permission scopes.
   * Sources: bot component data text + Dataverse connectionreference entity.
   */
  async getBotConnectorScopes(botId: string): Promise<{
    connectors: Array<{ name: string; scopes: string[] }>;
    allScopes: string[];
  }> {
    // Well-known Power Platform connector → typical permission scopes
    const CONNECTOR_SCOPE_MAP: Record<string, string[]> = {
      shared_office365:          ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "MailboxSettings.ReadWrite"],
      shared_office365users:     ["User.Read.All", "Directory.Read.All"],
      shared_sharepointonline:   ["Sites.ReadWrite.All", "Files.ReadWrite.All"],
      shared_onedriveforbusiness:["Files.ReadWrite.All"],
      shared_teams:              ["Group.ReadWrite.All"],
      shared_microsoftgraph:     ["User.ReadWrite.All", "Directory.ReadWrite.All"],
      shared_dynamicsce:         ["User.Read.All"],
      shared_commondataservice:  ["User.Read.All"],
      shared_commondataserviceforapps: ["User.Read.All"],
      shared_azuread:            ["Directory.ReadWrite.All", "User.ReadWrite.All"],
      shared_excelonlinebusiness:["Files.ReadWrite.All"],
      shared_planner:            ["Group.ReadWrite.All"],
      shared_todo:               ["Tasks.ReadWrite"],
      shared_outlook:            ["Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"],
      shared_webcontents:        [],
      shared_http:               [],
    };

    const detected = new Map<string, string[]>();

    // 1. Scan all bot components for connector references
    try {
      const url = `${this.envUrl}/api/data/v9.2/botcomponents?$filter=_parentbotid_value eq ${botId}&$select=botcomponentid,name,componenttype,data,schemaname&$top=200`;
      const resp = await this.fetchWithRetry(url);
      const result = await resp.json();
      for (const comp of result.value || []) {
        const text = `${comp.data || ""} ${comp.name || ""} ${comp.schemaname || ""}`.toLowerCase();
        for (const [connKey, scopes] of Object.entries(CONNECTOR_SCOPE_MAP)) {
          if (text.includes(connKey) || text.includes(connKey.replace("shared_", ""))) {
            detected.set(connKey, scopes);
          }
        }
        if ((text.includes("http") && (text.includes("send") || text.includes("request") || text.includes("connector"))) || text.includes("httpwithazuread")) {
          detected.set("http_connector", []);
        }
      }
    } catch { /* ignore */ }

    // Note: connectionreferences entity is environment-wide (not bot-scoped),
    // so we rely only on bot component data which is filtered by botId above.

    const connectors = Array.from(detected.entries()).map(([name, scopes]) => ({
      name: name.replace("shared_", "").replace(/_/g, " "),
      scopes,
    }));
    const allScopes = [...new Set(connectors.flatMap(c => c.scopes))];

    if (connectors.length > 0) {
      console.log(`[DV] Bot ${botId}: detected connectors: ${connectors.map(c => c.name).join(", ")} → scopes: [${allScopes.join(", ")}]`);
    }

    return { connectors, allScopes };
  }

  /**
   * Get topic count for a bot (botcomponents with componenttype = 9)
   */
  async getBotTopicCount(botId: string): Promise<number> {
    try {
      const url = `${this.envUrl}/api/data/v9.2/botcomponents?$filter=_parentbotid_value eq ${botId} and componenttype eq 9&$select=botcomponentid&$top=100`;
      const response = await this.fetchWithRetry(url);
      const result = await response.json();
      return result.value?.length || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Suspend an agent by setting statecode = 1 (Inactive)
   * Per PRD Section 4.3: Suspension is supported (statecode write). Reversible. Logged.
   */
  async suspendBot(botId: string): Promise<void> {
    const url = `${this.envUrl}/api/data/v9.2/bots(${botId})`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      },
      body: JSON.stringify({ statecode: 1 }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new DataverseError(response.status, body, url);
    }
  }

  /**
   * Reactivate an agent by setting statecode = 0 (Active)
   */
  async reactivateBot(botId: string): Promise<void> {
    const url = `${this.envUrl}/api/data/v9.2/bots(${botId})`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
      },
      body: JSON.stringify({ statecode: 0 }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new DataverseError(response.status, body, url);
    }
  }

  /**
   * Resolve Dataverse systemuserid to Entra ID user via systemusers entity
   */
  async resolveUser(systemUserId: string): Promise<{ azureactivedirectoryobjectid: string; fullname: string; internalemailaddress: string } | null> {
    try {
      const url = `${this.envUrl}/api/data/v9.2/systemusers(${systemUserId})?$select=azureactivedirectoryobjectid,fullname,internalemailaddress`;
      const response = await this.fetchWithRetry(url);
      return response.json();
    } catch {
      return null;
    }
  }

  /**
   * Get full conversation transcripts across ALL bots with actual message content.
   * Returns user chats including message text, timestamps, sender info.
   */
  async getAllConversationTranscripts(top: number = 1000): Promise<ConversationTranscript[]> {
    try {
      const pageSize = Math.min(top, 5000);
      const firstUrl = `${this.envUrl}/api/data/v9.2/conversationtranscripts?$select=conversationtranscriptid,name,conversationstarttime,createdon,modifiedon,metadata,content,_bot_conversationtranscriptid_value,_createdby_value,_owninguser_value&$orderby=createdon desc&$top=${pageSize}`;

      const allRecords: Record<string, unknown>[] = [];
      let nextUrl: string | null = firstUrl;
      let pages = 0;
      const maxPages = Math.ceil(top / pageSize);

      while (nextUrl && pages < maxPages && allRecords.length < top) {
        const response = await this.fetchWithRetry(nextUrl);
        const data = await response.json();
        if (data.value) {
          allRecords.push(...data.value);
        }
        nextUrl = data["@odata.nextLink"] || null;
        pages++;
      }

      console.log(`[DV] Fetched ${allRecords.length} conversation transcripts across ${pages} page(s)`);
      for (const r of allRecords.slice(0, 10)) {
        let meta: Record<string, string> = {};
        try { meta = JSON.parse(r.metadata as string || "{}"); } catch { /* ignore */ }
        console.log(`[DV]   Chat: bot="${meta.BotName || "?"}" created=${(r.createdon as string || "").slice(0, 19)} id=${(r.conversationtranscriptid as string || "").slice(0, 8)}...`);
      }

      return allRecords.slice(0, top).map((t: Record<string, unknown>) => {
        let metadata: Record<string, string> = {};
        try { metadata = JSON.parse(t.metadata as string || "{}"); } catch { /* ignore */ }

        const messages: ChatMessage[] = [];
        let isTestMode = false;
        let realUserAadObjectId = "";
        const botId = t._bot_conversationtranscriptid_value as string || "";
        const botName = metadata.BotName || "";
        try {
          const content = JSON.parse(t.content as string || "{}");
          const activities = content.activities || [];

          // Build a set of known user IDs from the conversation
          const userIds = new Set<string>();
          const botIds = new Set<string>();

          // First pass: collect IDs that we can definitively identify
          // Copilot Studio uses NUMERIC roles: 0 = bot, 1 = user
          for (const a of activities) {
            const fRole = a.from?.role;
            const fId = a.from?.id || "";
            if (!fId) continue;
            if (fRole === "user" || fRole === 1) {
              userIds.add(fId);
              if (a.from?.aadObjectId && !realUserAadObjectId) {
                realUserAadObjectId = a.from.aadObjectId;
              }
            }
            if (fRole === "bot" || fRole === 0) botIds.add(fId);
          }
          botIds.delete("");
          userIds.delete("");

          // If we got explicit roles, great. Otherwise use heuristic:
          // The transcript's botId (from Dataverse FK) matches one of the from.ids
          if (botIds.size === 0 && userIds.size === 0) {
            // No explicit roles — use conversation structure heuristic
            // Collect all unique from.id values from messages
            const fromIdCounts = new Map<string, number>();
            for (const a of activities) {
              if (a.type === "message" && a.text && a.from?.id) {
                fromIdCounts.set(a.from.id, (fromIdCounts.get(a.from.id) || 0) + 1);
              }
            }

            // In a typical Copilot Studio conversation there are exactly 2 participants
            const uniqueFromIds = Array.from(fromIdCounts.keys());
            if (uniqueFromIds.length === 2) {
              // One is the bot, one is the user
              // Heuristic: the bot's from.id often matches the Dataverse botId,
              // or starts with the bot schema name, or is longer/GUID-like
              for (const fid of uniqueFromIds) {
                const fidLower = fid.toLowerCase();
                const isBotId =
                  (botId && fidLower.includes(botId.toLowerCase())) ||
                  (botName && fidLower.includes(botName.toLowerCase())) ||
                  /^cr[a-z0-9]+_/i.test(fid) ||
                  fidLower.startsWith("bot");

                if (isBotId) {
                  botIds.add(fid);
                } else {
                  userIds.add(fid);
                }
              }

              // If still ambiguous, assume the ID that matches the transcript's
              // owning user is the user, and the other is the bot
              if (botIds.size === 0 && userIds.size === 0) {
                // Last resort: in test mode, bot usually sends the first message (greeting)
                const firstMsg = activities.find((a: Record<string, unknown>) => a.type === "message" && (a as Record<string, unknown>).text);
                if (firstMsg) {
                  botIds.add(firstMsg.from?.id || uniqueFromIds[0]);
                  userIds.add(uniqueFromIds.find((id: string) => id !== firstMsg.from?.id) || uniqueFromIds[1]);
                }
              }
            } else if (uniqueFromIds.length === 1) {
              // All messages from same ID — likely all from user with bot responses not in text format
              userIds.add(uniqueFromIds[0]);
            }

          }

          for (const a of activities) {
            if (a.type === "message" && a.text) {
              const fromId = a.from?.id || "";
              const fromRole = a.from?.role || "";
              const fromName = a.from?.name || "";

              const rawRole = a.from?.role;
              const isBot =
                rawRole === "bot" ||
                rawRole === 0 ||
                rawRole === "skill" ||
                botIds.has(fromId) ||
                (botIds.size === 0 && (
                  (botId && fromId.toLowerCase().includes(botId.toLowerCase())) ||
                  (botName && fromName.toLowerCase() === botName.toLowerCase()) ||
                  /^cr[a-z0-9]+_/i.test(fromId)
                ));

              messages.push({
                id: a.id || "",
                from: isBot ? "bot" : "user",
                fromName: isBot ? (botName || fromName || "Agent") : (fromName || "User"),
                text: a.text,
                timestamp: a.timestamp || a.localTimestamp || "",
              });
            }
            if (a.type === "trace" && (a.value as Record<string, unknown>)?.isDesignMode) {
              isTestMode = true;
            }
          }
        } catch { /* ignore */ }

        return {
          id: t.conversationtranscriptid as string,
          botId: t._bot_conversationtranscriptid_value as string || "",
          botName: metadata.BotName || "Unknown Agent",
          startTime: t.conversationstarttime as string,
          createdOn: t.createdon as string,
          userId: (t._owninguser_value || t._createdby_value) as string,
          realUserAadId: realUserAadObjectId || "",
          tenantId: metadata.AADTenantId || "",
          isTestMode,
          messageCount: messages.length,
          messages,
        };
      });
    } catch (e) {
      console.warn("Failed to fetch all conversation transcripts:", e instanceof Error ? e.message : e);
      return [];
    }
  }

  /**
   * Get conversation transcripts for a bot — shows who used the agent and when
   * Data source: conversationtranscripts entity in Dataverse
   */
  async getBotSessions(botId: string, top: number = 50): Promise<BotSession[]> {
    try {
      const url = `${this.envUrl}/api/data/v9.2/conversationtranscripts?$filter=_bot_conversationtranscriptid_value eq ${botId}&$select=conversationtranscriptid,name,conversationstarttime,createdon,metadata,content,_createdby_value,_owninguser_value&$orderby=conversationstarttime desc&$top=${top}`;
      const response = await this.fetchWithRetry(url);
      const result = await response.json();

      return (result.value || []).map((t: Record<string, unknown>) => {
        // Parse metadata for tenant/bot info
        let metadata: Record<string, string> = {};
        try {
          metadata = JSON.parse(t.metadata as string || "{}");
        } catch { /* ignore */ }

        // Parse content to check if test mode and extract basic info
        let isTestMode = false;
        let messageCount = 0;
        try {
          const content = JSON.parse(t.content as string || "{}");
          const activities = content.activities || [];
          messageCount = activities.filter((a: Record<string, unknown>) => a.type === "message").length;
          // Check first trace for isDesignMode
          const trace = activities.find((a: Record<string, unknown>) => a.type === "trace" && (a.value as Record<string, unknown>)?.isDesignMode !== undefined);
          if (trace) {
            isTestMode = !!(trace.value as Record<string, unknown>)?.isDesignMode;
          }
        } catch { /* ignore */ }

        return {
          id: t.conversationtranscriptid as string,
          startTime: t.conversationstarttime as string,
          createdOn: t.createdon as string,
          userId: (t._owninguser_value || t._createdby_value) as string,
          botName: metadata.BotName || "",
          tenantId: metadata.AADTenantId || "",
          isTestMode,
          messageCount,
        };
      });
    } catch (e) {
      console.warn("Failed to fetch conversation transcripts:", e instanceof Error ? e.message : e);
      return [];
    }
  }
}

export interface BotSession {
  id: string;
  startTime: string;
  createdOn: string;
  userId: string;
  botName: string;
  tenantId: string;
  isTestMode: boolean;
  messageCount: number;
}

export interface BotKnowledgeSource {
  type: "sharepoint" | "website" | "dataverse_table" | "azure_storage" | "file_analysis" | "model_knowledge" | "knowledge_article" | "connector" | "uploaded_file" | "other";
  name: string;
  url: string;
  componentId: string;
  componentType: number;
  addedOn?: string;
  metadata?: string;
}

export interface ChatMessage {
  id: string;
  from: "user" | "bot";
  fromName: string;
  text: string;
  timestamp: string;
}

export interface ConversationTranscript {
  id: string;
  botId: string;
  botName: string;
  startTime: string;
  createdOn: string;
  userId: string;
  realUserAadId: string;
  tenantId: string;
  isTestMode: boolean;
  messageCount: number;
  messages: ChatMessage[];
}

export interface BotConfiguration {
  $kind: string;
  settings?: { GenerativeActionsEnabled?: boolean };
  isAgentConnectable?: boolean;
  aISettings?: {
    useModelKnowledge?: boolean;
    isFileAnalysisEnabled?: boolean;
    isSemanticSearchEnabled?: boolean;
    optInUseLatestModels?: boolean;
  };
}

export interface BotLLMInfo {
  modelNameHint?: string;
  modelDisplayName?: string;
  webBrowsingEnabled?: boolean;
  instructions?: string;
  rawData: string;
}

// Map Dataverse model hint names to display names
function mapModelName(hint: string): string {
  const map: Record<string, string> = {
    "Sonnet46": "Claude Sonnet 4.6",
    "Sonnet4": "Claude Sonnet 4",
    "GPT4o": "GPT-4o",
    "GPT4oMini": "GPT-4o Mini",
    "GPT4": "GPT-4",
    "GPT35Turbo": "GPT-3.5 Turbo",
    "O3Mini": "o3-mini",
    "O1": "o1",
    "Gemini15Pro": "Gemini 1.5 Pro",
    "Gemini2Flash": "Gemini 2.0 Flash",
  };
  return map[hint] || hint;
}

export class DataverseError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(status: number, body: string, endpoint: string) {
    const parsed = (() => {
      try { return JSON.parse(body); } catch { return null; }
    })();
    const msg = parsed?.error?.message || body.slice(0, 200);
    super(`Dataverse ${status}: ${msg}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}
