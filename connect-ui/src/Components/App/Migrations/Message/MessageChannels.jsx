import React, { useState } from "react";
import TabSwitcher from "../../../Resuables/TabSwitcher/TabSwitcher";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { cloudImageMapper } from "../../../helpers/helpers";
import { FaHashtag, FaLock } from "react-icons/fa6";
import MessageChannelsTables from "./MessageChannels/MessageChannelsTables";
import { getClouCombinationCode } from "../../../helpers/utils";

const MessageChannels = () => {
  const [currentTab, setCurrentTab] = useState("PUBLIC_CHANNELS");
  let tabMenu =
    getClouCombinationCode() === "C2T"
      ? [
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Spaces",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Spaces",
          },
        ]
      : [
          {
            id: "PUBLIC_CHANNELS",
            name: "Public Channels",
          },
          {
            id: "PRIVATE_CHANNELS",
            name: "Private Channels",
          },
        ];
  return (
    <>
      <TabSwitcher
        tabMenu={tabMenu}
        returnCurrentTab={(e) => setCurrentTab(e)}
      />
      <MessageChannelsTables currentTab={currentTab} />
    </>
  );
};

export default MessageChannels;
