import React, { useEffect, useState } from "react";
import "./css/GlobalChatAgent.css";
import { cloudImageMapper } from "../../helpers/helpers";
import { Sparkles } from "lucide-react";
import AgentChat from "../Agent/AgentChat";

const GlobalChatAgent = () => {
  const [isChatShown, setIsChatShown] = useState(false);

  //   useEffect(() => {
  //     changeToggler(true);
  //   }, []);

  //   const changeToggler = (toggle) => {
  //     if (toggle) {
  //       setToggleCont(<img src={cloudImageMapper("CHAT")} />);
  //     } else {
  //       setToggleCont(<Sparkles className="cf_agentShine" size={24} />);
  //     }
  //     setTimeout(() => {
  //       changeToggler(!toggle);
  //     }, 3000);
  //   };

  return (
    <>
      {isChatShown ? (
        <div className="cf_GlobalChatPopUpContainer">
          <AgentChat
            options={{
              sparkleSize: 44,
              welcomTextGap: "10px",
              welcomTextSize: "13px",
              inputContentWidth: "80%",
              welcomTextPadding: "10px",
              welcomTextFontWeight: "500",
            }}
          />
        </div>
      ) : (
        ""
      )}
      <div
        className="cf_GlobalChatToggler"
        onClick={() => setIsChatShown(!isChatShown)}
      >
        <Sparkles className="cf_agentShine" size={28} strokeWidth={1} />
      </div>
    </>
  );
};

export default GlobalChatAgent;