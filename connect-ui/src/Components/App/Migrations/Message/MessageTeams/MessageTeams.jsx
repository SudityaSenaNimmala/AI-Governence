import React, { useContext, useEffect, useState } from "react";
import { CircleChevronDown, CircleChevronUp } from "lucide-react";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, formatDateNew } from "../../../../helpers/helpers";
import { getTeamChannels } from "../MessageActions/MessageActions";
import {
  getClouCombinationCode,
  getMaxChar,
  getSelectedDestinationCloudName,
  notifyToast,
} from "../../../../helpers/utils";
import TextInputUpdate from "../../../../Resuables/InputsComponents/TextInputUpdate";
import CustomCalendar from "../../../../Resuables/CustomCalendar/CustomCalendar";
import { SET_SELECTED_CHANNELS_MAPPING } from "../../../../../GlobalContext/action.types";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";

const MessageTeams = (props) => {
  let { teamsList, channelType } = props;
  let [selectedTeam, setSelectedTeam] = useState({});
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { channelsMappingsList } = globalContext;
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [channelsList, setChannelsList] = useState([]);
  const [selectedEdit, setSelectedEdit] = useState("");
  const [isSelectedAll, setIsSelectedAll] = useState(false);
  const [changeChannelDate, setChangeChannelDate] = useState({
    channelDate: "",
    currentIndex: 0,
    channelId: "",
    positionX: "",
    positionY: "",
  });
  const [pagination, setPagination] = useState({
    pageSize: 200,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });

  const [selectedMappingList, setSelectedMappingList] = useState(
    channelsMappingsList ?? {
      public: [],
      export: [],
      private: [],
      exportIds: [],
      publicIds: [],
      privateIds: [],
    }
  );

  useEffect(() => {
    if (selectedTeam?.teamId || selectedTeam?.fromRootId) {
      setChannelsList([]);
      fetchTeamChannels(
        1,
        200,
        selectedTeam?.teamId || selectedTeam?.fromRootId
      );
    }
  }, [selectedTeam]);

  const fetchTeamChannels = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    teamId = selectedTeam?.teamId || selectedTeam?.fromRootId
  ) => {
    setIsSelectedAll(false);
    setIsPageLoading(true);
    let res = await getTeamChannels(pageNo, pageSize, teamId);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res !== "No Provision User Found") {
        setChannelsList(res?.res || []);
        checkForCheckedInputs();
      } else {
        notifyToast("warn", "No Channels Found");
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const handleChangeDate = (data) => {
    saveUpdatedName(
      data?.channelId,
      data?.newDate,
      data?.currentIndex,
      "channelDate"
    );
    setChangeChannelDate({
      channelDate: "",
      currentIndex: 0,
      channelId: "",
      positionX: "",
      positionY: "",
    });
  };

  const saveUpdatedName = (
    channelId,
    updatedName,
    currentIndex,
    updatedFor
  ) => {
    let copyChannelsList = [...channelsList];
    if (updatedFor === "channelName") {
      copyChannelsList[currentIndex].destChannelName = updatedName;
      if (getSelectedDestinationCloudName() === "GOOGLE_CHAT") {
        notifyToast("success", "Destination Space Name Updated Successfully");
      } else {
        notifyToast("success", "Destination Channel Name Updated Successfully");
      }
    } else if (updatedFor === "teamName") {
      copyChannelsList[currentIndex].destTeamName = updatedName;
    } else if (updatedFor === "toSplit") {
      copyChannelsList[currentIndex].toSplit = updatedName;
    } else {
      copyChannelsList[currentIndex].originalDate =
        copyChannelsList?.channelDate || copyChannelsList?.createdTime;
      copyChannelsList[currentIndex].channelDate = updatedName;
      copyChannelsList[currentIndex].createdTime = updatedName;
    }
    if (
      props?.currentTab === "PRIVATE_CHANNELS" &&
      selectedMappingList?.privateIds?.includes(channelId)
    ) {
      let cpyMappingList = [...selectedMappingList?.private];
      let index = cpyMappingList.findIndex((data) => data?.id === channelId);
      cpyMappingList[index] = copyChannelsList[currentIndex];
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
      });
    }
    if (
      props?.currentTab === "PUBLIC_CHANNELS" &&
      selectedMappingList?.publicIds?.includes(channelId)
    ) {
      let cpyMappingList = [...selectedMappingList?.public];
      let index = cpyMappingList.findIndex((data) => data?.id === channelId);
      cpyMappingList[index] = copyChannelsList[currentIndex];
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
      });
    }

    setChannelsList(copyChannelsList);
    setSelectedEdit("");
  };

  const handleMappingSelection = (e) => {
    let { checked } = e.target;
    let channelObject = e.target.getAttribute("data-object");
    let currentIndex = e.target.getAttribute("data-currentindex");
    channelObject = JSON.parse(decodeURIComponent(channelObject));
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (channelType === "public") {
      cpyMappingList = [...selectedMappingList?.public];
      cpyIds = [...selectedMappingList?.publicIds];
    }
    if (checked) {
      cpyMappingList?.push(channelObject);
      cpyIds.push(channelObject?.id);
    } else {
      cpyMappingList = cpyMappingList?.filter(
        (data) => data?.id !== channelObject?.id
      );
      cpyIds = cpyIds?.filter((data) => data !== channelObject?.id);
    }

    if (channelType === "public") {
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
        publicIds: cpyIds,
      });
    } else {
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
        privateIds: cpyIds,
      });
    }
    checkForCheckedInputs();
  };

  useEffect(() => {
    dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: selectedMappingList,
    });
  }, [selectedMappingList]);

  const checkForCheckedInputs = () => {
    let checkedInputs = document.querySelectorAll("#channelSelect:checked");
    let allInputs = document.querySelectorAll("#channelSelect");
    setIsSelectedAll(
      checkedInputs.length === allInputs.length && allInputs.length > 0
    );
  };

  useEffect(() => {
    checkForCheckedInputs();
  });

  const handleMultiSelect = (e) => {
    let channelsList = document.querySelectorAll("#channelSelect");
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (channelType === "public") {
      cpyMappingList = [...selectedMappingList?.public];
      cpyIds = [...selectedMappingList?.publicIds];
    }
    channelsList.forEach((input) => {
      if (e.target.checked) {
        if (!input.checked) {
          let channelObject = input.getAttribute("data-object");
          channelObject = JSON.parse(decodeURIComponent(channelObject));
          cpyMappingList.push(channelObject);
          cpyIds.push(channelObject?.id);
        }
      } else {
        cpyMappingList = [];
        cpyIds = [];
      }
      input.checked = e.target.checked;
    });

    if (e.target.checked) {
      setIsSelectedAll(true);
    } else {
      setIsSelectedAll(false);
    }

    if (channelType === "public") {
      setSelectedMappingList({
        ...selectedMappingList,
        public: cpyMappingList,
        publicIds: cpyIds,
      });
    } else {
      setSelectedMappingList({
        ...selectedMappingList,
        private: cpyMappingList,
        privateIds: cpyIds,
      });
    }
  };

  return (
    <>
      <table className="cf_message_table">
        <thead style={{ zIndex: "9" }}>
          <tr>
            <th style={{ width: "20px" }}></th>
            <th>
              <span className="cf_mapping_email">Source Channel</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {teamsList?.map((data) => {
            return (
              <>
                <tr key={data?.teamId || data?.fromRootId}>
                  <td>
                    {data?.teamId === selectedTeam?.teamId ||
                    data?.fromRootId === selectedTeam?.fromRootId ? (
                      <CircleChevronUp
                        size={16}
                        color="#0062FF"
                        strokeWidth={1.5}
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setChannelsList([]);
                          setSelectedTeam({});
                        }}
                      />
                    ) : (
                      <CircleChevronDown
                        size={16}
                        color="#0062FF"
                        strokeWidth={1.5}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedTeam(data)}
                      />
                    )}
                  </td>
                  <td>
                    <span className="cf_mapping_email">
                      {data?.teamName ||
                        data?.destTeamName ||
                        data?.channelName}
                    </span>
                  </td>
                </tr>
                {data?.teamId === selectedTeam?.teamId ||
                data?.fromRootId === selectedTeam?.fromRootId ? (
                  <tr key={`channels_${data?.teamId || data?.fromRootId}`}>
                    <td colSpan={2}>
                      <table
                        className="cf_message_table"
                        style={{ width: "80%", marginLeft: "40px" }}
                      >
                        <thead>
                          <tr>
                            <th style={{ width: "15px" }}>
                              <input
                                type="checkbox"
                                checked={isSelectedAll}
                                onChange={handleMultiSelect}
                              />
                            </th>
                            <th>
                              <div
                                className="CF_d-flex ai-center"
                                style={{ gap: "5px" }}
                              >
                                <div
                                  className="cf_mapping_table_cloudIcon"
                                  style={{ width: "27px", height: "27px" }}
                                >
                                  <img
                                    src={cloudImageMapper(
                                      globalContext?.sourceCloud?.cloudName
                                    )}
                                    alt={globalContext?.sourceCloud?.cloudName}
                                    style={{ width: "18px" }}
                                  />
                                </div>
                                <div
                                  className="CF_d-flex CF_flex-d-column"
                                  style={{ width: "100%" }}
                                >
                                  <span className="cf_mapping_email">
                                    Channel Name
                                  </span>
                                </div>
                              </div>
                            </th>
                            {getClouCombinationCode() === "T2T" ? (
                              <th>
                                <div
                                  className="CF_d-flex ai-center"
                                  style={{ gap: "5px" }}
                                >
                                  <div
                                    className="cf_mapping_table_cloudIcon"
                                    style={{ width: "27px", height: "27px" }}
                                  >
                                    <img
                                      src={cloudImageMapper(
                                        globalContext?.destinationCloud
                                          ?.cloudName
                                      )}
                                      alt={
                                        globalContext?.destinationCloud
                                          ?.cloudName
                                      }
                                      style={{ width: "18px" }}
                                    />
                                  </div>
                                  <div
                                    className="CF_d-flex CF_flex-d-column"
                                    style={{ width: "100%" }}
                                  >
                                    <span className="cf_mapping_email">
                                      Destination Team Name
                                    </span>
                                  </div>
                                </div>
                              </th>
                            ) : (
                              ""
                            )}
                            <th>
                              <div
                                className="CF_d-flex ai-center"
                                style={{ gap: "5px" }}
                              >
                                <div
                                  className="cf_mapping_table_cloudIcon"
                                  style={{ width: "27px", height: "27px" }}
                                >
                                  <img
                                    src={cloudImageMapper(
                                      globalContext?.destinationCloud?.cloudName
                                    )}
                                    alt={
                                      globalContext?.destinationCloud?.cloudName
                                    }
                                    style={{ width: "18px" }}
                                  />
                                </div>
                                <div
                                  className="CF_d-flex CF_flex-d-column"
                                  style={{ width: "100%" }}
                                >
                                  <span className="cf_mapping_email">
                                    {getClouCombinationCode() === "T2T"
                                      ? "Destination Channel Name"
                                      : "Destination Space Name"}
                                  </span>
                                </div>
                              </div>
                            </th>
                            <th>
                              <span className="cf_mapping_email">
                                Channel Date
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {channelsList?.map((channel, index) => {
                            return (
                              <tr key={channel?.channelId}>
                                <td>
                                  <input
                                    type="checkbox"
                                    id="channelSelect"
                                    data-id={channel?.id}
                                    data-object={encodeURIComponent(
                                      JSON.stringify({
                                        ...channel,
                                        fromRootId:
                                          selectedTeam?.fromRootId ||
                                          selectedTeam?.teamId,
                                        srcChannelId:
                                          channel?.channelId ||
                                          channel?.fromRootId,
                                        channelDate: channel?.createdTime,
                                      })
                                    )}
                                    data-currentindex={index}
                                    onChange={handleMappingSelection}
                                    checked={
                                      channelType === "public"
                                        ? selectedMappingList?.publicIds?.includes(
                                            channel?.id
                                          )
                                        : selectedMappingList?.privateIds?.includes(
                                            channel?.id
                                          )
                                    }
                                  />
                                </td>
                                <td>
                                  <span className="cf_mapping_email">
                                    {getMaxChar(channel?.channelName, 40)}
                                  </span>
                                </td>
                                {getClouCombinationCode() !== "T2C" ? (
                                  <td
                                    style={{
                                      width: "310px",
                                      position: "relative",
                                      height: "52.5px",
                                    }}
                                  >
                                    {selectedEdit === `TEAM_${channel?.id}` ? (
                                      <TextInputUpdate
                                        defaultVal={
                                          channel?.destTeamName ||
                                          channel?.channelName
                                        }
                                        closeAction={() => setSelectedEdit("")}
                                        saveAction={(value) => {
                                          saveUpdatedName(
                                            channel?.id,
                                            value,
                                            index,
                                            "teamName"
                                          );
                                        }}
                                      />
                                    ) : (
                                      <div
                                        className="CF_d-flex ai-center CF_Pointer"
                                        style={{ gap: "5px" }}
                                        onClick={() =>
                                          setSelectedEdit(`TEAM_${channel?.id}`)
                                        }
                                      >
                                        <div
                                          className="CF_d-flex CF_flex-d-column"
                                          style={{ width: "100%" }}
                                        >
                                          <span
                                            className="cf_mapping_email cf_tableEdit_Option"
                                            title={
                                              data?.destTeamName ??
                                              data?.channelName
                                            }
                                          >
                                            {getMaxChar(
                                              channel?.destTeamName ||
                                                channel?.channelName,
                                              40
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                ) : (
                                  ""
                                )}
                                <td
                                  style={{
                                    position: "relative",
                                    height: "52.5px",
                                  }}
                                >
                                  {selectedEdit === `CHANNEL_${channel?.id}` ? (
                                    <TextInputUpdate
                                      defaultVal={
                                        channel?.destChannelName ||
                                        channel?.channelName
                                      }
                                      closeAction={() => setSelectedEdit("")}
                                      saveAction={(value) => {
                                        saveUpdatedName(
                                          channel?.id,
                                          value,
                                          index,
                                          "channelName"
                                        );
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className="CF_d-flex ai-center CF_Pointer"
                                      style={{ gap: "5px" }}
                                      onClick={() =>
                                        setSelectedEdit(
                                          `CHANNEL_${channel?.id}`
                                        )
                                      }
                                    >
                                      <div
                                        className="CF_d-flex CF_flex-d-column"
                                        style={{ width: "100%" }}
                                      >
                                        <span
                                          className="cf_mapping_email cf_tableEdit_Option"
                                          title={
                                            data?.destChannelName ??
                                            data?.channelName
                                          }
                                        >
                                          {getMaxChar(
                                            channel?.destChannelName ||
                                              channel?.channelName,
                                            40
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td style={{ width: "10%" }}>
                                  <span
                                    className="cf_mapping_email cf_tableEdit_Option"
                                    onClick={(e) =>
                                      setChangeChannelDate({
                                        channelDate: formatDateNew(
                                          channel?.createdTime
                                        ),
                                        currentIndex: index,
                                        channelId: channel?.id,
                                        positionX: e.pageX,
                                        positionY: e.pageY,
                                      })
                                    }
                                  >
                                    {formatDateNew(channel?.createdTime)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : (
                  ""
                )}
              </>
            );
          })}
        </tbody>
      </table>
      {changeChannelDate?.channelDate ? (
        <CustomCalendar
          customDate={changeChannelDate?.channelDate}
          closeDate={setChangeChannelDate}
          customData={changeChannelDate}
          applyChangeDate={handleChangeDate}
        />
      ) : (
        ""
      )}
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageTeams;
