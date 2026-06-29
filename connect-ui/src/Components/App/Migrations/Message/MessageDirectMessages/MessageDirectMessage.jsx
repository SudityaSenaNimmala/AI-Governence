import React, { useEffect, useState } from "react";
import TabSwitcher from "../../../../Resuables/TabSwitcher/TabSwitcher";
import MessageSourceUsers from "./MessageSourceUsers";
import MessageDMs from "./MessageDMs";
import MessageDestinationUsers from "./MessageDestinationUsers";
import DirectMessagesToSpaces from "./DirectMessagesToSpaces";
import { getClouCombinationCode } from "../../../../helpers/utils";

const MessageDirectMessage = () => {
  const [currentTab, setCurrentTab] = useState("SOURCE_USERS");
  const [tabMenu, setTabMenu] = useState([
    {
      id: "SOURCE_USERS",
      name: "Source Users",
    },
    {
      id: "DESTINATION_USERS",
      name: "Destination Users",
    },
    {
      id: "DIRECT_MESSAGES",
      name: "Direct Messages",
    },
    {
      id: "DIRECT_MESSAGES_TO_SPACES",
      name: "Direct Messages To Channels",
    },
  ]);

  useEffect(() => {
    let combination = getClouCombinationCode();
    handleTabSwitcherList(combination);
    if (
      combination === "C2C" ||
      combination === "T2C" ||
      combination === "W2C"
    ) {
      setCurrentTab("DIRECT_MESSAGES");
    } else if (
      combination === "T2T" ||
      combination === "W2V" ||
      combination === "C2T"
    ) {
      setCurrentTab("DESTINATION_USERS");
    }
  }, []);

  const handleTabSwitcherList = (currentTab) => {
    switch (currentTab) {
      case "S2C":
        setTabMenu([
          {
            id: "SOURCE_USERS",
            name: "Source Users",
          },
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
          {
            id: "DIRECT_MESSAGES_TO_SPACES",
            name: "Direct Messages To Spaces",
          },
        ]);
        break;
      case "S2S":
        setTabMenu([
          {
            id: "SOURCE_USERS",
            name: "Source Users",
          },
          {
            id: "DESTINATION_USERS",
            name: "Destination Users",
          },
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
        ]);
        break;
      case "C2T":
        setTabMenu([
          {
            id: "DESTINATION_USERS",
            name: "Destination Users",
          },
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
        ]);
        break;
      case "C2C":
        setTabMenu([
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
        ]);
        break;
      case "W2C":
        setTabMenu([
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
        ]);
        break;
      case "W2V":
        setTabMenu([
          {
            id: "DESTINATION_USERS",
            name: "Destination Users",
          },
        ]);
        break;
      case "T2C":
        setTabMenu([
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
        ]);
        break;
      case "T2T":
        setTabMenu([
          {
            id: "DESTINATION_USERS",
            name: "Destination Users",
          },
          {
            id: "DIRECT_MESSAGES",
            name: "Direct Messages",
          },
        ]);
      default:
        break;
    }
  };

  useEffect(() => {
    let lastObject = JSON.parse(localStorage?.lastTracker);
    let maps = { ...lastObject };
    maps.currentTab = currentTab;
    localStorage.setItem("lastTracker", JSON.stringify(maps));
  }, [currentTab]);

  return (
    <>
      <TabSwitcher
        tabMenu={tabMenu}
        currentTab={currentTab}
        returnCurrentTab={(e) => setCurrentTab(e)}
      />
      {currentTab === "SOURCE_USERS" ? (
        <MessageSourceUsers currentTab="source" />
      ) : (
        ""
      )}
      {currentTab === "DESTINATION_USERS" ? (
        <MessageSourceUsers currentTab="destination" />
      ) : (
        ""
      )}
      {/* {currentTab === "DESTINATION_USERS" ? <MessageDestinationUsers /> : ""} */}
      {currentTab === "DIRECT_MESSAGES" ? <MessageDMs /> : ""}
      {currentTab === "DIRECT_MESSAGES_TO_SPACES" ? (
        <DirectMessagesToSpaces />
      ) : (
        ""
      )}
    </>
  );
};

export default MessageDirectMessage;
