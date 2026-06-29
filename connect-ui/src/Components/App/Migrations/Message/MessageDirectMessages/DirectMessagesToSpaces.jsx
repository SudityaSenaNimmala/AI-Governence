import React, { useContext, useEffect, useRef, useState } from "react";
import SearchComponent from "../../../../Resuables/SearchComponent/SearchComponent";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
} from "../../../../helpers/helpers";
import { BiFilterAlt } from "react-icons/bi";
import {
  downloadDmsCSV,
  downloadExportCSV,
  getDms,
  getExportDms,
  getExportQueues,
  getPaginationCounts,
  searchInChannels,
  uploadDmToSpacesChunk,
} from "../MessageActions/MessageActions";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import {
  SET_SELECTED_CHANNELS_MAPPING,
  SET_SELECTED_DMS_MAPPING,
} from "../../../../../GlobalContext/action.types";
import ActionButton from "../../../../Resuables/InputsComponents/ActionButton";
import { BsDownload, BsUpload } from "react-icons/bs";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast,
  splitZipFile,
} from "../../../../helpers/utils";
import DMSEmailFormat from "./DMSEmailFormat";
import { List } from "lucide-react";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import Popup from "../../../../Resuables/Popup/Popup";
import { FaCircleCheck } from "react-icons/fa6";

