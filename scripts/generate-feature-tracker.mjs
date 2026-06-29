import { writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const data = [
  ['Feature', 'Sub-Feature', 'Sub-Sub-Feature', 'Description', 'How to Test', 'Completion %', 'Notes'],

  // 1. BROWSER EXTENSION
  ['Browser Extension', '', '', 'Chrome extension for web AI governance', '', '', ''],
  ['', 'Sensitive Data Blocking', '', 'Blocks prompts containing secrets/PII', '', '', ''],
  ['', '', 'API Key Detection', 'OpenAI, Anthropic, Google, AWS, GitHub, Slack, GitLab keys', 'Paste sk-proj-abc123... into ChatGPT', '', ''],
  ['', '', 'PII Detection', 'SSN, credit card, IBAN, US phone', 'Paste 123-45-6789 into any AI chat', '', ''],
  ['', '', 'Fetch Interception', 'Patches fetch() to block before send', 'Send sensitive data in ChatGPT', '', ''],
  ['', '', 'XHR Interception', 'Patches XMLHttpRequest for older services', 'Test on services using XHR', '', ''],
  ['', '', 'Warning Banner', 'Shows red warning when data is blocked', 'Trigger a block — banner appears', '', ''],
  ['', 'Agent Blocking', '', 'Blocks specific AI agents for all users', '', '', ''],
  ['', '', 'Blocked List Sync', 'Polls server every 2 min for blocked agents', 'Block agent in dashboard, extension picks it up', '', ''],
  ['', '', 'DOM Input Disabling', 'Disables textbox when blocked agent active', 'Open blocked agent chat, input greyed out', '', ''],
  ['', '', 'Enter Key Capture', 'Blocks Enter at capture phase', 'Press Enter in blocked agent chat', '', ''],
  ['', '', 'Send Button Capture', 'Blocks send button click in composer area', 'Click send in blocked agent chat', '', ''],
  ['', '', 'Agent Name Detection', 'Matches header/title to identify agent', 'Switch between blocked and unblocked agents', '', ''],
  ['', '', 'No False Positives', 'Only blocks exact agent name match', 'Similar-named agent should NOT be blocked', '', ''],
  ['', '', 'Previous Chat Blocking', 'Blocks in existing conversations too', 'Open old chat with blocked agent', '', ''],
  ['', 'Enrollment', '', 'Server URL + enrollment secret config', 'Open extension popup, enter server URL', '', ''],
  ['', 'Event Reporting', '', 'DLP events sent to governance server', 'Trigger a block, check DLP tab', '', ''],
  ['', 'File Upload Scanning', '', 'Scans file uploads for sensitive content', 'Upload a .env file to ChatGPT', '', ''],
  ['', 'Multi-Service Support', '', 'Works on 10+ AI services', 'Test on ChatGPT, Claude, Gemini, Copilot', '', ''],
  ['', 'Chrome Web Store', '', 'Published for one-click install', 'Check store listing', '', ''],

  // 2. ELECTRON DESKTOP APP
  ['Electron Desktop App', '', '', 'System tray app for desktop governance', '', '', ''],
  ['', 'System Tray', '', 'Tray icon with start/stop/dashboard/quit', 'Right-click tray icon', '', ''],
  ['', 'Dashboard Window', '', 'Status cards, monitor grid, alerts list', 'Open dashboard from tray', '', ''],
  ['', '', 'Monitor Status Card', 'Shows Running/Stopped with live updates', 'Start/stop monitoring', '', ''],
  ['', '', 'Enrollment Status', 'Shows enrolled/not enrolled + server URL', 'Check dashboard cards', '', ''],
  ['', '', 'DLP Events Counter', 'Live count of detected events', 'Trigger events, counter updates', '', ''],
  ['', '', 'Active Monitors Grid', 'Shows status of each monitor component', 'Check all show Active when running', '', ''],
  ['', '', 'Recent Alerts List', 'Scrolling list of DLP events', 'Trigger alerts, appear in list', '', ''],
  ['', 'Settings Page', '', 'Server URL, enrollment, toggles', '', '', ''],
  ['', '', 'Server Configuration', 'URL + enrollment secret + enroll button', 'Change server URL and enroll', '', ''],
  ['', '', 'Monitor Toggles', 'Toggle clipboard, file dialogs, prompts, etc.', 'Toggle settings and save', '', ''],
  ['', '', 'Auto-Start on Boot', 'Start on Windows boot (registry)', 'Enable and reboot', '', ''],
  ['', 'Browser Extension Page', '', 'Download button + install guide', '', '', ''],
  ['', '', 'Download Extension', 'Copies extension to user-chosen folder', 'Click Download Extension', '', ''],
  ['', '', '6-Step Install Guide', 'Step-by-step guide with links', 'Follow the steps', '', ''],
  ['', 'Desktop Hooks Page', '', 'ASAR injection for Electron AI apps', '', '', ''],
  ['', '', 'Injection Button', 'Run ASAR Injection (requires Admin)', 'Click button, should prompt UAC', '', ''],
  ['', 'Background Monitoring', '', 'Wraps OsMonitor via monitor-runner', '', '', ''],
  ['', '', 'Auto-Start Monitor', 'Starts monitor when app opens', 'Launch app, monitor starts automatically', '', ''],
  ['', '', 'Blocked Agents Sync', 'Polls server every 30s writes local JSON', 'Block agent in dashboard, enforcer picks up', '', ''],
  ['', 'App Icon/Branding', '', 'CloudFuze logo in tray, taskbar, sidebar', 'Check tray icon and window', '', ''],
  ['', 'NSIS Installer Config', '', 'Windows installer with shortcuts', 'Run npm run dist:win', '', ''],

  // 3. OS MONITOR
  ['OS Monitor', '', '', 'System-level AI usage monitoring', '', '', ''],
  ['', 'Clipboard DLP', '', 'Detects sensitive data pasted into AI apps', 'Copy API key, paste into Claude Desktop', '', ''],
  ['', 'File Dialog Watcher', '', 'Detects files opened via picker in AI apps', 'Click attach in ChatGPT, pick .env file', '', ''],
  ['', 'Typed Prompt Scanner', '', 'Reads typed text via UIA in AI prompts', 'Type an API key into Claude Desktop', '', ''],
  ['', 'Attachment Watcher', '', 'Detects drag-drop files into AI apps', 'Drag a .csv file into ChatGPT', '', ''],
  ['', 'Send Blocker (Enforcer)', '', 'Blocks Enter + send button click', '', '', ''],
  ['', '', 'Enter Key Blocking', 'Swallows Enter when sensitive data detected', 'Paste API key in Claude, press Enter', '', ''],
  ['', '', 'Send Button Blocking', 'Blocks click in bottom-right zone', 'Paste API key, click send button', '', ''],
  ['', '', 'Block Cooldown (30s)', 'Keeps blocking after first block fires', 'Dismiss toast, try Enter again within 30s', '', ''],
  ['', '', 'Sticky Focus (3s)', 'Keeps state during toast notifications', 'Dismiss toast quickly, try send', '', ''],
  ['', '', 'Paste Window (5s)', 'Clipboard checked within 5s of Ctrl+V', 'Paste secret, press Enter within 5s', '', ''],
  ['', '', 'Typed Buffer TTL (60s)', 'Typed pattern expires after 60s', 'Type secret, wait 60s, press Enter', '', ''],
  ['', '', 'IDE Exclusion', 'UIA disabled for Cursor/VSCode', 'Type in Cursor terminal, no false block', '', ''],
  ['', '', 'Override (Ctrl+Alt+Enter)', 'Sends anyway, logged as override', 'Block fires, press Ctrl+Alt+Enter', '', ''],
  ['', 'Blocked Agent Enforcement', '', 'Desktop enforcement of blocked agents', '', '', ''],
  ['', '', 'Blocked Agents File Read', 'Reads blocked-agents.json from server', 'Block agent, check JSON file updates', '', ''],
  ['', '', 'Platform-to-Process Map', 'Maps platform to process name', 'Open blocked agent in Copilot app', '', ''],
  ['', '', 'Full Send Block', 'All Enter + clicks blocked for blocked agent', 'Try sending in blocked agent desktop app', '', ''],
  ['', 'Toast Notifications', '', 'Native Windows toasts on detection', 'Paste secret, toast appears', '', ''],
  ['', 'AI Process Detection', '', 'Identifies AI processes', '', '', ''],
  ['', '', 'ChatGPT Desktop', 'Process: ChatGPT', 'Open ChatGPT Desktop', '', ''],
  ['', '', 'Claude Desktop', 'Process: Claude', 'Open Claude Desktop', '', ''],
  ['', '', 'Cursor IDE', 'Process: Cursor', 'Open Cursor', '', ''],
  ['', '', 'M365 Copilot', 'Process: M365Copilot', 'Open M365 Copilot', '', ''],
  ['', '', 'Gemini Desktop', 'Process: Gemini', 'Open Gemini Desktop', '', ''],
  ['', '', 'Poe Desktop', 'Process: Poe', 'Open Poe', '', ''],
  ['', 'Event Reporter', '', 'Batches events and sends to server', 'Trigger events, check DLP tab', '', ''],

  // 4. MACHINE SCANNER
  ['Machine Scanner', '', '', 'Scans machine for AI tools and secrets', '', '', ''],
  ['', 'API Key Detection', '', 'Finds API keys in env vars and configs', 'Run Scan from Electron app', '', ''],
  ['', 'Desktop App Detection', '', 'Finds installed AI desktop apps', 'Run scan, check Tools tab', '', ''],
  ['', 'IDE Extension Detection', '', 'Finds AI extensions in VS Code, Cursor', 'Run scan, check findings', '', ''],
  ['', 'Browser History Scan', '', 'Detects visits to AI websites', 'Run scan, check findings', '', ''],
  ['', 'Agent Projects Scan', '', 'Finds AI agent config files on disk', 'Run scan, check findings', '', ''],
  ['', 'Running Process Scan', '', 'Detects running AI processes', 'Run scan, check findings', '', ''],
  ['', 'Deep Filesystem Scan', '', 'Scans files for secrets and AI configs', 'Run scan, takes a few minutes', '', ''],
  ['', 'Report Upload', '', 'Uploads results to governance server', 'Run scan, data appears in dashboard', '', ''],

  // 5. ASAR DESKTOP INJECTOR
  ['ASAR Desktop Injector', '', '', 'Injects DLP hooks into Electron AI apps', '', '', ''],
  ['', 'Cursor Injection', '', 'Hooks into Cursor IDE bundle', 'Run injection from Electron app', '', ''],
  ['', 'Claude Desktop Injection', '', 'Hooks into Claude Desktop (non-Store)', 'Run injection, check if hook loads', '', ''],
  ['', 'ChatGPT Desktop Injection', '', 'Hooks into ChatGPT Desktop', 'Run injection', '', ''],
  ['', 'Idempotent Re-injection', '', 'Safe to run multiple times', 'Run injection twice, no duplicates', '', ''],
  ['', 'Mac Codesign', '', 'Ad-hoc re-signs .app bundle on macOS', 'Test on Mac after injection', '', ''],

  // 6. HTTPS DLP PROXY
  ['HTTPS DLP Proxy', '', '', 'Network-level interception for API calls', '', '', ''],
  ['', 'CA Certificate Gen', '', 'Generates and trusts CloudFuze CA', 'Run --proxy, check cert store', '', ''],
  ['', 'MITM Interception', '', 'Intercepts HTTPS to AI vendors', 'Route API call through proxy', '', ''],
  ['', 'Pattern Scanning', '', 'Scans request bodies for secrets', 'Send API key through proxy', '', ''],
  ['', 'Block Response (451)', '', 'Returns 451 for blocked requests', 'Check response code on block', '', ''],
  ['', 'Uninstall', '', 'Removes CA from trust store', 'Run --proxy --uninstall', '', ''],

  // 7. WEB DASHBOARD
  ['Web Dashboard', '', '', 'Governance dashboard at localhost:8080', '', '', ''],
  ['', 'Overview Tab', '', 'Totals, top tools, findings by type', 'Open dashboard, check stats', '', ''],
  ['', 'Machines Tab', '', 'Enrolled machines with scan history', 'Check machine list and details', '', ''],
  ['', 'Tools Catalog Tab', '', 'All discovered AI tools across machines', 'Check tool catalog', '', ''],
  ['', 'Shadow AI Tab', '', 'Unapproved/unknown tools', 'Check shadow AI list', '', ''],
  ['', 'DLP Events Tab', '', 'Clipboard/paste/typed prompt events', 'Trigger events, check DLP tab', '', ''],
  ['', 'AI Platforms Tab', '', 'Registry of known AI platforms', 'Check platform list', '', ''],
  ['', 'Agent Governance Tab', '', 'Multi-platform AI agent governance', '', '', ''],
  ['', '', 'Microsoft 365 Connect', 'OAuth connect to Microsoft tenant', 'Connect with client ID/secret', '', ''],
  ['', '', 'Google Cloud Connect', 'Service account connect to GCP', 'Connect with JSON key', '', ''],
  ['', '', 'OpenAI Connect', 'API key + session token', 'Connect with API key', '', ''],
  ['', '', 'Claude/Anthropic Connect', 'API key + session key', 'Connect with API key', '', ''],
  ['', '', 'Gemini Enterprise Connect', 'Access token connect', 'Connect with token', '', ''],
  ['', '', 'Discovery Scan', 'Parallel scan of all connected platforms', 'Click Run Scan', '', ''],
  ['', '', 'Discovery Persistence', 'Agents saved to MongoDB on scan', 'Run scan, refresh, data persists', '', ''],
  ['', '', 'Overview Sub-tab', 'Agent stats, risk distribution, charts', 'Check overview metrics', '', ''],
  ['', '', 'Discovery Sub-tab', 'Full agent table with actions', 'Browse all discovered agents', '', ''],
  ['', '', 'User Activity Sub-tab', 'Chat transcripts, AI safety, risk mgmt', 'Check AI Safety → Risk Management', '', ''],
  ['', '', 'Stale Agents Sub-tab', 'Idle/inactive agent detection', 'Check stale agents list', '', ''],
  ['', '', 'Cost Sub-tab', 'Azure/Google/OpenAI cost tracking', 'Check cost breakdown', '', ''],
  ['', '', 'Policies Sub-tab', 'Create and manage governance policies', 'Create a test policy', '', ''],
  ['', '', 'Block Agent Button', 'Block/unblock in Discovery + Risk Mgmt', 'Click Block, test in Copilot browser', '', ''],
  ['', '', 'Approval Dropdown', 'Set approval status per agent', 'Change an agent approval status', '', ''],
  ['', '', 'Suspend/Delete Actions', 'Suspend via Dataverse, delete via API', 'Suspend a Copilot Studio agent', '', ''],
  ['', '', 'Risk Scoring', 'Auto-computed risk scores per agent', 'Check risk scores and factors', '', ''],
  ['', '', 'Recertification', 'Governance review workflows', 'Launch a recertification campaign', '', ''],
  ['', '', 'Knowledge & Files', 'Agent data source and file audit', 'Check knowledge sources', '', ''],
  ['', '', 'Prompt Monitoring', 'Conversation analysis for sensitive data', 'Analyze prompts for a bot', '', ''],
  ['', 'Server Agents Tab', '', 'Server-side LLM API call monitoring', 'Requires Linux server-monitor daemon', '', ''],

  // 8. SERVER (BACKEND)
  ['Server (Backend)', '', '', 'API server with MongoDB', '', '', ''],
  ['', 'Enrollment API', '', 'Machine enrollment with secrets', 'Enroll from extension or agent', '', ''],
  ['', 'Reports API', '', 'Scan report upload and storage', 'Run scan, report uploads', '', ''],
  ['', 'DLP Events API', '', 'DLP event ingestion and querying', 'Check /api/v1/dlp endpoint', '', ''],
  ['', 'Blocked Agents API', '', 'Block/unblock + public list endpoint', 'Block agent, check API response', '', ''],
  ['', 'Governance Routes', '', 'Discovery, lifecycle, policies, alerts, cost', 'Test via dashboard tabs', '', ''],
  ['', 'MongoDB Persistence', '', 'All data persisted in MongoDB Atlas', 'Restart server, data survives', '', ''],
  ['', 'Health Check', '', 'GET /api/v1/health', 'curl localhost:8787/api/v1/health', '', ''],

  // 9. INSTALLERS
  ['Installers', '', '', 'Platform-specific installation scripts', '', '', ''],
  ['', 'Windows Installer', '', 'PowerShell script + NSIS config', 'Run install.ps1', '', ''],
  ['', 'macOS Installer', '', 'Shell script installer', 'Run install.sh on Mac', '', ''],
  ['', 'Linux Installer', '', 'Shell script + systemd service', 'Run install.sh on Linux', '', ''],
  ['', 'Server Monitor Installer', '', 'Linux daemon for server-side monitoring', 'Run server-monitor/install.sh', '', ''],
  ['', 'Docker Support', '', 'Dockerfile for containerized deployment', 'docker build + docker run', '', ''],
];

const csv = data.map(row =>
  row.map(cell => '"' + cell.replace(/"/g, '""') + '"').join(',')
).join('\n');

const outPath = join(homedir(), 'Desktop', 'CloudFuze_Feature_Tracker.csv');
writeFileSync(outPath, '\ufeff' + csv, 'utf8'); // BOM for Excel
console.log('Created:', outPath);
console.log('Features:', data.length - 1, 'rows');
