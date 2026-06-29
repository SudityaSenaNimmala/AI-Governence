import { useContext } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper } from "../../../helpers/helpers";

const AgentTopNav = () => {
  const { globalContext } = useContext(GlobalContext);
 
  const getNavName = () => {
    const inputString = globalContext?.user?.name ?? "";
    const words = inputString.split(" ");
    const firstLetters = words.map((word) => word.charAt(0));
    const name = firstLetters.join("");
    return name;
  };
  return (
    <div className="cf_agentTopNav">
      <img src={cloudImageMapper("AGENT")} alt="" />
      <div className="cf_topNav_userProfile">{getNavName()}</div>
    </div>
  );
};

export default AgentTopNav;
