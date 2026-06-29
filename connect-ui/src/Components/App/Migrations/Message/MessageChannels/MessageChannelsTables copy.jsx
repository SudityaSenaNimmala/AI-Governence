import React, { useContext, useEffect, useState } from "react";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
} from "../../../../helpers/helpers";
import { FaHashtag, FaLock } from "react-icons/fa6";
import {
  deleteExistingChannelMapping,
  getPaginationCounts,
  getSlackChannels,
  uploadChannelsCSVFile,
} from "../MessageActions/MessageActions";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { getMaxChar } from "../../../../helpers/utils";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import TextInputUpdate from "../../../../Resuables/InputsComponents/TextInputUpdate";
import Calendar from "../../../../Resuables/Calendar/Calendar";
import { SET_SELECTED_CHANNELS_MAPPING } from "../../../../../GlobalContext/action.types";
import ActionButton from "../../../../Resuables/InputsComponents/ActionButton";
import { BsDownload, BsUpload } from "react-icons/bs";
import { IoTrashOutline } from "react-icons/io5";

const MessageChannelsTables = (props) => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { channelsMappingsList } = globalContext;
  const [isLoading, setIsLoading] = useState(true);
  const [channelsList, setChannelsList] = useState([]);
  const [selectedEdit, setSelectedEdit] = useState("");
  const [isCSVMapping, setIsCSVMapping] = useState(false);
  const [selectedMappingList, setSelectedMappingList] = useState(
    channelsMappingsList ?? {
      public: [],
      private: [],
      publicIds: [],
      privateIds: [],
    }
  );
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [paginationCount, setPaginationCount] = useState({});
  useEffect(() => {
    if (props?.currentTab) {
      // setPaginationCount({});
      // setChannelsList([]);
      fetchChannels();
      // fetchPaginationCount();
    }
  }, [props?.currentTab]);

  const fetchChannels = async () => {
    setIsLoading(true);
    let channels = await getSlackChannels(
      pagination?.currentPage,
      pagination?.pageSize,
      props?.currentTab === "PUBLIC_CHANNELS" ? "public" : "private"
    );
    if (channels?.status === "OK") {
      setIsCSVMapping(channels?.res[0]?.csv);
      setChannelsList([]);
      setIsLoading(false);
      setChannelsList(channels?.res);
    } else {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let count = paginationCount?.privateChannelCount;
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      count = paginationCount?.publicChannelCount;
    }
    setPagination({
      currentPage: 1,
      pageSize: 50,
      totalPages: Math.ceil(count / 50),
      totalDocuments: count,
    });
  }, [paginationCount]);

  const fetchPaginationCount = async () => {
    let paginationCount = await getPaginationCounts(isCSVMapping);
    if (paginationCount.status === "OK") {
      setIsLoading(false);
      setPaginationCount(paginationCount.res);
    } else {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.privateChannelCount;
    if (props?.currentTab === "PUBLIC_CHANNELS") {
      count = paginationCount?.publicChannelCount;
    }
    if (name === "pageSize") {
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  useEffect(() => {
    fetchChannels();
  }, [pagination]);

  useEffect(() => {
    fetchPaginationCount();
  }, [isCSVMapping]);

  const saveUpdatedName = (
    channelId,
    updatedName,
    currentIndex,
    updatedFor
  ) => {
    let copyChannelsList = [...channelsList];
    if (updatedFor === "channelName") {
      copyChannelsList[currentIndex].destChannelName = updatedName;
    } else {
      copyChannelsList[currentIndex].destTeamName = updatedName;
    }
    setChannelsList(copyChannelsList);
    setSelectedEdit("");
  };

  const handleMappingSelection = (e) => {
    let { checked } = e.target;
    let channelObject = e.target.getAttribute("data-object");
    channelObject = JSON.parse(decodeURIComponent(channelObject));
    let cpyMappingList = [...selectedMappingList?.private];
    let cpyIds = [...selectedMappingList?.privateIds];
    if (props?.currentTab === "PUBLIC_CHANNELS") {
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
    if (props?.currentTab === "PUBLIC_CHANNELS") {
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

  useEffect(() => {
    dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: selectedMappingList,
    });
  }, [selectedMappingList]);

  const handleFileUploadStream = async (fileStream) => {
    let deleteMappingRes = await deleteExistingChannelMapping(
      props?.currentTab ? "public" : "private"
    );
    if (deleteMappingRes?.status === "OK") {
      let uploadCSVFileRes = await uploadChannelsCSVFile(fileStream);
      if (uploadCSVFileRes?.status === "OK") {
        resetChannelMapping();
        setIsCSVMapping(true);
        setPagination({
          pageSize: 50,
          totalPages: 1,
          currentPage: 1,
          totalDocuments: 0,
        });
      }
    }
  };

  const deleteMapping = async () => {
    setIsLoading(true);
    let res = await deleteExistingChannelMapping(
      props?.currentTab ? "public" : "private"
    );
    if (res?.status === "OK") {
      resetChannelMapping();
      setIsLoading(false);
      setIsCSVMapping(false);
      setPagination({
        pageSize: 50,
        totalPages: 1,
        currentPage: 1,
        totalDocuments: 0,
      });
    } else {
      setIsLoading(false);
    }
  };

  const resetChannelMapping = () => {
    let obj = {
      public: [],
      private: [],
      publicIds: [],
      privateIds: [],
    };
    setSelectedMappingList(obj);
    return dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: obj,
    });
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          inputPlaceHolder={`Search By Slack Channel Name`}
          onInputSearch={(e) => console.log(e?.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        {isCSVMapping ? (
          <ActionButton
            buttonType="button"
            buttonClickAction={() => deleteMapping()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <IoTrashOutline style={{ fontSize: "14px" }} />
              <span style={{ fontSize: "12px" }}>Delete</span>
            </div>
          </ActionButton>
        ) : (
          ""
        )}
        <ActionButton buttonType="file" getFileStream={handleFileUploadStream}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BsDownload style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>CSV</span>
          </div>
        </ActionButton>
        <ActionButton buttonType="file" getFileStream={handleFileUploadStream}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BsUpload style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>CSV</span>
          </div>
        </ActionButton>
      </div>
      <div className="cf_message_user_mapping">
        <table className="cf_message_table">
          <thead style={{ zIndex: "9" }}>
            <tr>
              <th style={{ width: "1%", padding: "10px" }}>
                <div className="CF_d-flex ai-center">
                  <input type="checkbox" />
                </div>
              </th>
              <th style={{ width: "15%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
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
                    <span className="cf_mapping_email" title="alex@filefuze.co">
                      Channel Name
                    </span>
                  </div>
                </div>
              </th>
              <th style={{ width: "15%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <div
                    className="cf_mapping_table_cloudIcon"
                    style={{ width: "27px", height: "27px" }}
                  >
                    <img
                      src={cloudImageMapper(
                        globalContext?.destinationCloud?.cloudName
                      )}
                      alt={globalContext?.destinationCloud?.cloudName}
                      style={{ width: "18px" }}
                    />
                  </div>
                  <div
                    className="CF_d-flex CF_flex-d-column"
                    style={{ width: "100%" }}
                  >
                    <span className="cf_mapping_email" title="alex@filefuze.co">
                      Destination Team Name
                    </span>
                  </div>
                </div>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">
                  Destination Channel Name
                </span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Channel Date</span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Manager Availability</span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Migration Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {channelsList?.map((data, index) => {
              return (
                <tr key={data?.id}>
                  <td style={{ width: "1%", padding: "10px" }}>
                    <div className="CF_d-flex ai-center">
                      <input
                        type="checkbox"
                        data-object={encodeURIComponent(JSON.stringify(data))}
                        onChange={handleMappingSelection}
                        checked={
                          props?.currentTab === "PUBLIC_CHANNELS"
                            ? selectedMappingList?.publicIds?.includes(data?.id)
                            : selectedMappingList?.privateIds?.includes(
                                data?.id
                              )
                        }
                      />
                    </div>
                  </td>
                  <td style={{ width: "15%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <div className="CF_d-flex ai-center">
                        {props?.currentTab === "PUBLIC_CHANNELS" ? (
                          <FaHashtag style={{ fontSize: "12px" }} />
                        ) : (
                          <FaLock style={{ fontSize: "12px" }} />
                        )}
                      </div>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          title={data?.channelName}
                        >
                          {getMaxChar(data?.channelName, 30)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td style={{ width: "15%", position: "relative" }}>
                    {selectedEdit === `TEAMS_${data?.id}` ? (
                      <TextInputUpdate
                        defaultVal={data?.destTeamName ?? data?.channelName}
                        closeAction={() => setSelectedEdit("")}
                        saveAction={(value) =>
                          saveUpdatedName(data?.id, value, index, "teamName")
                        }
                      />
                    ) : (
                      <div
                        className="CF_d-flex ai-center CF_Pointer"
                        style={{ gap: "5px" }}
                        onClick={() => setSelectedEdit(`TEAMS_${data?.id}`)}
                      >
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email cf_tableEdit_Option"
                            title={data?.destTeamName ?? data?.channelName}
                          >
                            {getMaxChar(
                              data?.destTeamName ?? data?.channelName,
                              30
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td style={{ width: "10%", position: "relative" }}>
                    {selectedEdit === `CHANNEL_${data?.id}` ? (
                      <TextInputUpdate
                        defaultVal={data?.destChannelName ?? data?.channelName}
                        closeAction={() => setSelectedEdit("")}
                        saveAction={(value) =>
                          saveUpdatedName(data?.id, value, index, "channelName")
                        }
                      />
                    ) : (
                      <div
                        className="CF_d-flex ai-center CF_Pointer"
                        style={{ gap: "5px" }}
                        onClick={() => setSelectedEdit(`CHANNEL_${data?.id}`)}
                      >
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email cf_tableEdit_Option"
                            title={data?.destChannelName ?? data?.channelName}
                          >
                            {getMaxChar(
                              data?.destChannelName ?? data?.channelName,
                              40
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td style={{ width: "10%" }}>
                    <span className="cf_mapping_email cf_tableEdit_Option">
                      {formatDateNew(data?.channelDate)}
                    </span>
                  </td>
                  <td style={{ width: "10%" }}>
                    <span className="cf_mapping_email">
                      {data?.managerAvailable ? "Available" : "Not Available"}
                    </span>
                  </td>
                  <td style={{ width: "10%" }}>
                    <span className="cf_mapping_email">
                      {getCloudName(data?.processStatus) === "In Queue"
                        ? "Not Initiated"
                        : getCloudName(data?.processStatus)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cf_message_footerVal">
        <span>Total Channels : {pagination?.totalDocuments} </span>
        <span className="cf_ml_auto"></span>
        <span style={{ opacity: "0.5" }}>
          Showing {pagination?.currentPage} of {pagination?.totalPages ?? 1}{" "}
          Page
        </span>
        <span>
          Showing :{" "}
          <select
            className="cf_message_pagination_select"
            name="pageSize"
            value={pagination?.pageSize}
            onChange={handlePagination}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="150">150</option>
            <option value="200">200</option>
          </select>
          &nbsp;Rows
        </span>
        <span>
          Go to:{" "}
          <select
            className="cf_message_pagination_select"
            name="currentPage"
            value={pagination?.currentPage}
            onChange={handlePagination}
          >
            {getRandomArray(pagination?.totalPages)?.map((data) => {
              return <option value={data}>{data}</option>;
            })}
          </select>
        </span>
      </div>
      {/* <Calendar /> */}
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageChannelsTables;
