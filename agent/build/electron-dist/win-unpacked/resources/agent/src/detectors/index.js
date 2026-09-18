import * as desktopApps from './desktop_apps.js';
import * as browserHistory from './browser_history.js';
import * as ideExtensions from './ide_extensions.js';
import * as agentConfigs from './agent_configs.js';
import * as apiKeys from './api_keys.js';
import * as agentProjects from './agent_projects.js';
import * as runningAgents from './running_agents.js';
import * as deepFilesystem from './deep_filesystem.js';

export const detectors = [
  desktopApps,
  browserHistory,
  ideExtensions,
  agentConfigs,
  apiKeys,
  agentProjects,
  runningAgents,
  deepFilesystem,
];
