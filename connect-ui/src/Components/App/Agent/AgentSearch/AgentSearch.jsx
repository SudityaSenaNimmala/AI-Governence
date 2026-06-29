import {
  ArrowUp,
  Check,
  MessageSquareText,
  Minimize2,
  Plus,
  Sparkles,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { getAIChatResponse2 } from "../AgentActions/AgentActions";
import { inputSuggestions, placeHolderTexts } from "../AgentUtils";
import "../css/Agent.css";

const AgentSearch = () => {
  const inputRef = useRef(null);
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [inputVal, setInputVal] = useState("");
  const [viewText, setViewText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFoucus, setIsInputFoucus] = useState(false);
  const [selectedContext, setSelectedContext] = useState("");
  const [isContextVisible, setIsContextVisible] = useState(false);
  const [selectConservation, setSelectConservation] = useState({});
  const [chatHistory, setChatHistory] = useState([]);

  const listCloud = ["GOOGLE_WORKSPACE", "SLACK", "MICROSOFT_OFFICE_365"];
  //   console.log(cloudsList);

  useEffect(() => {
    showPlaceHolder(0);
  }, []);

  const showPlaceHolder = (count) => {
    setViewText(placeHolderTexts[count]);
    setTimeout(() => {
      setViewText("");
      if (count + 1 === placeHolderTexts.length) {
        showPlaceHolder(0);
      } else {
        showPlaceHolder(count + 1);
      }
    }, 5000);
  };

  useEffect(() => {
    setSelectConservation({});
    setSelectedContext("");
    setInputVal("");
  }, [isInputFoucus]);

  const checkFocus = () => {
    if (inputRef.current === document.activeElement) {
      setIsInputFoucus(true);
    } else {
      setIsInputFoucus(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && inputVal.trim() !== "") {
      saveConservation();
    }
  };

  const saveConservation = (message = inputVal) => {
    setIsLoading(true);
    // getAIChatResponseStream(message);
    if (!selectConservation?.title) {
      let conse = {
        id: self.crypto.randomUUID(),
        title: message,
        vendor: selectedContext,
        conversation: [
          {
            user: message,
            isLoading: true,
          },
        ],
      };
      setSelectConservation(conse);
      getPromtAnswer(message, conse);
      setChatHistory([...chatHistory, ...[conse]]);
    } else {
      let conse = [...selectConservation?.conversation];
      conse.push({
        user: message,
        isLoading: true,
      });
      setSelectConservation({
        ...selectConservation,
        conversation: conse,
      });
      getPromtAnswer(message, {
        ...selectConservation,
        conversation: conse,
      });
      let copyChat = [...chatHistory];
      copyChat?.map((data, index) => {
        if (data?.id === selectConservation?.id) {
          copyChat[index].conversation = conse;
        }
      });
      setChatHistory(copyChat);
    }
    setInputVal("");
  };

  const getPromtAnswer = async (prompt, von) => {
    // let res = await getAIChatResponse(prompt);
    let res = await getAIChatResponse2(prompt, von?.vendor);

    if (res?.status === "OK") {
      setIsLoading(false);
      let samConservation = [...von?.conversation];
      console.log(samConservation);
      let obj = {
        user: prompt,
        ai: res?.res?.response,
        isLoading: false,
        type: "none",
      };
      samConservation[samConservation?.length - 1] = obj;
      setSelectConservation({
        ...von,
        conversation: samConservation,
      });
    } else {
      let samConservation = [...von?.conversation];
      console.log(samConservation);
      let obj = {
        user: prompt,
        ai: [],
        type: "ERROR",
        isLoading: false,
      };
      samConservation[samConservation?.length - 1] = obj;
      setSelectConservation({
        ...von,
        conversation: samConservation,
      });
      setIsLoading(false);
    }
  };

  const formatAiContent = (value, key, res) => {
    if (typeof value === "string") return value;
    if (key === "amount" || key === "totalAmount") return `$${value}`;
    if (typeof value === "boolean" && key === "isActive")
      return value ? (
        <div
          className="cf_new_verified_div"
          style={{
            fontSize: "12px",
            fontWeight: "500",
          }}
        >
          <Check size={12} strokeWidth={2} color="#166534" />
          <p>Active</p>
        </div>
      ) : (
        <div className="cf_new_unverified_div">
          <p>{res?.deleted ? "Deleted" : "InActive"}</p>
        </div>
      );
    if (typeof value === "boolean" && key === "verified")
      return value ? (
        <div
          className="cf_new_verified_div"
          style={{
            fontSize: "12px",
            fontWeight: "500",
          }}
        >
          <Check size={12} strokeWidth={2} color="#166534" />
          <p>Verified</p>
        </div>
      ) : (
        <div className="cf_new_unverified_div">
          <p
            style={{
              fontSize: "12px",
              fontWeight: "500",
            }}
          >
            Unverified
          </p>
        </div>
      );
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return value;
  };

  useEffect(() => {
    if (selectConservation?.id) {
      let copyChat = [...chatHistory];
      copyChat?.map((data, index) => {
        if (data?.id === selectConservation?.id) {
          copyChat[index].conversation = selectConservation?.conversation;
        }
      });
      setChatHistory(copyChat);
    }
  }, [selectConservation]);

  return (
    <div
      className={`${
        isInputFoucus
          ? `cf-agentSearch-container-open`
          : `cf-agentSearch-container`
      }`}
    >
      {isInputFoucus ? (
        <>
          <div className="cf_agentChatHistory_content">
            <div className="cf_agentChatHistory_content_wrap">
              <div
                className="cf_agentChatHistory_content_NewChat"
                onClick={() => {
                  setInputVal("");
                  setSelectedContext("");
                  setSelectConservation({});
                }}
              >
                <p>Start New Chat</p>
                <MessageSquareText color="#146aff" size={16} />
              </div>
            </div>
            <div className="cf_agentChatHistory_content_History">
              <div className="cf_agentChatHistory_content_History_ByDay">
                <p></p>
                <div className="cf_agentChatHistory_content_History_ChatTitle">
                  {chatHistory?.map((data, index) => {
                    return (
                      <p
                        key={`sugg_${data?.id}`}
                        onClick={() => setSelectConservation(data)}
                        className={
                          selectConservation?.id === data?.id
                            ? `cf_agentConservationActive`
                            : ``
                        }
                      >
                        {data?.title}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="cf_agentChat_body">
            <div className="cf_agentChat_body-content">
              <div style={{ padding: "0 20px" }}>
                <div className="cf_agentChat_body-Title">
                  {selectConservation?.title ? (
                    <p>{selectConservation?.title}</p>
                  ) : (
                    <>
                      <MessageSquareText color="#146aff" />
                      <p>New Chat</p>
                    </>
                  )}
                  <Minimize2
                    color="#146aff"
                    size={16}
                    strokeWidth={2}
                    onClick={() => setIsInputFoucus(false)}
                    style={{ marginLeft: "auto", cursor: "pointer" }}
                  />
                </div>
              </div>
              <div className="cf_agentChat_body-Chat">
                {selectConservation?.conversation ? (
                  <>
                    {selectConservation?.conversation?.map((data, index) => {
                      return (
                        <>
                          <div className="cf_agentContent_chat_questionWrapper">
                            <div>
                              <p style={{ color: "#454545" }}>{data?.user}</p>
                            </div>
                          </div>
                          {data?.isLoading ? (
                            <div
                              className="cf_agentContent_chat_AnswerWrapper"
                              style={{ gap: "10px" }}
                            >
                              <div
                                className="CF_d-flex"
                                style={{ gap: "10px" }}
                              >
                                <Sparkles
                                  className="cf_agentShine"
                                  size={24}
                                  strokeWidth={1.5}
                                />
                                <p
                                  style={{
                                    fontWeight: "500",
                                    color: "#757575",
                                  }}
                                >
                                  Analyzing...
                                </p>
                              </div>
                            </div>
                          ) : data?.ai?.length === 0 &&
                            data?.type !== "ERROR" ? (
                            <div className="cf_agentContent_chat_AnswerWrapper">
                              <div>
                                <p style={{ color: "#454545" }}>
                                  No Data Found !
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="cf_agentContent_chat_AnswerWrapper">
                              {data?.type === "ERROR" ? (
                                <div>
                                  <p style={{ color: "red" }}>
                                    Error Processing Your Request
                                  </p>
                                </div>
                              ) : (
                                <div
                                  className="cf_new_tables_div"
                                  style={{ color: "#454545" }}
                                >
                                  {/* <Markdown children={data?.ai} /> */}
                                  <p>{data?.ai}</p>
                                  {/* <table>
                                    <thead>
                                      <tr>
                                        <th style={{ width: "25px" }}></th>
                                        {Object.keys(
                                          getAIHeaders(data?.type)
                                        )?.map((head) => {
                                          return (
                                            <th style={{ textAlign: "left" }}>
                                              {getAIHeaders(data?.type)[head]}
                                            </th>
                                          );
                                        })}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {data?.ai?.map((row) => {
                                        return (
                                          <tr key={row?.id}>
                                            <td style={{ width: "25px" }}>
                                              <img
                                                src={cloudImageMapper(
                                                  row?.vendor ||
                                                    row?.providerName
                                                )}
                                                style={{
                                                  width: "20px",
                                                }}
                                              />
                                            </td>
                                            {Object.keys(
                                              getAIHeaders(data?.type)
                                            ).map((head) => {
                                              return (
                                                <td>
                                                  <p
                                                    style={{
                                                      fontSize: "12px",
                                                      fontWeight: "500",
                                                      whiteSpace: "nowrap",
                                                    }}
                                                  >
                                                    {formatAiContent(
                                                      row[head],
                                                      head,
                                                      row
                                                    )}
                                                  </p>
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table> */}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })}
                    {/* {isLoading ? (
                      <div
                        className="cf_agentContent_chat_AnswerWrapper"
                        style={{ gap: "10px" }}
                      >
                        <div className="CF_d-flex" style={{ gap: "10px" }}>
                          <Sparkles
                            className="cf_agentShine"
                            size={24}
                            strokeWidth={1.5}
                          />
                          <p style={{ fontWeight: "500", color: "#757575" }}>
                            Analyzing...
                          </p>
                        </div>
                      </div>
                    ) : (
                      ""
                    )} */}
                  </>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      height: "calc(100% - 10px)",
                    }}
                  >
                    <div className="cf_agentInputSuggestions">
                      {inputSuggestions?.map((data, index) => {
                        return (
                          <p
                            key={`sugg_${index}`}
                            onClick={() => {
                              setInputVal(data);
                              saveConservation(data);
                            }}
                          >
                            {data}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: "0 20px", width: "100%" }}>
              <div className="cf-agentSearch-container-openBody">
                {/* <Sparkles
                  className="cf_agentShine_noAnimi"
                  size={24}
                  strokeWidth={1.5}
                /> */}
                <div
                  className="cf_agentContext_container"
                  onMouseEnter={() => setIsContextVisible(true)}
                  onMouseLeave={() => setIsContextVisible(false)}
                >
                  {isContextVisible ? (
                    <div className="cf_agentContext_selector">
                      {cloudsList?.map((data, index) => {
                        return data?.providerName ? (
                          <div
                            key={`context_${index}`}
                            onClick={() => {
                              setSelectedContext(data?.providerName);
                              setIsContextVisible(false);
                            }}
                          >
                            <img
                              src={cloudImageMapper(data?.providerName)}
                              alt={data?.providerName}
                            />
                            <p>{getCloudName(data?.providerName)}</p>
                          </div>
                        ) : (
                          ""
                        );
                      })}
                    </div>
                  ) : (
                    ""
                  )}
                  {selectedContext || selectConservation?.vendor ? (
                    <img
                      src={cloudImageMapper(
                        selectedContext || selectConservation?.vendor
                      )}
                      alt={selectedContext || selectConservation?.vendor}
                      style={{ width: "25px" }}
                    />
                  ) : (
                    <Plus
                      className="cf_agentShine_noAnimi"
                      size={24}
                      style={{ cursor: "pointer" }}
                      strokeWidth={2}
                    />
                  )}
                </div>
                <input
                  type="text"
                  value={inputVal}
                  autoFocus={true}
                  placeholder={viewText}
                  className="cf-agentSearch"
                  onKeyDown={handleKeyPress}
                  onInput={(e) => setInputVal(e.target.value)}
                />
                <div className="cf_agentSendIconHolder">
                  <ArrowUp color="#001a6f" size={18} />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <Sparkles
            className="cf_agentShine_noAnimi"
            size={22}
            strokeWidth={1.5}
          />
          <input
            type="text"
            ref={inputRef}
            // onBlur={checkFocus}
            onFocus={checkFocus}
            placeholder={viewText}
            className="cf-agentSearch"
          />
          <div className="cf_agentSendIconHolder">
            <ArrowUp color="#001a6f" size={18} />
          </div>
        </>
      )}
    </div>
  );
};

export default AgentSearch;
