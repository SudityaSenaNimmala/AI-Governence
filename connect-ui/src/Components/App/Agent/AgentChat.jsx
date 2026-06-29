import React, { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { placeHolderTexts } from "./AgentUtils";
import AgentTopNav from "./AgentNav/AgentTopNav";

const AgentChat = (props) => {
  const [agentChat, setAgentChat] = useState([]);
  const [viewText, setViewText] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isInputFoucus, setIsInputFoucus] = useState(false);
  const inputRef = useRef(null);
  const {
    sparkleSize,
    welcomTextGap,
    welcomTextSize,
    welcomTextPadding,
    inputContentWidth,
    welcomTextFontWeight,
  } = {
    ...props?.options,
  };
  useEffect(() => {
    showPlaceHolder(0);
  }, []);

  const showPlaceHolder = (count) => {
    setViewText(<p>{placeHolderTexts[count]}</p>);
    setTimeout(() => {
      setViewText("");
      if (count + 1 === placeHolderTexts.length) {
        showPlaceHolder(0);
      } else {
        showPlaceHolder(count + 1);
      }
    }, 2500);
  };

  const checkFocus = () => {
    if (inputRef.current === document.activeElement) {
      setIsInputFoucus(true);
    } else {
      setIsInputFoucus(false);
    }
  };

  const getHighlightedText = (text) => {
    if (!agentInput) return text;

    const regex = new RegExp(`(${agentInput})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
      part.toLowerCase() === agentInput.toLowerCase() ? (
        <span key={index} style={{ color: "#0062ff" }}>
          {part}
        </span>
      ) : (
        part
      )
    );
  };



  return (
    <>
      <div className="cf_agentContent_chat_container">
        <div
          className={`cf_agentContent_chat_container_welcome ${
            agentChat?.length > 0 ? "agentWelcomeMoveDisapper" : ""
          }`}
          style={{
            padding: welcomTextPadding || "0px",
            gap: welcomTextGap || "15px",
          }}
        >
          <Sparkles
            className="cf_agentShine"
            size={sparkleSize || 24}
            strokeWidth={1}
          />
          <div className="cf_agentContent_chat_container_welcome_wrapper">
            <p
              style={{
                fontSize: welcomTextSize || "18px",
                fontWeight: welcomTextFontWeight || "400",
              }}
            >
              Welcome! Let our AI help you manage your SaaS products easily and
              save you time and money.
            </p>
          </div>
        </div>
        {agentChat?.length > 0 ? (
          <div className="cf_agentContent_chat_container_chat">
            {agentChat?.map((data) => {
              return (
                <>
                  <div className="cf_agentContent_chat_questionWrapper">
                    <div>
                      <p>{data?.q}</p>
                    </div>
                  </div>
                  {data?.a === "null" ? (
                    <div
                      className="cf_agentContent_chat_AnswerWrapper"
                      style={{ gap: "10px" }}
                    >
                      <div className="CF_d-flex" style={{ gap: "10px" }}>
                        <Sparkles
                          className="cf_agentShine"
                          size={24}
                          strokeWidth={1}
                        />
                        <p style={{ fontWeight: "500", color: "#757575" }}>
                          Analyzing...
                        </p>
                      </div>
                    </div>
                  ) : data?.a ? (
                    <div className="cf_agentContent_chat_AnswerWrapper">
                      <div>
                        <p>{data?.a}</p>
                      </div>
                    </div>
                  ) : (
                    ""
                  )}
                </>
              );
            })}
          </div>
        ) : (
          ""
        )}
      </div>
      <div className="cf_agentContent_chat_input_content">
        <div
          style={{ width: inputContentWidth || "70%", position: "relative" }}
        >
          {isSearching ? (
            <div className="cf_agent_chatInput_Suggestions">
              {placeHolderTexts
                ?.filter((data) => {
                  return data
                    ?.toLocaleLowerCase()
                    ?.includes(agentInput?.toLocaleLowerCase());
                })
                ?.map((data) => {
                  return (
                    <div
                      onClick={() => {
                        setIsSearching(false);
                        setAgentInput(data);
                      }}
                    >
                      <p>{getHighlightedText(data)}</p>
                    </div>
                  );
                })}
            </div>
          ) : (
            ""
          )}
          <input
            type="text"
            className="cf_agent_chatInput"
            ref={inputRef}
            onFocus={checkFocus}
            onBlur={checkFocus}
            value={agentInput}
            onInput={(e) => {
              if (e.target.value) {
                setAgentInput(e.target.value);
                setIsSearching(true);
              } else {
                setAgentInput(e.target.value);
                setIsSearching(false);
              }
            }}
          />
          {!isInputFoucus && !agentInput ? (
            <div
              className="cf_agent_suggestPlaceHolder"
              onClick={() => {
                inputRef.current.focus();
              }}
            >
              {viewText}
            </div>
          ) : (
            ""
          )}
        </div>
        <button
          className="cf_agent_chatInput_send CF_Pointer"
          onClick={() => {
            if (agentInput) {
              let res = [...agentChat];
              let newChat = {
                q: agentInput,
                a: "null",
              };
              res.push(newChat);
              setIsSearching(false);
              setAgentInput("");
              setAgentChat(res);
            }
          }}
        >
          <Send size={18} color="#fff" />
        </button>
      </div>
    </>
  );
};

export default AgentChat;