const DirectMessagesToSpaces = () => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { channelsMappingsList } = globalContext;
  const queueRef = useRef(null);
  const actionRef = useRef(null);
  const [dmsList, setDmsList] = useState([]);
  const [searchVal, setSearchVal] = useState("");
  const [queueList, setQueueList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCSVMapping, setIsCSVMapping] = useState(false);
  const [isQueueVisible, setIsQueueVisible] = useState(false);
  const [isPopUpVisible, setIsPopUpVisible] = useState(false);
  const [zipConfiguration, setZipConfiguration] = useState({});
  const [activeSession, setActiveSession] = useState("");
  const [zipApiInfo, setZipApiInfo] = useState({
    fileLogger: [],
    isUploading: false,
    uploadedPercentage: 0,
    retryChunkCount: 0,
    pauseCurrentIndex: 0,
    lastChunkUploadSize: 0,
    totalCurrentChunksUploaded: 0,
    isPasueForNetWorkIssue: false,
  });
  const [pagination, setPagination] = useState({
    pageSize: 50,
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
  const [paginationCount, setPaginationCount] = useState({});

  useEffect(() => {
    getQueues();
  }, []);

  const getQueues = async () => {
    try {
      setIsLoading(true);
      let res = await getExportQueues();
      if (res.status === "OK") {
        setQueueList(res?.res);
        setActiveSession(res?.res[0]);
      }
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (queueList?.length > 0) {
      getDms(1, 50);
    }
  }, [queueList]);

  const getDms = async (
    pageNo = 1,
    pageSize = 50,
    sessionId = queueList[0]?.sessionId
  ) => {
    if (!sessionId) {
      return false;
    }
    try {
      setIsLoading(true);
      let res = await getExportDms(pageNo, pageSize, sessionId);
      if (res?.status === "OK") {
        setDmsList(res?.res);
      }
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      getDms(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      getDms(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const handleFileUploadStream = async (fileStream) => {
    setIsLoading(true);
    if (fileStream?.size > 10000000000) {
      CFNewLoader();
      notifyToast("error", "File size should be less than 6GB");
      return false;
    }
    let zipInfo = await splitZipFile(fileStream, 5 * 1024 * 1024, "EXPORT");
    setZipConfiguration(zipInfo);
  };

  useEffect(() => {
    if (zipConfiguration?.chunkTime) {
      setZipApiInfo({
        ...zipApiInfo,
        uploadedPercentage: 0,
        isUploading: false,
      });
      uploadZipChunks(zipConfiguration?.chunks?.get(1), 1);
    }
  }, [zipConfiguration]);

  const uploadZipChunks = async (chunk, currentChunkIndex, channelType) => {
    try {
      setIsLoading(false);
      if (zipConfiguration?.zipFileSize > 1) {
        setIsPopUpVisible(true);
      }
      let res = await uploadDmToSpacesChunk(
        chunk,
        zipConfiguration?.chunkTime,
        currentChunkIndex,
        Array.from(zipConfiguration?.chunks?.keys())?.length,
        currentChunkIndex ===
          Array.from(zipConfiguration?.chunks.keys()).length,
        zipConfiguration?.fileName
      );
      if (res?.status === "OK") {
        if (
          currentChunkIndex !==
          Array.from(zipConfiguration?.chunks.keys()).length
        ) {
          let nextChunkIndex = currentChunkIndex + 1;
          uploadZipChunks(
            zipConfiguration?.chunks?.get(nextChunkIndex),
            nextChunkIndex
          );
          setZipApiInfo({
            ...zipApiInfo,
            isUploading: false,
          });
          getQueues();
          setIsPopUpVisible(false);
        }
        setZipApiInfo({
          ...zipApiInfo,
          uploadedPercentage: Math.ceil(
            (currentChunkIndex /
              Array.from(zipConfiguration?.chunks.keys()).length) *
              100
          ),
          isUploading: true,
        });
      }
    } catch (error) {
      setIsPopUpVisible(false);
    }
  };

  const handleClickOutside = (event) => {
    if (
      queueRef?.current &&
      !queueRef?.current?.contains(event.target) &&
      !actionRef?.current?.contains(event.target)
    ) {
      setIsQueueVisible(false);
    }
  };

  useEffect(() => {
    if (isQueueVisible) {
      document.addEventListener("click", handleClickOutside);
    } else {
      document.removeEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isQueueVisible]);

  useEffect(() => {
    if (activeSession?.processStatus === "PROCESSED") {
      let count = activeSession?.validDMCount + activeSession?.validGroupCount;
      setPagination({
        pageSize: 50,
        totalPages: Math.ceil(count / 50),
        currentPage: 1,
        totalDocuments: count,
      });
      getDms(1, 50, activeSession?.sessionId);
    }
  }, [activeSession]);

  const handleMappingSelection = (e) => {
    let { checked } = e.target;
    let cpyChannelsList = [...dmsList];
    let channelObject = e.target.getAttribute("data-object");
    let currentIndex = e.target.getAttribute("data-currentindex");
    channelObject = JSON.parse(decodeURIComponent(channelObject));
    let cpyMappingList = [...selectedMappingList?.export];
    let cpyIds = [...selectedMappingList?.exportIds];

    if (checked) {
      cpyMappingList?.push(channelObject);
      cpyIds.push(channelObject?.id);
      let temp = cpyChannelsList[currentIndex];
      cpyChannelsList.splice(currentIndex, 1);
      cpyChannelsList.unshift(temp);
    } else {
      cpyMappingList = cpyMappingList?.filter(
        (data) => data?.id !== channelObject?.id
      );
      cpyIds = cpyIds?.filter((data) => data !== channelObject?.id);
      let temp = cpyChannelsList[dmsList?.length - 1];
      cpyChannelsList[dmsList?.length - 1] = channelObject;
      cpyChannelsList[currentIndex] = temp;
    }

    setDmsList(cpyChannelsList);

    setSelectedMappingList({
      ...selectedMappingList,
      export: cpyMappingList,
      exportIds: cpyIds,
    });
  };

  useEffect(() => {
    dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: selectedMappingList,
    });
  }, [selectedMappingList]);

  const searchDebounce = useRef(null);
  const searchSourceUserList = async (e) => {
    let inputString = e?.searchInput;
    setSearchVal(inputString);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (inputString?.length > 0) {
        setIsLoading(true);
        let res = await searchInChannels("export", inputString, true, false);
        if (res?.status === "OK") {
          setIsLoading(false);
          if (res?.res !== "No Data Found") {
            setDmsList(res?.res);
          } else {
            notifyToast("warn", res?.res);
          }
        } else {
          setIsLoading(false);
        }
      } else {
        getDms();
      }
    }, 500);
  };

  const downloadReport = async (fileName, sessionId) => {
    try {
      setIsLoading(true);
      let res = await downloadExportCSV(sessionId);
      if (res?.statusCode === 200) {
        downloadGlobalCSV(res?.res, `${fileName}_${sessionId}_Report`);
      } else if (res?.statusCode === 202) {
        notifyToast(
          "success",
          "Report is in Progress,will be ready in few minutes"
        );
      } else {
        throw new Error("Failed To Download Report");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          inputPlaceHolder={`Search By Chat Name`}
          onInputSearch={(e) => searchSourceUserList(e)}
        />
        <span style={{ marginLeft: "auto" }}></span>

        <ActionButton
          customRef={actionRef}
          buttonType="button"
          buttonClickAction={() => setIsQueueVisible(true)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <List size={16} />
          </div>
        </ActionButton>
        <ActionButton
          buttonType="file"
          fileType=".zip"
          getFileStream={handleFileUploadStream}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <BsUpload style={{ fontSize: "14px" }} />
            <span style={{ fontSize: "12px" }}>
              {zipApiInfo?.isUploading && !isPopUpVisible
                ? `${zipApiInfo?.uploadedPercentage}%`
                : `ZIP`}
            </span>
          </div>
        </ActionButton>
      </div>
      <div className="cf_message_user_mapping">
        <table className="cf_message_table">
          <thead>
            <tr>
              <th style={{ width: "1%" }}>
                <span className="cf_mapping_email">S.No</span>
              </th>
              <th style={{ width: "1%" }}>
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
                      src={cloudImageMapper("SLACK")}
                      alt="SLACK"
                      style={{ width: "18px" }}
                    />
                  </div>
                  <div
                    className="CF_d-flex CF_flex-d-column"
                    style={{ width: "100%" }}
                  >
                    <span
                      style={{ gap: "10px" }}
                      className="CF_d-flex cf_mapping_email"
                      title="alex@filefuze.co"
                    >
                      Source Chat Name
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt className="fw-600" />
                      </span>
                    </span>
                  </div>
                </div>
              </th>
              <th style={{ width: "15%" }}>
                <span className="cf_mapping_email">
                  Destination Channel Name{" "}
                </span>
              </th>
              <th style={{ width: "30%" }}>
                <span className="cf_mapping_email">Emails</span>
              </th>
              <th style={{ width: "10%" }}>
                <span className="cf_mapping_email">Migration Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dmsList?.map((data, index) => {
              return (
                <tr key={data?.id}>
                  <td style={{ width: "1%" }}>
                    <span className="cf_mapping_email">{index + 1}</span>
                  </td>
                  <td style={{ width: "1%" }}>
                    <div className="CF_d-flex ai-center">
                      <input
                        type="checkbox"
                        data-object={encodeURIComponent(JSON.stringify(data))}
                        data-currentindex={index}
                        onChange={handleMappingSelection}
                        checked={selectedMappingList?.exportIds?.includes(
                          data?.id
                        )}
                      />
                    </div>
                  </td>
                  <td style={{ width: "20%" }}>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <div className="CF_d-flex ai-center"></div>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          title={data?.channelName?.replaceAll("mpdm-", "")}
                        >
                          {data?.channelName?.replaceAll("mpdm-", "")}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td style={{ width: "20%" }}>
                    <span
                      className="cf_mapping_email"
                      title={data?.channelName?.replaceAll("mpdm-", "")}
                    >
                      {data?.channelName?.replaceAll("mpdm-", "")}
                    </span>
                  </td>
                  <td>
                    <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                      <DMSEmailFormat
                        emailList={data?.emailIds}
                        dmName={data?.channelName?.replaceAll("mpdm-", "")}
                      />
                      {/* {data?.emailIds?.split(",")[0]
                            ? `${data?.emailIds?.split(",")[0]}${
                                data?.emailIds?.split(",")[1]
                                  ? `,${data?.emailIds?.split(",")[1]}`
                                  : ""
                              }`
                            : "---"} */}
                    </div>
                  </td>
                  <td>
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
        <span>
          Total DM's :{" "}
          {pagination?.totalDocuments ? pagination?.totalDocuments : 0}{" "}
        </span>
        <span>Group DM's : {activeSession?.validDMCount} </span>
        <span>One-One DM's : {activeSession?.validGroupCount} </span>
        <span className="cf_ml_auto"></span>
        <span style={{ opacity: "0.5" }}>
          Showing {pagination?.currentPage} of{" "}
          {pagination?.totalPages ? pagination?.totalPages : 1} Page
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
              return (
                <option value={data} key={`${data}_D2C`}>
                  {data}
                </option>
              );
            })}
          </select>
        </span>
      </div>
      <Popup
        options={{
          isOpen: isPopUpVisible,
          title: `File Upload In Progress`,
          popupWidth: "50%",
          popupHeight: "200px",
          popupTop: "150px",
        }}
        closeContent={`${zipApiInfo?.uploadedPercentage}%`}
        toggleOpen={true}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "0 10px", flexDirection: "column", gap: "30px" }}
        >
          <p>
            This may take sometime. We'll email you when it's done. Do not close
            the main window.
          </p>
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Done"
            buttonClickAction={() => setIsPopUpVisible(false)}
          />
        </div>
      </Popup>
      {isQueueVisible ? (
        <div className="CF_ZIP_CONTENTDIV" ref={queueRef}>
          {queueList?.map((data) => {
            return data?.zipFileName ? (
              <div
                className="CF_ZIP_CONTENTDIV_LIST"
                key={data?.sessionId}
                onClick={() => setActiveSession(data)}
              >
                {activeSession?.sessionId === data?.sessionId ? (
                  <FaCircleCheck />
                ) : (
                  <img
                    src={cloudImageMapper("ZIP")}
                    style={{ width: "14px" }}
                  />
                )}
                <p>{getMaxChar(data?.zipFileName, 30)}</p>
                <BsDownload
                  className="CF_Pointer"
                  style={{
                    strokeWidth: "0.5",
                    color: "#0062ff",
                    fontSize: "14px",
                    marginLeft: "auto",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadReport(data?.zipFileName, data?.sessionId);
                  }}
                />
              </div>
            ) : (
              ""
            );
          })}
        </div>
      ) : (
        ""
      )}
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default DirectMessagesToSpaces;
