import React, { useContext, useState } from "react";
import "./css/Message.css";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import MessageBreadCrumbs from "./MessageBreadCrumbs";
import MessageUserMapping from "./MessageUserMapping";
// import MessageChannels from "./MessageChannels";
import MessageDirectMessage from "./MessageDirectMessages/MessageDirectMessage";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import MessagePreMigration from "./MessagePreMigration/MessagePreMigration";
import Selection from "../Content/Selection";
const Message = () => {
  const { globalContext } = useContext(GlobalContext);
  const [contentState, setContentState] = useState({
    atPosition: 1,
    previousPosition: 0,
    nextPosition: 2,
  });

  return (
    <div className="cf_main_container">
      <SideNav activeTab="Migrate" subMenuActive="Message Migration" />
      <div className="cf_main_content_place">
        <TopNav pageName="Message Migration" />
        <div className="cf_main_content_place_main">
          <MessageBreadCrumbs contentState={(e) => setContentState(e)} />
          <div
            className={
              contentState.atPosition === 1
                ? "cf_message_content_placer"
                : "cf_d-none"
            }
            style={{ height: "85%" }}
          >
            <Selection type="MESSAGE" />
          </div>
          <div
            className={
              contentState.atPosition === 2
                ? "cf_message_content_placer"
                : "cf_d-none"
            }
            style={{ height: "85%" }}
          >
            <MessagePreMigration
              atPosition={contentState?.atPosition}
              previousPosition={contentState?.previousPosition}
            />
          </div>

          {globalContext?.sourceCloud?.cloudName === "SLACK" &&
            globalContext?.destinationCloud?.cloudName === "MICROSOFT_TEAMS" ? (
            <>
              <div className={contentState.atPosition === 3 ? "" : "cf_d-none"}>
                <MessageUserMapping
                  activeTab="USERS"
                  atPosition={contentState.atPosition}
                  previousPosition={contentState?.previousPosition}
                  sourceCloud={globalContext?.sourceCloud?.cloudName}
                  destinationCloud={globalContext?.destinationCloud?.cloudName}
                />
              </div>
              {contentState.atPosition >= 4 ? <MessageDirectMessage /> : ""}
            </>
          ) : (
            <>
              {contentState.atPosition === 3 ||
                contentState.atPosition === 4 ? (
                <MessageUserMapping
                  activeTab={
                    contentState.atPosition === 3 ? "USERS" : "PUBLIC_CHANNELS"
                  }
                  atPosition={contentState.atPosition}
                  sourceCloud={globalContext?.sourceCloud?.cloudName}
                  destinationCloud={globalContext?.destinationCloud?.cloudName}
                />
              ) : (
                ""
              )}
              {contentState.atPosition >= 5 ? <MessageDirectMessage /> : ""}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Message;
