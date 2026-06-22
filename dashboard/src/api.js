const BASE = '/api/v1';

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  overview: () => req('/overview'),
  machines: () => req('/machines'),
  machine: (id) => req(`/machines/${encodeURIComponent(id)}`),
  findings: (params) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return req(`/findings${qs}`);
  },
  latestFindings: (params = {}) => {
    const qs = '?' + new URLSearchParams({ ...params, latestOnly: 'true' }).toString();
    return req(`/findings${qs}`);
  },
  tools: () => req('/tools'),
  tool: (key) => req(`/tools/${encodeURIComponent(key)}`),
  shadow: () => req('/shadow'),
  sanctions: () => req('/sanctions'),
  setSanction: (key, body) =>
    req(`/sanctions/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(body) }),
  serverAgentsSummary: () => req('/server-agents/summary'),
  serverAgentCalls: (params = {}) => {
    const qs = '?' + new URLSearchParams(params).toString();
    return req(`/server-agents/calls${qs}`);
  },
  serverAgentCall: (id) => req(`/server-agents/calls/${id}`),
};
