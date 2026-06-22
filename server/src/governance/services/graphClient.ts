import { GRAPH_BASE } from "../config/graphConfig.js";

export class GraphClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 2
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 429 && retries > 0) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "5");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.fetchWithRetry(url, options, retries - 1);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new GraphError(response.status, errorBody, url);
    }

    return response;
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    let url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_BASE}${endpoint}`;

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const response = await this.fetchWithRetry(url);
    return response.json();
  }

  async getWithConsistency<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    let url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_BASE}${endpoint}`;

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const response = await this.fetchWithRetry(url, {
      headers: { ConsistencyLevel: "eventual" },
    });
    return response.json();
  }

  async post<T>(endpoint: string, body: any): Promise<T> {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_BASE}${endpoint}`;

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async getAllPages<T>(
    endpoint: string,
    params?: Record<string, string>,
    maxPages = 10
  ): Promise<T[]> {
    const allResults: T[] = [];
    let url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_BASE}${endpoint}`;

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    let page = 0;
    while (url && page < maxPages) {
      const response = await this.fetchWithRetry(url, {
        headers: { ConsistencyLevel: "eventual" },
      });
      const data = await response.json();
      if (data.value) {
        allResults.push(...data.value);
      }
      url = data["@odata.nextLink"] || null;
      page++;
    }

    return allResults;
  }
}

export class GraphError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(status: number, body: string, endpoint: string) {
    const parsed = (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })();
    const msg = parsed?.error?.message || body;
    super(`Graph API ${status}: ${msg}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}
