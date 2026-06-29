import React, { useContext, useEffect, useState } from "react";
import { TfiAngleLeft, TfiAngleRight } from "react-icons/tfi";
import { Link, useNavigate } from "react-router-dom";
import {
  SET_SELECTED_CHANNELS_MAPPING,
  SET_SELECTED_DMS_MAPPING,
} from "../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  getClouCombinationCode,
  getSelectedDestinationCloudId,
  getSelectedDestinationCloudName,
  getSelectedSourceCloudId,
  getSelectedSourceCloudName,
  notifyToast,
} from "../../../helpers/utils";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import {
  initiateMessageMigration,
  initiateMessageMigrationForDms,
  initiateMessageMigrationForExportDump,
} from "./MessageActions/MessageActions";
import { Trash2 } from "lucide-react";

const MessageBreadCrumbs = (props) => {
  const navigation = useNavigate();
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { channelsMappingsList, dmsMappingsList } = globalContext;
  const [teamMigration, setTeamMigration] = useState({
    atPosition: 1,
    previousPosition: 0,
    nextPosition: 2,
  });

  useEffect(() => {
    let maps = { ...teamMigration };
    maps.currentTab = "";
    localStorage.setItem("lastTracker", JSON.stringify(maps));
  }, [teamMigration]);

  const changeState = (action) => {
    let currentPosition = teamMigration?.atPosition,
      lastPosition = teamMigration?.atPosition;
    if (
      globalContext?.sourceCloud?.cloudName === "SLACK" &&
      globalContext?.destinationCloud?.cloudName === "MICROSOFT_TEAMS"
    ) {
      switch (action) {
        case "BACK":
          currentPosition === 4
            ? (currentPosition -= 2)
            : (currentPosition -= 1);
          break;
        case "NEXT":
          currentPosition < 4 ? (currentPosition += 1) : "";
          break;
        default:
          break;
      }
    } else {
      switch (action) {
        case "BACK":
          currentPosition === 5
            ? (currentPosition -= 2)
            : (currentPosition -= 1);
          break;
        case "NEXT":
          currentPosition < 5 ? (currentPosition += 1) : "";
          break;
        default:
          break;
      }
    }

    setTeamMigration({
      ...teamMigration,
      atPosition: currentPosition,
      previousPosition: lastPosition,
      nextPosition: currentPosition + 1,
    });
    props.contentState({
      atPosition: currentPosition,
      previousPosition: lastPosition,
      nextPosition: lastPosition + 1,
    });
  };

  useEffect(() => {
    if (
      globalContext?.sourceCloud?.cloudName === "SLACK" &&
      globalContext?.destinationCloud?.cloudName === "MICROSOFT_TEAMS"
    ) {
      if (teamMigration?.atPosition === 4) {
        if (channelsMappingsList?.export?.length > 0) {
          startMigrationForExportDump();
        } else if (dmsMappingsList?.dms?.length > 0) {
          startMessageMigrationForDms();
        } else {
          startMessageMigrationForChannels();
        }
      }
    } else {
      if (teamMigration?.atPosition === 5) {
        if (channelsMappingsList?.export?.length > 0) {
          startMigrationForExportDump();
        } else if (dmsMappingsList?.dms?.length > 0) {
          startMessageMigrationForDms();
        } else {
          startMessageMigrationForChannels();
        }
      }
    }
  }, [teamMigration?.atPosition]);

  const startMigrationForExportDump = async () => {
    let list = [];
    let combinationCode = getClouCombinationCode();

    let maps = {
      atPosition: 4,
      previousPosition: 3,
      nextPosition: 4,
      currentTab: "DIRECT_MESSAGES_TO_SPACES",
    };
    localStorage.setItem("lastTracker", JSON.stringify(maps));

    channelsMappingsList?.export?.map((data) => {
      let obj = {
        fromCloudId: {
          id: data?.fromCloudId,
        },
        toCloudId: {
          id: getSelectedDestinationCloudId(),
        },
        sourceDelegateCloudId: data?.sourceAdminCloudId
          ? data?.sourceAdminCloudId
          : data?.fromCloudId,
        fromRootId: data?.fromRootId,
        toRootId: "/",
        channelDate: "null",
        channelName: data?.channelName,
        channelType: "export",
        specialCharacter: "-",
        workSpaceName: globalContext?.sourceCloud?.metadataUrl
          ? globalContext?.sourceCloud?.metadataUrl
          : "",
        destChannelName: data?.destChannelName
          ? data?.destChannelName
          : data?.destChannelName,
        destTeamName: data?.destTeamName
          ? data?.destTeamName
          : data?.channelName,
        migrateAsSubChannel: false,
        combination: combinationCode,
      };
      list.push(obj);
    });
    let res = await initiateMessageMigrationForExportDump(list, false);
    if (res?.status === "OK") {
      dispatch({
        type: SET_SELECTED_CHANNELS_MAPPING,
        payload: {
          public: [],
          export: [],
          private: [],
          exportIds: [],
          publicIds: [],
          privateIds: [],
        },
      });
      notifyToast("success", "Migration Initiated Successfully...");
      setTimeout(() => {
        navigation(`/Reports/Collaborations#${combinationCode}`);
      }, 500);
    } else {
      notifyToast("error", "Failed to initate migration");
    }
  };

  const startMessageMigrationForDms = async () => {
    let dmsList = [...dmsMappingsList?.dms];
    let dmsObject = [];
    let combinationCode = getClouCombinationCode();

    let maps = {
      atPosition: 4,
      previousPosition: 3,
      nextPosition: 4,
      currentTab: "DIRECT_MESSAGES",
    };
    localStorage.setItem("lastTracker", JSON.stringify(maps));

    dmsList?.map((data) => {
      let emailPairs = data?.emailPairs;
      if (typeof data?.emailPairs === "string") {
        emailPairs = data?.emailPairs
          ?.split(",")
          ?.filter((data) => data !== "");
      }
      let obj = {
        fromCloudId: {
          id: getSelectedSourceCloudId(),
        },
        toCloudId: {
          id: getSelectedDestinationCloudId(),
        },
        fromRootId: data?.fromRootId,
        toRootId: "/",
        channelDate:
          getClouCombinationCode() === "W2C" ||
            getClouCombinationCode() === "W2V"
            ? "0"
            : data?.channelDate,
        channelType:
          getClouCombinationCode() === "C2T" ||
            getClouCombinationCode() === "C2C" ||
            getClouCombinationCode() === "W2C" ||
            getClouCombinationCode() === "W2V"
            ? data?.group
              ? "GROUP_CHAT"
              : "DIRECT_MESSAGE"
            : data?.group
              ? "mpim"
              : "im",
        emailPairs: emailPairs || null,
        workSpaceName: globalContext?.sourceCloud?.metadataUrl
          ? globalContext?.sourceCloud?.metadataUrl
          : "",
        channelName: data?.channelName,
        combination: combinationCode,
      };
      dmsObject.push(obj);
    });
    dispatch({
      type: SET_SELECTED_DMS_MAPPING,
      payload: {
        dms: [],
        dmIds: [],
      },
    });
    let res = await initiateMessageMigrationForDms(dmsObject, false);
    if (res?.status === "OK") {
      notifyToast("success", "Migration Initiated Successfully...");
      localStorage.setItem("migration", "DM");
      setTimeout(() => {
        navigation(`/Reports/Collaborations#${combinationCode}`);
      }, 500);
    } else {
      notifyToast("error", "Failed to initate migration");
    }
  };

  const startMessageMigrationForChannels = async () => {
    let channelsList = [
      ...channelsMappingsList?.public,
      ...channelsMappingsList?.private,
    ];
    let channelObject = [];
    let combinationCode = getClouCombinationCode();

    let maps = {
      atPosition: 3,
      previousPosition: 4,
      nextPosition: 5,
      currentTab: "PUBLIC_CHANNELS",
    };
    localStorage.setItem("lastTracker", JSON.stringify(maps));

    let selectedSourceCloudName = getSelectedSourceCloudName();
    let selectedDestinationName = getSelectedDestinationCloudName();

    channelsList?.map((data) => {
      let obj = {
        fromCloudId: {
          id: data?.cloudId
            ? data?.cloudId
            : data?.fromCloudId
              ? data?.fromCloudId
              : getSelectedSourceCloudId(),
        },
        toCloudId: {
          id: getSelectedDestinationCloudId(),
        },
        fromRootId: data?.fromRootId,
        toRootId: "/",
        channelDate: data?.channelDate,
        channelName: data?.channelName,
        channelType: data?.types ? data?.types : data?.channelType,
        specialCharacter: "-",
        workSpaceName: globalContext?.sourceCloud?.metadataUrl
          ? globalContext?.sourceCloud?.metadataUrl
          : "",
        destChannelName: data?.destChannelName ?? data?.channelName,
        destTeamName: data?.destTeamName ?? data?.channelName,
        migrateAsSubChannel: false,
        toSplit: data?.toSplit ? data?.toSplit : false,
        combination: combinationCode,
      };

      if (
        (selectedSourceCloudName === "SLACK" &&
          selectedDestinationName === "SLACK") ||
        (selectedSourceCloudName === "SLACK" &&
          selectedDestinationName === "GOOGLE_CHAT") ||
        (selectedSourceCloudName === "MICROSOFT_TEAMS" &&
          selectedDestinationName === "GOOGLE_CHAT")
      ) {
        obj.sourceDelegateCloudId = data?.cloudId
          ? data?.cloudId
          : data?.fromCloudId;
        if (data?.csv) {
          obj.destChannelName = data?.destTeamName
            ? data?.destTeamName
            : data?.channelName;
        }
      }
      if (combinationCode === "T2C") {
        obj.srcChannelId = data?.srcChannelId;
        delete obj.workSpaceName;
      }
      if (combinationCode === "C2C" || combinationCode === "C2T") {
        delete obj.workSpaceName;
        obj.channelDate = new Date(data?.channelDate).toISOString();
      }
      if (combinationCode === "W2V") {
        obj.directOrGroupMessage = true;
      }

      if (data?.existingTeam) {
        obj.existingTeam = true;
        obj.teamsId = data?.teamId;
        obj.channelId = data?.newChannelId ? data?.newChannelId : null;
      }
      channelObject.push(obj);
    });

    // let res = {};
    let res = await initiateMessageMigration(channelObject, false);
    if (res?.status === "OK") {
      dispatch({
        type: SET_SELECTED_CHANNELS_MAPPING,
        payload: {
          public: [],
          export: [],
          private: [],
          exportIds: [],
          publicIds: [],
          privateIds: [],
        },
      });
      notifyToast("success", "Migration Initiated Successfully...");
      setTimeout(() => {
        navigation(`/Reports/Collaborations#${combinationCode}`);
      }, 500);
    } else {
      notifyToast("error", "Failed to initate migration");
    }
  };

  return (
    <>
      <div className="CF_TEAM_BREAD_CRUMBS_DIV">
        {globalContext?.sourceCloud?.cloudName === "SLACK" &&
          globalContext?.destinationCloud?.cloudName === "MICROSOFT_TEAMS" ? (
          <>
            <ul className="CF_TEAM_BREAD_CRUMBS">
              <li
                className={`${teamMigration.atPosition === 1 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 1
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount">1</span>
                  <span className="breadCrumbName">Selection</span>
                  <span className="chevron">
                    {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
                  </span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition === 2 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 2
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount">2</span>
                  <span className="breadCrumbName">Pre-Migration</span>
                  <span className="chevron">
                    {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
                  </span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition === 3 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 3
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  {/* <span className="CF_TEAM_Chevron_Before">
                  <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
                </span> */}
                  <span className="breadCrumbCount"> 3</span>
                  <span className="breadCrumbName">Map & Migrate</span>
                  <span className="chevron">
                    {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
                  </span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition >= 4 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 4
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount">4</span>
                  <span className="breadCrumbName">Direct Messages</span>
                  <span className="chevron"></span>
                </div>
              </li>
            </ul>
            <div className="CT_TEAM_BreadCrumbs_Buttons">
              {teamMigration?.atPosition === 1 ? (
                <Link to="/Migrations" style={{ textDecoration: "none" }}>
                  <ButtonComponent
                    inputWidth="auto"
                    customstyles={{ padding: "0 10px", height: "35px" }}
                    buttonName="Previous"
                    buttonClickAction={() => changeState("BACK")}
                  >
                    <TfiAngleLeft />
                  </ButtonComponent>
                </Link>
              ) : (
                <ButtonComponent
                  inputWidth="auto"
                  customstyles={{ padding: "0 10px", height: "35px" }}
                  buttonName="Previous"
                  buttonClickAction={() => changeState("BACK")}
                >
                  <TfiAngleLeft />
                </ButtonComponent>
              )}
              <ButtonComponent
                isDisabled={
                  teamMigration?.atPosition >= 3
                    ? !(
                      teamMigration?.atPosition >= 3 &&
                      (channelsMappingsList?.publicIds?.length > 0 ||
                        channelsMappingsList?.privateIds?.length > 0 ||
                        channelsMappingsList?.export?.length > 0 ||
                        dmsMappingsList?.dms?.length > 0)
                    )
                    : false
                }
                inputWidth="auto"
                customstyles={{ padding: "0 10px", height: "35px" }}
                buttonName=""
                buttonClickAction={() => changeState("NEXT")}
              >
                <span>
                  {teamMigration?.atPosition >= 3 ? "Start Migration" : "Next"}
                </span>
                <TfiAngleRight />
              </ButtonComponent>
            </div>
          </>
        ) : (
          <>
            <ul className="CF_TEAM_BREAD_CRUMBS">
              <li
                className={`${teamMigration.atPosition === 1 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 1
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount">1</span>
                  <span className="breadCrumbName">Selection</span>
                  <span className="chevron"></span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition === 2 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 2
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount">2</span>
                  <span className="breadCrumbName">Pre-Migration</span>
                  <span className="chevron"></span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition === 3 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 3
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount"> 3</span>
                  <span className="breadCrumbName">User Mapping</span>
                  <span className="chevron"></span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition === 4 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 4
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount"> 4</span>
                  <span className="breadCrumbName">
                    {getClouCombinationCode() === "W2C" ||
                      getClouCombinationCode() === "W2V"
                      ? "Groups"
                      : "Channels"}
                  </span>
                  <span className="chevron"></span>
                </div>
              </li>
              <li
                className={`${teamMigration.atPosition >= 5 ? "breadCrumbeActive" : ""
                  }${teamMigration.atPosition > 6
                    ? "breadCrumbeActive-Completed"
                    : ""
                  }`}
              >
                <div className="breadCrumbs-Div">
                  <span className="breadCrumbCount">5</span>
                  <span className="breadCrumbName">Direct Messages</span>
                  <span className="chevron"></span>
                </div>
              </li>
            </ul>
            <div className="CT_TEAM_BreadCrumbs_Buttons">
              {teamMigration?.atPosition === 1 ? (
                <Link to="/Migrations" style={{ textDecoration: "none" }}>
                  <ButtonComponent
                    isDisabled={
                      teamMigration?.atPosition >= 1
                    }
                    inputWidth="auto"
                    customstyles={{ padding: "0 10px", height: "35px" }}
                    buttonName="Previous"
                    buttonClickAction={() => changeState("BACK")}
                  >
                    <TfiAngleLeft />
                  </ButtonComponent>
                </Link>
              ) : (
                <ButtonComponent
                  inputWidth="auto"
                  customstyles={{ padding: "0 10px", height: "35px" }}
                  buttonName="Previous"
                  buttonClickAction={() => changeState("BACK")}
                >
                  <TfiAngleLeft />
                </ButtonComponent>
              )}
              <ButtonComponent
                isDisabled={
                  teamMigration?.atPosition >= 4
                    ? !(
                      teamMigration?.atPosition >= 4 &&
                      (channelsMappingsList?.publicIds?.length > 0 ||
                        channelsMappingsList?.privateIds?.length > 0 ||
                        dmsMappingsList?.dms?.length > 0)
                    )
                    : false
                }
                inputWidth="auto"
                customstyles={{ padding: "0 10px", height: "35px" }}
                buttonName=""
                buttonClickAction={() => changeState("NEXT")}
              >
                <span>
                  {teamMigration?.atPosition >= 4 ? "Start Migration" : "Next"}
                </span>
                <TfiAngleRight />
              </ButtonComponent>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default MessageBreadCrumbs;
