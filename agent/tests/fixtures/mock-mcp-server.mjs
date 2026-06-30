// Minimal stdio MCP server for tests. Speaks newline-delimited JSON-RPC:
// answers initialize / tools/list, and for tools/call echoes which tool it
// received (so a test can prove a call actually reached the server vs. was
// blocked upstream by the guard).
let buf = '';
process.stdin.on('data', (c) => {
  buf += c.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    handle(line);
  }
});
function send(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function handle(line) {
  const t = line.trim();
  if (!t) return;
  let m;
  try { m = JSON.parse(t); } catch { return; }
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock-mcp', version: '1.0.0' } } });
  } else if (m.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'write_file' }, { name: 'read_file' }] } });
  } else if (m.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'server-received:' + (m.params && m.params.name) }] } });
  } else if (m.id !== undefined) {
    send({ jsonrpc: '2.0', id: m.id, result: {} });
  }
}
