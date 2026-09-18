import { join } from 'node:path';
import { safeReaddir, safeReadJson, exists } from '../util/fs.js';

export const name = 'ide_extensions';
export const description = 'Detect AI extensions in VS Code, Cursor, and JetBrains IDEs';
export const platforms = ['win32', 'darwin', 'linux'];

// Known AI extensions for VS Code / Cursor (publisher.name in extension id)
const AI_EXTENSIONS = [
  { id: 'github.copilot', vendor: 'GitHub', product: 'GitHub Copilot' },
  { id: 'github.copilot-chat', vendor: 'GitHub', product: 'GitHub Copilot Chat' },
  { id: 'github.copilot-labs', vendor: 'GitHub', product: 'GitHub Copilot Labs' },
  { id: 'continue.continue', vendor: 'Continue', product: 'Continue' },
  { id: 'codeium.codeium', vendor: 'Codeium', product: 'Codeium' },
  { id: 'codeium.windsurfPyright', vendor: 'Codeium', product: 'Windsurf (Pyright)' },
  { id: 'tabnine.tabnine-vscode', vendor: 'TabNine', product: 'Tabnine' },
  { id: 'saoudrizwan.claude-dev', vendor: 'Cline', product: 'Cline' },
  { id: 'rooveterinaryinc.roo-cline', vendor: 'Roo', product: 'Roo Code' },
  { id: 'anthropic.claude-code', vendor: 'Anthropic', product: 'Claude Code' },
  { id: 'anthropic.claude-vscode', vendor: 'Anthropic', product: 'Claude for VS Code' },
  { id: 'google.geminicodeassist', vendor: 'Google', product: 'Gemini Code Assist' },
  { id: 'amazonwebservices.aws-toolkit-vscode', vendor: 'AWS', product: 'Amazon Q' },
  { id: 'amazonwebservices.amazon-q-vscode', vendor: 'AWS', product: 'Amazon Q' },
  { id: 'sourcegraph.cody-ai', vendor: 'Sourcegraph', product: 'Cody' },
  { id: 'openai.chatgpt', vendor: 'OpenAI', product: 'ChatGPT VS Code' },
  { id: 'rubberduck.rubberduck-vscode', vendor: 'Rubberduck', product: 'Rubberduck' },
  { id: 'visualstudioexptteam.vscodeintellicode', vendor: 'Microsoft', product: 'IntelliCode' },
  { id: 'genieai.chatgpt-vscode', vendor: 'Genie AI', product: 'ChatGPT - Genie AI' },
  { id: 'mintlify.document', vendor: 'Mintlify', product: 'Mintlify Doc Writer' },
  { id: 'blackboxapp.blackbox', vendor: 'BlackBox', product: 'BLACKBOX AI' },
  { id: 'codium.codium', vendor: 'Codium', product: 'Codium' },
  { id: 'aminer.codegeex', vendor: 'Aminer', product: 'CodeGeeX' },
  { id: 'supermaven.supermaven', vendor: 'Supermaven', product: 'Supermaven' },
  { id: 'modelcontextprotocol.mcp', vendor: 'MCP', product: 'MCP for VS Code' },
];

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  const ideRoots = [
    { ide: 'vscode', dir: ctx.paths.vscodeExtensions },
    { ide: 'cursor', dir: ctx.paths.cursorExtensions },
  ];

  for (const { ide, dir } of ideRoots) {
    try {
      const r = await scanVSCodeStyle(ide, dir);
      itemsScanned += r.scanned;
      for (const f of r.findings) findings.push(f);
    } catch (err) {
      errors.push({ message: `${ide}: ${err.message}`, recoverable: true });
    }
  }

  try {
    const r = await scanJetBrains(ctx.paths.jetbrainsConfig);
    itemsScanned += r.scanned;
    for (const f of r.findings) findings.push(f);
  } catch (err) {
    errors.push({ message: `jetbrains: ${err.message}`, recoverable: true });
  }

  return { findings, errors, stats: { itemsScanned } };
}

async function scanVSCodeStyle(ide, dir) {
  if (!dir || !(await exists(dir))) return { findings: [], scanned: 0 };
  const entries = await safeReaddir(dir);
  const findings = [];
  let scanned = 0;

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // Each subdir is named like `publisher.name-1.2.3`
    const match = e.name.match(/^([^.]+\.[^-]+)-(.+)$/);
    if (!match) continue;
    const [, idLower, version] = match;
    scanned++;

    const meta = AI_EXTENSIONS.find((x) => x.id.toLowerCase() === idLower.toLowerCase());
    if (!meta) continue;

    // Try to read package.json for richer metadata
    const pkg = await safeReadJson(join(dir, e.name, 'package.json'));

    findings.push({
      type: 'ide_extension',
      ide,
      extensionId: meta.id,
      vendor: meta.vendor,
      product: meta.product,
      version,
      displayName: pkg?.displayName ?? meta.product,
      description: pkg?.description ?? null,
    });
  }
  return { findings, scanned };
}

async function scanJetBrains(baseDir) {
  if (!baseDir || !(await exists(baseDir))) return { findings: [], scanned: 0 };

  // JetBrains config dirs are per-product, e.g. IntelliJIdea2024.1, PyCharm2024.1
  const productDirs = await safeReaddir(baseDir);
  const findings = [];
  let scanned = 0;

  const aiPluginNames = [
    { match: /github-copilot/i, vendor: 'GitHub', product: 'GitHub Copilot' },
    { match: /codeium/i, vendor: 'Codeium', product: 'Codeium' },
    { match: /tabnine/i, vendor: 'TabNine', product: 'Tabnine' },
    { match: /continue/i, vendor: 'Continue', product: 'Continue' },
    { match: /^aiassistant/i, vendor: 'JetBrains', product: 'JetBrains AI Assistant' },
    { match: /supermaven/i, vendor: 'Supermaven', product: 'Supermaven' },
    { match: /cody/i, vendor: 'Sourcegraph', product: 'Cody' },
    { match: /codegpt/i, vendor: 'CodeGPT', product: 'CodeGPT' },
    { match: /amazonq|aws-toolkit/i, vendor: 'AWS', product: 'Amazon Q' },
    { match: /gemini/i, vendor: 'Google', product: 'Gemini Code Assist' },
  ];

  for (const pd of productDirs) {
    if (!pd.isDirectory()) continue;
    const pluginsDir = join(baseDir, pd.name, 'plugins');
    if (!(await exists(pluginsDir))) continue;
    const plugins = await safeReaddir(pluginsDir);
    for (const p of plugins) {
      if (!p.isDirectory()) continue;
      scanned++;
      const meta = aiPluginNames.find((x) => x.match.test(p.name));
      if (!meta) continue;
      findings.push({
        type: 'ide_extension',
        ide: 'jetbrains',
        jetbrainsProduct: pd.name,
        extensionId: p.name,
        vendor: meta.vendor,
        product: meta.product,
        version: null,
      });
    }
  }

  return { findings, scanned };
}
