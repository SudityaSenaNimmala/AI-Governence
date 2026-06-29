import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Overview from './views/Overview.jsx';
import Machines from './views/Machines.jsx';
import MachineDetail from './views/MachineDetail.jsx';
import Tools from './views/Tools.jsx';
import ToolDetail from './views/ToolDetail.jsx';
import Shadow from './views/Shadow.jsx';
import Agents from './views/Agents.jsx';
import Dlp from './views/Dlp.jsx';
import ServerAgents from './views/ServerAgents.jsx';
import Discovered from './views/Discovered.jsx';
import Classifications from './views/Classifications.jsx';
import AiPlatforms from './views/AiPlatforms.jsx';
import AgentGovernance from './views/AgentGovernance/AgentGovernance.jsx';

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '') || 'overview';
  const [view, ...rest] = h.split('/');
  const raw = rest.join('/') || null;
  return { view, param: raw ? decodeURIComponent(raw) : null };
}

export default function App() {
  const [route, setRoute] = useState(parseHash());
  // embed mode removed — AI Hub views are built natively in connect-ui

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  let content;
  switch (route.view) {
    case 'machines':
      content = route.param ? <MachineDetail id={route.param} /> : <Machines />;
      break;
    case 'tools':
      content = route.param ? <ToolDetail toolKey={route.param} /> : <Tools />;
      break;
    case 'shadow':
      content = <Shadow />;
      break;
    case 'agents':
      content = <Agents />;
      break;
    case 'server-agents':
      content = <ServerAgents />;
      break;
    case 'discovered':
      content = <Discovered />;
      break;
    case 'classifications':
      content = <Classifications />;
      break;
    case 'ai-platforms':
      content = <AiPlatforms />;
      break;
    case 'agent-governance':
      content = <AgentGovernance />;
      break;
    case 'dlp':
      content = <Dlp />;
      break;
    case 'overview':
    default:
      content = <Overview />;
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Sidebar current={route.view} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar view={route.view} param={route.param} />
        <main className="flex-1 p-8 overflow-x-auto">
          <div className="max-w-[1400px] mx-auto">
            {content}
          </div>
        </main>
      </div>
    </div>
  );
}
