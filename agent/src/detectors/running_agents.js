import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export const name = 'running_agents';
export const description = 'Detect AI agents running right now by inspecting process command lines';
export const platforms = ['win32', 'darwin', 'linux'];

// Each rule examines a process command-line. Multiple rules can match;
// findings collapse on (framework, pid).
const RULES = [
  // Python-side frameworks
  { framework: 'langchain', lang: 'python', match: /\blangchain(\b|-)/i },
  { framework: 'langgraph', lang: 'python', match: /\blanggraph\b/i },
  { framework: 'llamaindex', lang: 'python', match: /\b(llama_index|llamaindex)\b/i },
  { framework: 'autogen', lang: 'python', match: /\b(pyautogen|autogen_agentchat|autogen-core|autogen)\b/i },
  { framework: 'crewai', lang: 'python', match: /\bcrewai\b/i },
  { framework: 'haystack', lang: 'python', match: /\bhaystack\b/i },
  { framework: 'instructor', lang: 'python', match: /\binstructor\b.*python/i },
  { framework: 'openai', lang: 'python', match: /python.*\bopenai\b/i },
  { framework: 'anthropic', lang: 'python', match: /python.*\banthropic\b/i },
  { framework: 'chainlit', lang: 'python', match: /\bchainlit\s+run\b/i },
  { framework: 'streamlit-ai', lang: 'python', match: /\bstreamlit\s+run\b/i },
  { framework: 'gradio', lang: 'python', match: /\bgradio\b/i },

  // Node/JS-side frameworks (CLI tools tend to appear in argv as the entry script)
  { framework: 'claude-code', lang: 'node', match: /@anthropic-ai\/claude-code|claude-code/i },
  { framework: 'cursor-agent', lang: 'node', match: /cursor-agent/i },
  { framework: 'aider', lang: 'python', match: /\baider\b/i },
  { framework: 'continue-dev', lang: 'node', match: /continue\.continue/i },
  { framework: 'langchainjs', lang: 'node', match: /node.*@langchain\//i },
  { framework: 'vercel-ai-sdk', lang: 'node', match: /node.*@vercel\/ai\b/i },
  { framework: 'openai-node', lang: 'node', match: /node.*\bopenai\b/i },
  { framework: 'mastra', lang: 'node', match: /\bmastra\b/i },
  { framework: 'inngest-ai', lang: 'node', match: /\binngest\b.*\b(agent|workflow)\b/i },

  // Standalone AI agent executables
  { framework: 'ollama', lang: 'native', match: /\bollama(\s+(serve|run))\b/i },
  { framework: 'lm-studio', lang: 'native', match: /lm[\s-]?studio/i },
  { framework: 'gemini-cli', lang: 'native', match: /\bgemini\s+(chat|generate)/i },
];

export async function detect(ctx) {
  const findings = [];
  const errors = [];
  let itemsScanned = 0;

  let processes;
  try {
    processes = ctx.platform === 'win32'
      ? await listProcessesWindows()
      : await listProcessesUnix();
  } catch (err) {
    return { findings, errors: [{ message: err.message, recoverable: true }], stats: {} };
  }

  itemsScanned = processes.length;
  for (const p of processes) {
    if (!p.cmdLine) continue;
    for (const rule of RULES) {
      if (!rule.match.test(p.cmdLine)) continue;
      findings.push({
        type: 'running_agent',
        framework: rule.framework,
        language: rule.lang,
        pid: p.pid,
        processName: p.name,
        // Truncate cmd line — long, sometimes contains paths but never file contents.
        cmdLineExcerpt: p.cmdLine.length > 240 ? p.cmdLine.slice(0, 240) + '…' : p.cmdLine,
      });
      break; // one rule per process
    }
  }

  return { findings, errors, stats: { itemsScanned } };
}

async function listProcessesWindows() {
  // Use PowerShell + CIM. Slower than tasklist, but tasklist doesn't include
  // CommandLine. WMIC is deprecated/removed on newer Windows.
  const script =
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId, Name, CommandLine | " +
    "ConvertTo-Json -Compress";
  const { stdout } = await execAsync(
    `powershell.exe -NoProfile -NonInteractive -Command "${script}"`,
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true }
  );
  let arr;
  try { arr = JSON.parse(stdout); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((p) => ({
    pid: p.ProcessId,
    name: p.Name?.replace(/\.exe$/i, '') ?? '',
    cmdLine: p.CommandLine ?? '',
  })).filter((p) => p.pid);
}

async function listProcessesUnix() {
  const { stdout } = await execAsync('ps -A -o pid=,args=', { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim().split(/\r?\n/).map((line) => {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const pid = Number(m[1]);
    const cmdLine = m[2];
    const name = (cmdLine.split(/\s+/)[0] || '').split('/').pop();
    return { pid, name, cmdLine };
  }).filter(Boolean);
}
