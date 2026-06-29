import React, { useEffect, useRef, useState } from "react";
import {
  cloudImageMapper,
  formatDateNew,
  getCloudName,
  getRandomArray,
  messageMigrationErrorMessages,
} from "../../../helpers/helpers";
import {
  changeMessageWorkSpaceStatus,
  checkForDeltaMessages,
  checkForMessageCheckBoxs,
  closeMessageTeams,
  downloadDMReport,
  getErrorMessages,
  getJobLevelCustomReport,
  getJobReportsPaginationCount,
  getJobReportsPaginationCountDM,
  getMessageDMReports,
  initiateMessageMigrationForDms,
  retryErrorMessages,
} from "../../Migrations/Message/MessageActions/MessageActions";
import { BsDownload } from "react-icons/bs";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast,
} from "../../../helpers/utils";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import {
  ChevronDown,
  ChevronRight,
  CirclePause,
  CircleX,
  Download,
  Info,
  Play,
} from "lucide-react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import { BiFilterAlt } from "react-icons/bi";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import Popup from "../../../Resuables/Popup/Popup";

const MessageReportsDMs = (props) => {
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [searchVal, setSearchVal] = useState("");
  const [defaultReport, setDefaultReport] = useState("ERROR");
  const [dmsList, setDmsList] = useState([]);
  const [selectedErrorMessages, setSelectedErrorMessages] = useState([]);
  const [selectedErrorWorkSpaceId, setSelectedErrorWorkSpaceId] = useState("");
  const [isErrorPopupVisible, setIsErrorPopupVisible] = useState(false);
  const [slectedErrorMessage, setSlectedErrorMessage] = useState("");
  const [errorList, setErrorList] = useState([]);
  const [selectedDmsList, setSelectedDmsList] = useState([]);
  const [currentCombination, setCurrentCombination] = useState("");
  const [disabledList, setDisabledList] = useState({
    pause: true,
    cancel: true,
    retry: true,
    resume: true,
    download: true,
    initateDelta: true,
  });
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [filters, setFilters] = useState({
    dmJobType: { key: "All", value: "all" },
    processStatus: { key: "All", value: "all" },
    deltaMessages: { key: "All", value: "ALL" },
  });
  useEffect(() => {
    if(props?.combination){
    checkForCheckBoxs();
    getPagination();
    fetchDMReports();
    localStorage.removeItem("migration");
  }}, [props?.combination]);

  const refreshWorkSpaces = () => {
    checkForCheckBoxs();
    getPagination();
    fetchDMReports();
  };
  useEffect(() => {
    setCurrentCombination(window.location.hash.replace("#", ""));
  }, [window.location.hash]);

  useEffect(() => {
    if (props?.updateReports?.split("|")[0] === "FILES") {
      refreshWorkSpaces();
    }
  }, [props?.updateReports]);

  const fetchDMReports = async (
    pageNo = 1,
    pageSize = 50,
    dmJobType = filters?.dmJobType?.value,
    processStatus = filters?.processStatus?.value,
    deltaMessages = filters?.deltaMessages?.value,
    dmName = searchVal
  ) => {
    setIsPageLoading(true);
    setDisabledList({ ...disabledList, retry: true });
    setSelectedErrorWorkSpaceId("");
    let res = await getMessageDMReports(
      pageNo,
      pageSize,
      dmJobType,
      processStatus,
      deltaMessages === "Delta Message" ? "MESSAGE" : deltaMessages,
      dmName,
      currentCombination
    );
    if (res?.status === "OK" && res?.res) {
      setIsPageLoading(false);
      setDmsList(res?.res);
    } else {
      setIsPageLoading(false);
    }
  };

  const checkForCheckBoxs = async () => {
    setIsPageLoading(true);
    try {
      let res = await checkForMessageCheckBoxs(true, currentCombination);
    } catch (error) {}
  };

  const getPagination = async (
    deltaMessages = filters?.deltaMessages?.value,
    dmJobType = filters?.dmJobType?.value,
    processStatus = filters?.processStatus?.value,
    channelName = ""
  ) => {
    let res = await getJobReportsPaginationCountDM(
      deltaMessages,
      dmJobType === "all" ? "All" : dmJobType,
      processStatus === "all" ? "All" : processStatus,
      channelName,
      currentCombination
    );
    if (res?.status === "OK") {
      let count = res?.res === 0 ? 1 : res?.res;
      setPagination({
        ...pagination,
        totalDocuments: res?.res,
        totalPages: Math.ceil(count / pagination?.pageSize),
      });
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchDMReports(1, +value);
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchDMReports(+value, pagination?.pageSize);
      setPagination({
        ...pagination,
        currentPage: +value,
      });
    }
  };

  const searchDebounce = useRef(null);
  const searchJobs = async (e) => {
    let inputString = e.trim();
    setSearchVal(inputString);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }
    searchDebounce.current = setTimeout(async () => {
      if (inputString?.length > 0) {
        setIsPageLoading(true);
        fetchDMReports(1, 50, "all", "all", "All", inputString);
        getPagination("All", "All", "All", inputString);
      } else {
        fetchDMReports(1, 50, "all", "all", "All", "");
        getPagination("All", "All", "All", "");
      }
    }, 500);
  };

  const initateDelta = async () => {
    setIsPageLoading(true);
    setDisabledList({ ...disabledList, initateDelta: true });
    try {
      let checkBox = document.querySelectorAll("#selectWorkSpaceDM:checked");
      let deltaBody = [];
      checkBox.forEach((input) => {
        let status = input.getAttribute("data-status");
        if (
          status === "PROCESSED" ||
          status === "PROCESSED_WITH_SOME_CONFLICTS"
        ) {
          let deltaObj = JSON.parse(
            decodeURIComponent(input.getAttribute("data-deltaobj"))
          );
          deltaBody.push(deltaObj);
        }
        input.checked = false;
      });
      let res = await initiateMessageMigrationForDms(deltaBody, true);
      if (res?.status === "OK") {
        getPagination();
        fetchDMReports(1, 50, "all", "all", "All", "");
        getPagination("All", "All", "All", "");
        setSelectedErrorWorkSpaceId("");
        setDisabledList({
          ...disabledList,
          initateDelta: true,
          closeTeams: true,
          download: true,
        });
        notifyToast("success", "Delta Initiated Successfully");
      } else {
        throw new Error(res?.res?.error?.error_summary);
      }
    } catch (error) {
    } finally {
      setIsPageLoading(false);
    }
  };

  const checkDeltaMessages = async () => {
    try {
      setIsPageLoading(true);
      let res = await checkForDeltaMessages(true, "S2T");
      if (res?.status !== "OK") {
        throw new Error("Failed Checking Delta Messages");
      } else {
        notifyToast("success", "Started checking for delta messages");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const handleWorkSpaceSelection = () => {
    let checkBox = document.querySelectorAll("#selectWorkSpaceDM:checked");
    let statusMapper = {};
    checkBox.forEach((input) => {
      statusMapper[input.getAttribute("data-status")] = statusMapper[
        input.getAttribute("data-status")
      ]
        ? statusMapper[input.getAttribute("data-status")] + 1
        : 1;
      console.log(input.getAttribute("data-status"));
    });
    let cpyOptions = { ...disabledList };

    if (statusMapper["PAUSE"] > 0) {
      cpyOptions.resume = false;
    } else {
      cpyOptions.resume = true;
    }
    if (statusMapper["IN_PROGRESS"] > 0) {
      cpyOptions.pause = false;
      cpyOptions.cancel = false;
    } else {
      cpyOptions.pause = true;
      cpyOptions.cancel = true;
    }
    if (
      statusMapper["PROCESSED"] > 0 ||
      statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
    ) {
      cpyOptions.initateDelta = false;
    } else {
      cpyOptions.initateDelta = true;
    }

    if (statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0) {
      cpyOptions.download = false;
    } else {
      cpyOptions.download = true;
    }

    setDisabledList(cpyOptions);
  };

  const handleWorkSpaceMigrationStatus = async (action) => {
    try {
      setIsPageLoading(true);
      let workSpaceId = [];
      let actionStatus = "PAUSE";
      let apiAction = "pause";
      let wsStatus = "PAUSE";
      let apiCount = 0;
      if (action === "PAUSE" || action === "CANCEL") {
        actionStatus = "IN_PROGRESS";
        if (action === "CANCEL") {
          wsStatus = "CANCEL";
          apiAction = "cancel";
        }
      }
      if (action === "RESUME") {
        wsStatus = "IN_PROGRESS";
        actionStatus = "PAUSE";
        apiAction = "resume";
      }
      let checkBox = document.querySelectorAll("#selectWorkSpaceDM:checked");
      checkBox.forEach((input) => {
        input.checked = false;
        let status = input.getAttribute("data-status");
        if (status === actionStatus) {
          workSpaceId.push(input.getAttribute("data-workspaceid"));
        }
      });
      workSpaceId?.map(async (data) => {
        apiCount++;
        let res = await changeMessageWorkSpaceStatus(apiAction, data, "DM");
        if (res?.status === "OK") {
          if (workSpaceId?.length === apiCount) {
            apiAction = apiAction === "resume" ? "resumed" : apiAction;
            notifyToast("success", `Migration ${apiAction} Successfully`);
          }
          let copyWs = [...dmsList];
          copyWs?.map((ws, index) => {
            if (ws.id === data) {
              if (apiAction === "resume") {
                copyWs[index].threadStatus = "RESUME";
              }
              copyWs[index].processStatus = wsStatus;
            }
          });
          setDmsList(copyWs);
        }
      });
    } catch (error) {
    } finally {
      setIsPageLoading(false);
    }
  };

  const handleFilterChanges = (e, action) => {
    setFilters({
      ...filters,
      [action]: e,
    });

    let processStatus = filters?.processStatus?.value;
    let deltaMessage = filters?.deltaMessages?.value;
    let dmJobType = filters?.dmJobType?.value;
    if (action === "processStatus") {
      processStatus = e.value;
    }
    if (action === "deltaMessage") {
      deltaMessage = e.value;
    }
    if (action === "dmJobType") {
      dmJobType = e.value;
    }
    fetchDMReports(1, 50, dmJobType, processStatus, deltaMessage, searchVal);
    getPagination(deltaMessage, dmJobType, processStatus, searchVal);
  };

  const downloadReport = async (dmName, wsId) => {
    try {
      setIsPageLoading(true);
      let res = await downloadDMReport(wsId);
      if (res?.statusCode === 200) {
        downloadGlobalCSV(res?.res, `${dmName}_${wsId}_Report`);
      } else if (res?.statusCode === 202) {
        notifyToast(
          "success",
          "Report is in Progress,will be ready in few minutes"
        );
      } else {
        throw new Error("Failed Downloading Report");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const downloadCustomJobReport = async () => {
    setIsVisible(false);
    setDisabledList({ ...disabledList, download: true });
    let wsId = [];
    let chs = document.querySelectorAll(
      '[data-status="PROCESSED_WITH_SOME_CONFLICTS"]:checked'
    );

    chs?.forEach((input) => {
      wsId.push(input.getAttribute("data-workspaceid"));
    });

    try {
      wsId?.map(async (data) => {
        setIsPageLoading(true);
        let res = await getJobLevelCustomReport(
          data,
          defaultReport,
          "messageMoveWorkSpaceId"
        );
        if (res?.status === "OK") {
          setIsPageLoading(false);
          downloadGlobalCSV(res?.res, `DMS_${defaultReport}_data`);
        } else {
          setIsPageLoading(false);
        }
      });
    } finally {
    }
  };

  const handleSelectAllWorkSpaces = (e) => {
    if (e.target.checked) {
      let checkBox = document.querySelectorAll("#selectWorkSpaceDM");
      let statusMapper = {};
      checkBox.forEach((input) => {
        if (!input.checked) {
          statusMapper[input.getAttribute("data-status")] = statusMapper[
            input.getAttribute("data-status")
          ]
            ? statusMapper[input.getAttribute("data-status")] + 1
            : 1;
          input.checked = true;
        }
      });
      let cpyOptions = { ...disabledList };

      if (statusMapper["PAUSE"] > 0) {
        cpyOptions.resume = false;
      } else {
        cpyOptions.resume = true;
      }
      if (statusMapper["IN_PROGRESS"] > 0) {
        cpyOptions.pause = false;
        cpyOptions.cancel = false;
      } else {
        cpyOptions.pause = true;
        cpyOptions.cancel = true;
      }
      if (
        statusMapper["PROCESSED"] > 0 ||
        statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
      ) {
        cpyOptions.initateDelta = false;
      } else {
        cpyOptions.initateDelta = true;
      }

      if (statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0) {
        cpyOptions.download = false;
      } else {
        cpyOptions.download = true;
      }

      setDisabledList(cpyOptions);
    } else {
      let checkBox = document.querySelectorAll("#selectWorkSpaceDM");
      checkBox.forEach((input) => {
        input.checked = false;
      });
      setDisabledList({
        pause: true,
        retry: true,
        cancel: true,
        resume: true,
        download: true,
        initateDelta: true,
      });
    }
  };

  const handleErrorMessages = async (wsId) => {
    setSelectedErrorWorkSpaceId(wsId);
    setSelectedErrorMessages([]);
    try {
      setIsPageLoading(true);
      let res = await getErrorMessages(true, "", wsId);
      if (res?.status !== "OK") {
        throw new Error("No Error Messages Found");
      } else {
        setErrorList(res?.res);
        setErrorList({
          Unknown: "1",
          INACTIVE_USER_NOT_MAPPED: "14",
        });
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const handleSelectErrorMessage = (e, message) => {
    if (selectedErrorMessages.includes(message)) {
      let copyError = [...selectedErrorMessages];
      copyError = copyError.filter((data) => data !== message);
      setSelectedErrorMessages(copyError);
    } else {
      setSelectedErrorMessages([...selectedErrorMessages, message]);
    }
  };

  useEffect(() => {
    if (selectedErrorWorkSpaceId) {
      setDisabledList({
        ...disabledList,
        retry: !selectedErrorMessages?.length > 0,
      });
    } else {
      setDisabledList({
        ...disabledList,
        retry: true,
      });
    }
  }, [selectedErrorMessages, selectedErrorWorkSpaceId]);

  const startRetryErrorMessages = async () => {
    setIsPageLoading(true);
    selectedErrorMessages?.map(async (data, tIndex) => {
      let res = await retryErrorMessages(data, "", selectedErrorWorkSpaceId);
      if (res?.status === "OK") {
        // document.querySelector('[data-message="' + data + '"]').checked = false;
        document.querySelector('[data-message="' + data + '"]').disabled = true;
        let copyJobsList = [...dmsList];
        if (tIndex === 0) {
          copyJobsList?.map((job, index) => {
            if (job?.id === selectedErrorWorkSpaceId) {
              copyJobsList[index].processStatus = "IN_PROGRESS";
            }
          });
        }
        setDmsList(copyJobsList);
        if (tIndex + 1 === selectedErrorMessages?.length) {
          setIsPageLoading(false);
          setSelectedErrorMessages([]);
        }
      } else {
        if (tIndex + 1 === selectedErrorMessages?.length) {
          setIsPageLoading(false);
        }
      }
    });
  };

  return (
    <>
      <div className="cf_userMenu_action_pannel" style={{ gap: "15px" }}>
        <SearchComponent
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          defaultVal={searchVal}
          inputPlaceHolder={`Search By Chat Name`}
          onInputSearch={(e) => searchJobs(e?.searchInput)}
        />
        <span style={{ marginLeft: "auto" }}></span>
        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.pause ? "cf_button_disabled" : ""
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => handleWorkSpaceMigrationStatus("PAUSE")}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <CirclePause size={14} strokeWidth={2} />
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.resume ? "cf_button_disabled" : ""
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => handleWorkSpaceMigrationStatus("RESUME")}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <Play size={14} strokeWidth={2} />
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.cancel ? "cf_button_disabled" : ""
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => handleWorkSpaceMigrationStatus("CANCLE")}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <CircleX size={14} strokeWidth={2} color="red" />
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.download ? `cf_button_disabled` : ""
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => setIsVisible(true)}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Download size={16} strokeWidth={2} />
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.retry ? `cf_button_disabled` : ""
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => startRetryErrorMessages()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: "500" }}>Retry</span>
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover ${
            disabledList?.initateDelta ? `cf_button_disabled` : ``
          }`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => initateDelta()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: "500" }}>
              Initate Delta
            </span>
          </div>
        </ActionButton>
        <ActionButton
          customClass={`changeButtonColorOnHover`}
          customStyles={{
            backgroundColor: "#f2f2f2",
            padding: "8px 12px",
            height: "40px",
          }}
          buttonType="button"
          buttonClickAction={() => checkDeltaMessages()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: "500" }}>
              Check Delta
            </span>
          </div>
        </ActionButton>
      </div>
      <div className="cf_reports_tableDiv">
        {/* <div className="cf_slackReportsBreadCrumbs"></div> */}
        <table className="cf_table_common">
          <thead
            className="cf_table_common_header cf_messageReports_table_header"
            style={{ backgroundColor: "transparent", color: "#454545" }}
          >
            <tr>
              <th style={{ width: "2%", verticalAlign: "center" }}>
                <div
                  className="CF_d-flex CF_Pointer ai-center"
                  style={{ gap: "10px" }}
                >
                  <ChevronRight size={12} style={{ visibility: "hidden" }} />
                  <input
                    type="checkbox"
                    onChange={handleSelectAllWorkSpaces}
                    checked={
                      document.querySelectorAll("#selectWorkSpaceDM:checked")
                        .length ===
                        document.querySelectorAll("#selectWorkSpaceDM")
                          .length &&
                      document.querySelectorAll("#selectWorkSpaceDM").length > 0
                    }
                  />
                </div>
              </th>
              <th style={{ width: "18%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <span>Chat Name</span>
                  <CustomDropDown
                    defaultVal={filters?.deltaMessages}
                    dropDownList={[
                      { key: "All", value: "ALL" },
                      { key: "MESSAGE", value: "Delta Message" },
                    ]}
                    selectFilter={(e) => handleFilterChanges(e, "deltaMessage")}
                  >
                    <span className="CF_Pointer CF_d-flex ai-center">
                      <BiFilterAlt />
                    </span>
                  </CustomDropDown>
                </div>
              </th>
              <th style={{ width: "10%", textAlign: "center" }}>
                <div
                  className="CF_d-flex ai-center"
                  style={{ gap: "5px", justifyContent: "center" }}
                >
                  <span>Job Type</span>
                  <CustomDropDown
                    customDropDownStyles={{
                      width: "120px",
                    }}
                    defaultVal={filters?.dmJobType}
                    dropDownList={[
                      { key: "All", value: "all" },
                      { key: "One-Time", value: "ONETIME" },
                      { key: "Delta", value: "DELTA" },
                    ]}
                    selectFilter={(e) => handleFilterChanges(e, "dmJobType")}
                  >
                    <span className="CF_Pointer CF_d-flex ai-center">
                      <BiFilterAlt />
                    </span>
                  </CustomDropDown>
                </div>
              </th>
              <th style={{ width: "12%", textAlign: "center" }}>Type</th>
              <th style={{ width: "15%", textAlign: "center" }}>
                Initiated Date
              </th>
              <th style={{ width: "15%", textAlign: "center" }}>
                Processed Date
              </th>
              <th style={{ width: "12%" }}>
                <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                  <span>Status</span>
                  <CustomDropDown
                    customDropDownStyles={{
                      width: "240px",
                      right: "-100%",
                    }}
                    defaultVal={filters?.processStatus}
                    dropDownList={[
                      { key: "All", value: "all" },
                      { key: "Processed", value: "PROCESSED" },
                      { key: "In Progress", value: "IN_PROGRESS" },
                      { key: "Not Processed", value: "NOT_PROCESSED" },
                      {
                        key: "Processed With Some Conflicts",
                        value: "PROCESSED_WITH_SOME_CONFLICTS",
                      },
                      { key: "Conflict", value: "CONFLICT" },
                    ]}
                    selectFilter={(e) =>
                      handleFilterChanges(e, "processStatus")
                    }
                  >
                    <span className="CF_Pointer CF_d-flex ai-center">
                      <BiFilterAlt />
                    </span>
                  </CustomDropDown>
                </div>
              </th>
              <th style={{ width: "8%", textAlign: "center" }}>Download</th>
            </tr>
          </thead>
          <tbody className="cf_messageReports_table_tbody">
            {dmsList?.map((data) => {
              return (
                <>
                  <tr key={data?.id}>
                    <td style={{ width: "2%", padding: "10px" }}>
                      <div
                        className="CF_d-flex ai-center"
                        style={{ gap: "10px" }}
                      >
                        {(data?.processStatus ===
                          "PROCESSED_WITH_SOME_CONFLICTS" &&
                          data?.fromCloudId &&
                          data?.toCloudId) ||
                        selectedErrorWorkSpaceId === data?.id ? (
                          selectedErrorWorkSpaceId === data?.id ? (
                            <ChevronDown
                              onClick={() => setSelectedErrorWorkSpaceId("")}
                              className="CF_Pointer"
                              size={12}
                            />
                          ) : (
                            <ChevronRight
                              onClick={() => handleErrorMessages(data?.id)}
                              className="CF_Pointer"
                              size={12}
                            />
                          )
                        ) : (
                          <ChevronRight
                            className="cf_button_disabled"
                            size={12}
                          />
                        )}

                        {data?.processStatus !== "NOT_PROCESSED" &&
                        data?.processStatus !== "CANCEL" &&
                        data?.threadStatus !== "CANCEL" &&
                        data?.fromCloudId !== undefined &&
                        data?.toCloudId !== null &&
                        !data?.deltaInitiated ? (
                          <input
                            type="checkbox"
                            id="selectWorkSpaceDM"
                            data-workspaceid={data?.id}
                            data-status={
                              data?.threadStatus === "RESUME"
                                ? data?.processStatus
                                : data?.threadStatus
                            }
                            onChange={handleWorkSpaceSelection}
                            data-deltaobj={encodeURIComponent(
                              JSON.stringify({
                                fromCloudId: {
                                  id: data?.fromCloudId?.id,
                                },
                                toCloudId: {
                                  id: data?.toCloudId?.adminCloudId,
                                },
                                channelDate: data?.sourceDeltaId,
                                fromRootId: data?.fromRootId,
                                toRootId: data?.toRootId,
                                channelName: data?.channelName,
                                emailPairs: data?.emailPairs,
                                destWebUrls: data?.destWebUrls,
                                destFolderIds: data?.destFolderIds,
                                channelType: data?.channelType,
                                specialCharacter: "-",
                                mainWSId: data?.id,
                                workSpaceName: data?.workSpaceName,
                                sourceDelegateCloudId:
                                  data?.sourceDelegateCloudId,
                                destDelegateCloudId: data?.destDelegateCloudId,
                                teamsId: data?.teamsId,
                                combination: data?.combination,
                              })
                            )}
                          />
                        ) : (
                          <input type="checkbox" disabled />
                        )}
                      </div>
                    </td>
                    <td>
                      <span>
                        {getMaxChar(
                          data?.channelName?.replaceAll("mpdm-", ""),
                          28
                        )}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {data?.deltaMigration ? "Delta" : "One-Time"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {getCloudName(data?.channelType)}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {formatDateNew(data?.createdTime, true).replaceAll(
                        "/",
                        "-"
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {data?.endTime
                        ? formatDateNew(data?.endTime, true).replaceAll(
                            "/",
                            "-"
                          )
                        : "---"}
                    </td>
                    <td
                      className={
                        data?.threadStatus
                          ? data?.threadStatus === "RESUME"
                            ? data?.processStatus
                            : data?.threadStatus
                          : data?.processStatus
                      }
                    >
                      {getCloudName(
                        data?.threadStatus
                          ? data?.threadStatus === "RESUME"
                            ? data?.processStatus
                            : data?.threadStatus
                          : data?.processStatus
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <BsDownload
                        className="CF_Pointer"
                        style={{
                          strokeWidth: "0.5",
                          color: "#0062ff",
                          fontSize: "14px",
                        }}
                        onClick={() =>
                          downloadReport(
                            data?.channelName?.replaceAll("mpdm-", ""),
                            data?.id
                          )
                        }
                      />
                    </td>
                  </tr>
                  {selectedErrorWorkSpaceId === data?.id
                    ? Object.keys(errorList)?.map((error, subIndex) => {
                        return (
                          <tr key={`i_${subIndex}`}>
                            <td></td>
                            <td colSpan="4">
                              <div className="CF_d-flex" style={{ gap: "8px" }}>
                                {error?.includes("SERVICE_UNAVAILABLE") ||
                                error?.includes("UNAVAILABLE") ||
                                error?.includes("RESOURCE_EXHAUSTED") ||
                                error?.includes("INTERNAL") ||
                                error?.includes("INTERNAL_ERROR") ||
                                error?.includes("INACTIVE_USER_NOT_MAPPED") ||
                                error?.includes("FILE_UPLOAD_ISSUE") ? (
                                  <input
                                    type="checkbox"
                                    data-jobid={data?.id}
                                    data-message={error}
                                    onChange={(e) =>
                                      handleSelectErrorMessage(e, error)
                                    }
                                    checked={selectedErrorMessages?.includes(
                                      error
                                    )}
                                  />
                                ) : (
                                  <input type="checkbox" disabled />
                                )}
                                <div>
                                  <span>
                                    {error}&nbsp;({errorList[error]})
                                  </span>
                                  <Info
                                    size={14}
                                    fill="#acacac"
                                    color="#fff"
                                    className="CF_Pointer"
                                    onClick={() => {
                                      setIsErrorPopupVisible(true);
                                      setSlectedErrorMessage(error);
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td></td>
                            <td></td>
                            <td></td>
                          </tr>
                        );
                      })
                    : ""}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cf_message_footerVal">
        <span>Total DM's : {pagination?.totalDocuments} </span>
        <span className="cf_ml_auto"></span>
        <span style={{ fontSize: "12px", fontWeight: "400" }}>
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
                <option value={data} key={`${data}_OPT`}>
                  {data}
                </option>
              );
            })}
          </select>
        </span>
      </div>

      <Popup
        options={{
          isOpen: isVisible,
          title: `Download Report`,
          popupWidth: "30%",
          popupHeight: "200px",
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "0 10px",

            gap: "30px",
          }}
        >
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <input
              type="radio"
              name="reportFor"
              value="ERROR"
              onChange={() => setDefaultReport("ERROR")}
              checked={defaultReport === "ERROR"}
            />
            <p>Error Report</p>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <input
              type="radio"
              name="reportFor"
              value="ACTIVE_INACTIVE_REPORT"
              onChange={() => setDefaultReport("ACTIVE_INACTIVE_REPORT")}
              checked={defaultReport === "ACTIVE_INACTIVE_REPORT"}
            />
            <p>Active/In Active Users Report</p>
          </div>
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Download"
            buttonClickAction={() => downloadCustomJobReport()}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: isVisible,
          title: `Download Report`,
          popupWidth: "30%",
          popupHeight: "200px",
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "0 10px",

            gap: "30px",
          }}
        >
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <input
              type="radio"
              name="reportFor"
              value="ERROR"
              onChange={() => setDefaultReport("ERROR")}
              checked={defaultReport === "ERROR"}
            />
            <p>Error Report</p>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
            <input
              type="radio"
              name="reportFor"
              value="ACTIVE_INACTIVE_REPORT"
              onChange={() => setDefaultReport("ACTIVE_INACTIVE_REPORT")}
              checked={defaultReport === "ACTIVE_INACTIVE_REPORT"}
            />
            <p>Active/In Active Users Report</p>
          </div>
        </div>
        <div className="cf_popup_container_footer">
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Download"
            buttonClickAction={() => downloadCustomJobReport()}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: isErrorPopupVisible,
          title: `Error Description`,
          popupWidth: "40%",
          popupHeight: "fit-content",
          popupTop: "150px",
        }}
        toggleOpen={setIsErrorPopupVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            gap: "30px",
          }}
        >
          <p style={{ fontWeight: "500" }}>
            {messageMigrationErrorMessages(slectedErrorMessage)}
          </p>
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageReportsDMs;
