import "./css/Agent.css";
import AgentNav from "./AgentNav/AgentNav";
import AgentTopNav from "./AgentNav/AgentTopNav";
import AgentChat from "./AgentChat";

const Agent = () => {
  return (
    <div className="cf_agentContainer">
      <AgentNav />
      <div className="cf_agentContent">
        <div className="cf_agentContent_chat">
          <AgentTopNav />
          <AgentChat />
        </div>
      </div>
    </div>
  );
};

export default Agent;
