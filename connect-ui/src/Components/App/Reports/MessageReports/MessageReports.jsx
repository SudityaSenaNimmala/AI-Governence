import React, { useEffect, useRef, useState } from "react";
import {
  downloadGlobalCSV,
  getMaxChar,
  notifyToast,
} from "../../../helpers/utils";
import TabSwitcher from "../../../Resuables/TabSwitcher/TabSwitcher";
import {
  cloudImageMapper,
  getCloudName,
  getRandomArray,
  messageMigrationErrorMessages,
} from "../../../helpers/helpers";
import MessageReportWorkSpaces from "./MessageReportWorkSpaces";
import {
  changeMessageWorkSpaceStatus,
  checkForDeltaMessages,
  closeMessageTeams,
  getErrorMessages,
  getJobLevelCustomReport,
  getJobLevelReport,
  getJobReportsPaginationCount,
  getMessageJobs,
  getMessageReportsDetails,
  initiateDeltaJobLevel,
  retryErrorMessages,
} from "../../Migrations/Message/MessageActions/MessageActions";
import MessageReportsDMs from "./MessageReportsDMs";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import {
  ChevronDown,
  ChevronRight,
  CirclePause,
  CircleX,
  Download,
  Info,
  Play,
  RefreshCw,
} from "lucide-react";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import { BiFilterAlt } from "react-icons/bi";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import MessageReportsFiles from "./MessageReportsFiles";
import Popup from "../../../Resuables/Popup/Popup";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";

const MessageReports = () => {
  const [currentReportsView, setCurrentReportsView] = useState("JOBS");
  const [currentCombination, setCurrentCombination] = useState("");
  const [searchVal, setSearchVal] = useState("");
  const [selectedErrorJob, setSelectedErrorJob] = useState("");
  const [isErrorPopupVisible, setIsErrorPopupVisible] = useState(false);
  const [slectedErrorMessage, setSlectedErrorMessage] = useState("");
  const [workspacesId, setWorkspacesId] = useState("");
  const [selectedErrorMessages, setSelectedErrorMessages] = useState([]);
  const [updateReports, setUpdateReports] = useState("");
  const [defaultReport, setDefaultReport] = useState("ERROR");
  const [jobsList, setJobsList] = useState([]);
  const [errorList, setErrorList] = useState([]);
  const [isVisible, setIsVisible] = useState(false);
  const [jobFilter, setJobFilter] = useState({
    deltaMessage: { key: "All", value: "ALL" },
    migrationStatus: { key: "All", value: "All" },
    teamStatus: { key: "All", value: "All" },
  });
  const [selectedJobsList, setSelectedJobsList] = useState({
    deltaList: [],
    retryList: [],
  });
  const [disabledList, setDisabledList] = useState({
    pause: true,
    retry: true,
    cancel: true,
    resume: true,
    download: true,
    closeTeams: true,
    initateDelta: true,
  });
  const [pagination, setPagination] = useState({
    pageSize: 50,
    totalPages: 1,
    currentPage: 1,
    totalDocuments: 0,
  });
  const [currentTab, setCurrentTab] = useState(
    localStorage?.migration === "DM" ? "DM" : "CHANNELS"
  );
  const [isPageLoading, setIsPageLoading] = useState(true);
  const [currentJobId, setCurrentJobId] = useState("");
  const [reportsInfo, setReportsInfo] = useState({});

  // useEffect(() => {
  //   if (currentReportsView === "JOBS") {
  //     fetchMessageJobs();
  //   }
  // }, []);

  const fetchMessageJobs = async (
    pageNo = pagination?.currentPage,
    pageSize = pagination?.pageSize,
    migrationStatus = jobFilter?.migrationStatus?.value,
    teamStatus = jobFilter?.teamStatus?.value,
    deltaMessage = jobFilter?.deltaMessage?.value,
    combination = currentCombination,
    jobName = searchVal
  ) => {
    setDisabledList({ ...disabledList, retry: true });
    setSelectedErrorJob("");
    if (!currentCombination) {
      return false;
    }
    setIsPageLoading(true);
    let res = await getMessageJobs(
      pageNo,
      pageSize,
      migrationStatus,
      teamStatus,
      deltaMessage,
      combination,
      jobName
    );
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setJobsList(res?.res);
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (currentJobId) {
      setCurrentReportsView("WORKSPACES");
    }
  }, [currentJobId]);

  useEffect(() => {
    if (currentReportsView === "JOB") {
      setCurrentJobId("");
    }
  }, [currentReportsView]);

  // useEffect(() => {
  //   getJobsPagination();
  //   fetchUserInfo();
  // }, []);

  const getJobsPagination = async (
    migrationStatus = jobFilter?.migrationStatus?.key?.toLocaleLowerCase(),
    deltaMessages = jobFilter?.deltaMessage?.key?.toLocaleLowerCase(),
    teamStatus = jobFilter?.teamStatus?.key?.toLocaleLowerCase(),
    combination = currentCombination,
    messageJobName = ""
  ) => {
    let res = await getJobReportsPaginationCount(
      migrationStatus,
      deltaMessages,
      teamStatus,
      combination,
      messageJobName
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

  const fetchUserInfo = async () => {
    let res = await getMessageReportsDetails(currentCombination);
    if (res?.status === "OK") {
      setReportsInfo({ ...res?.res, modifiedDate: new Date().getTime() });
    } else {
      let asa = {
        modifiedDate: new Date().getTime(),
      };
      setReportsInfo(asa);
    }
  };

  const startCloseTeams = async () => {
    const close = async (id) => {
      try {
        let res = await closeMessageTeams(id);
        console.log(res);

        if (res?.status !== "OK") {
          throw new Error("Failed To Close Team");
        } else {
          notifyToast("success", "Teams Closed Successfully");
          let copyJobsList = [...jobsList];
          copyJobsList?.map((data, index) => {
            if (data?.id === id) {
              copyJobsList[index].optedDeltaMigration = false;
            }
          });
          setJobsList(copyJobsList);
          let dumpSelectedJobsList = selectedJobsList?.deltaList;
          dumpSelectedJobsList.splice(dumpSelectedJobsList.indexOf(id), 1);
          setSelectedJobsList({
            ...selectedJobsList,
            deltaList: dumpSelectedJobsList,
          });
        }
      } catch (error) {
        notifyToast("error", error.message);
      }
    };
    selectedJobsList?.deltaList?.map((data) => {
      close(data);
    });
  };

  const initateDelta = async () => {
    try {
      setIsPageLoading(true);
      let res = await initiateDeltaJobLevel(
        selectedJobsList?.deltaList,
        currentCombination
      );
      if (res?.status === "OK") {
        let copyJobsList = [...jobsList];
        selectedJobsList?.deltaList?.map((id) => {
          copyJobsList?.map((data, index) => {
            if (data?.id === id) {
              copyJobsList[index].jobStatus = "DELTA_INITIATED";
            }
          });
        });
        setSelectedJobsList({
          ...selectedJobsList,
          deltaList: [],
        });
        setDisabledList({
          ...disabledList,
          initateDelta: true,
          closeTeams: true,
          download: true,
        });
        notifyToast("success", "Delta Initiated Successfully");
        setJobsList(copyJobsList);
      } else {
        throw new Error("Failed To Initiate Delta");
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const handlePagination = (e) => {
    let { name, value } = e.target;
    let count = pagination?.totalDocuments;
    if (name === "pageSize") {
      fetchMessageJobs(
        1,
        +value,
        "All",
        "All",
        "ALL",
        currentCombination,
        searchVal
      );
      setPagination({
        ...pagination,
        currentPage: 1,
        pageSize: +value,
        totalPages: Math.ceil(count / +value),
      });
    } else {
      fetchMessageJobs(
        +value,
        pagination?.pageSize,
        "All",
        "All",
        "ALL",
        currentCombination,
        searchVal
      );
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
        fetchMessageJobs(
          1,
          50,
          "All",
          "All",
          "ALL",
          currentCombination,
          inputString
        );
      } else {
        fetchMessageJobs(1, 50, "All", "All", "ALL", currentCombination, "");
      }
    }, 500);
  };

  const handleFilterChanges = (e, action) => {
    setJobFilter({
      ...jobFilter,
      [action]: e,
    });
    let migrationStatus = jobFilter?.migrationStatus?.value;
    let deltaMessage = jobFilter?.deltaMessage?.value;
    let teamStatus = jobFilter?.teamStatus?.value;
    if (action === "migrationStatus") {
      migrationStatus = e.value;
    }
    if (action === "deltaMessage") {
      deltaMessage = e.value;
    }
    if (action === "teamStatus") {
      teamStatus = e.value;
    }
    fetchMessageJobs(
      1,
      50,
      migrationStatus,
      teamStatus,
      deltaMessage,
      currentCombination,
      ""
    );
    getJobsPagination(
      migrationStatus?.toLocaleLowerCase() !== "all" ? migrationStatus : "all",
      deltaMessage?.toLocaleLowerCase() !== "all" ? deltaMessage : "all",
      teamStatus?.toLocaleLowerCase() !== "all" ? teamStatus : "all",
      currentCombination,
      ""
    );
  };

  const checkDeltaMessages = async () => {
    try {
      setIsPageLoading(true);
      let res = await checkForDeltaMessages(false, currentCombination);
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

  const handleErrorMessages = async (jobId) => {
    setSelectedErrorJob(jobId);
    setSelectedErrorMessages([]);
    try {
      setIsPageLoading(true);
      let res = await getErrorMessages(true, jobId);
      if (res?.status !== "OK") {
        throw new Error("No Error Messages Found");
      } else {
        setErrorList(res?.res);
      }
    } catch (error) {
      notifyToast("error", error?.message);
    } finally {
      setIsPageLoading(false);
    }
  };

  const getRefreshReports = () => {
    if (currentReportsView === "JOBS") {
      getJobsPagination();
      fetchUserInfo();
      fetchMessageJobs(
        1,
        50,
        jobFilter?.migrationStatus?.value,
        jobFilter?.teamStatus?.value,
        jobFilter?.deltaMessage?.value,
        currentCombination,
        ""
      );
    } else {
      setUpdateReports(`${currentReportsView}|${self.crypto.randomUUID()}`);
      // refreshJobWorkspaces();
    }
  };

  const handleJobInput = (e) => {
    let jobStatus = e.target.getAttribute("data-status");
    let jobId = e.target.getAttribute("data-jobid");
    if (e.target.checked) {
      // if (jobStatus === "COMPLETED" || jobStatus === "PARTIALLY_COMPLETED") {
      let deltaJobs = [...selectedJobsList?.deltaList, jobId];
      let retryList = [...selectedJobsList?.retryList];
      retryList = [...retryList, jobId];
      setSelectedJobsList({
        ...selectedJobsList,
        deltaList: deltaJobs,
        retryList: retryList,
      });
      // }
    } else {
      let dumpSelectedJobsList = selectedJobsList?.deltaList;
      let retryList = selectedJobsList?.retryList;
      dumpSelectedJobsList.splice(dumpSelectedJobsList.indexOf(jobId), 1);
      retryList.splice(retryList.indexOf(jobId), 1);
      setSelectedJobsList({
        ...selectedJobsList,
        deltaList: dumpSelectedJobsList,
        retryList: retryList,
      });
    }

    let checkBox = document.querySelectorAll("#jobCheckBox:checked");
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
      statusMapper["COMPLETED"] > 0 ||
      statusMapper["PROCESSED"] > 0 ||
      statusMapper["PARTIALLY_COMPLETED"] > 0 ||
      statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
    ) {
      cpyOptions.initateDelta = false;
      cpyOptions.closeTeams = false;
    } else {
      cpyOptions.closeTeams = true;
      cpyOptions.initateDelta = true;
    }

    if (
      statusMapper["PARTIALLY_COMPLETED"] > 0 ||
      statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
    ) {
      cpyOptions.download = false;
    } else {
      cpyOptions.download = true;
    }
    console.log(cpyOptions);

    setDisabledList(cpyOptions);
  };

  const handleDownloadReport = () => {
    let totalCheckboxs = document.querySelectorAll(
      "#jobCheckBox:checked"
    ).length;
    let totalPartiallyCheckboxs = document.querySelectorAll(
      '[data-status="PARTIALLY_COMPLETED"]:checked'
    ).length;

    if (totalCheckboxs === totalPartiallyCheckboxs) {
      setDefaultReport("ERROR");
      setIsVisible(true);
    } else {
      downloadGeneralJobsReport();
    }
  };

  const downloadGeneralJobsReport = async () => {
    try {
      setIsPageLoading(true);
      selectedJobsList?.retryList?.map(async (data) => {
        let res = await getJobLevelReport(data);
        if (res?.statusCode === 200) {
          downloadGlobalCSV(res?.res, `${data}_JOB_REPORT`);
          let dumpSelectedJobsList = selectedJobsList?.deltaList;
          let retryList = selectedJobsList?.retryList;
          dumpSelectedJobsList.splice(dumpSelectedJobsList.indexOf(data), 1);
          retryList.splice(retryList.indexOf(data), 1);
          setSelectedJobsList({
            ...selectedJobsList,
            deltaList: dumpSelectedJobsList,
            retryList: retryList,
          });
          setIsPageLoading(false);
        } else if (res?.statusCode === 202) {
          notifyToast(
            "success",
            "Report is in Progress,will be ready in few minutes"
          );
          setIsPageLoading(false);
        } else {
          notifyToast("error", "Failed Generating Report");
          setIsPageLoading(false);
        }
      });
    } catch (error) {
      console.log(error);

      notifyToast("error", error?.message);
    } finally {
    }
  };

  const downloadCustomJobReport = async () => {
    setIsVisible(false);

    try {
      selectedJobsList?.retryList?.map(async (data) => {
        setIsPageLoading(true);
        let res = await getJobLevelCustomReport(data, defaultReport);
        if (res?.status === "OK") {
          setIsPageLoading(false);
          downloadGlobalCSV(res?.res, `Job_${defaultReport}_data`);
        } else {
          setIsPageLoading(false);
        }
      });
    } finally {
    }
  };

  const handleSelectAll = (e) => {
    let jobChecks = document.querySelectorAll("#jobCheckBox");
    let deltaList = [...selectedJobsList?.deltaList];
    let retryList = [...selectedJobsList?.retryList];
    let statusMapper = {};
    jobChecks?.forEach((input) => {
      if (e.target.checked) {
        if (!input.checked) {
          let jobId = input.getAttribute("data-jobid");
          deltaList.push(jobId);
          retryList.push(jobId);
          input.checked = true;
          statusMapper[input.getAttribute("data-status")] = statusMapper[
            input.getAttribute("data-status")
          ]
            ? statusMapper[input.getAttribute("data-status")] + 1
            : 1;
        }
      } else {
        input.checked = false;
        deltaList = [];
        retryList = [];
      }
    });
    if (e.target.checked) {
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
        statusMapper["COMPLETED"] > 0 ||
        statusMapper["PROCESSED"] > 0 ||
        statusMapper["PARTIALLY_COMPLETED"] > 0 ||
        statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
      ) {
        cpyOptions.initateDelta = false;
        cpyOptions.closeTeams = false;
      } else {
        cpyOptions.closeTeams = true;
        cpyOptions.initateDelta = true;
      }

      if (
        statusMapper["PARTIALLY_COMPLETED"] > 0 ||
        statusMapper["PROCESSED_WITH_SOME_CONFLICTS"] > 0
      ) {
        cpyOptions.download = false;
      } else {
        cpyOptions.download = true;
      }

      setDisabledList(cpyOptions);
    } else {
      setDisabledList({
        pause: true,
        cancel: true,
        retry: true,
        resume: true,
        download: true,
        closeTeams: true,
        initateDelta: true,
      });
    }
    setSelectedJobsList({
      ...selectedJobsList,
      deltaList: deltaList,
      retryList: retryList,
    });
  };

  useEffect(() => {
    setCurrentCombination(window.location.hash.replace("#", ""));
    if (localStorage?.migration === "DM") {
      setCurrentTab("DM");
    } else {
      setCurrentReportsView("JOBS");
    }
  }, [window.location.hash]);

  useEffect(() => {
    if (currentCombination) {
      getJobsPagination();
      fetchUserInfo();
      setSelectedJobsList({
        deltaList: [],
        retryList: [],
      });
      setDisabledList({
        pause: true,
        retry: true,
        cancel: true,
        resume: true,
        download: true,
        closeTeams: true,
        initateDelta: true,
      });
      if (currentReportsView === "JOBS") {
        fetchMessageJobs();
      }
    }
  }, [currentCombination]);

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
      let checkBox = document.querySelectorAll("#jobCheckBox:checked");
      checkBox.forEach((input) => {
        input.checked = false;
        let status = input.getAttribute("data-status");
        if (status === actionStatus) {
          workSpaceId.push(input.getAttribute("data-jobid"));
        }
      });
      let dumpDeltaList = selectedJobsList?.deltaList;
      let dumpRetryList = selectedJobsList?.retryList;
      workSpaceId?.map(async (data) => {
        apiCount++;
        setIsPageLoading(true);
        let res = await changeMessageWorkSpaceStatus(apiAction, data, "JOB");
        if (res?.status === "OK") {
          setIsPageLoading(false);
          if (workSpaceId?.length === apiCount) {
            apiAction = apiAction === "resume" ? "resumed" : apiAction;
            notifyToast("success", `Migration ${apiAction} Successfully`);
          }
          let copyWs = [...jobsList];
          copyWs?.map((ws, index) => {
            if (ws.id === data) {
              if (apiAction === "resume") {
                copyWs[index].threadStatus = "RESUME";
              }
              copyWs[index].jobStatus = wsStatus;
            }
          });
          dumpDeltaList = dumpDeltaList?.filter((dumData) => dumData !== data);
          dumpRetryList = dumpRetryList?.filter((dumRet) => dumRet !== data);
          // selectedJobsList?.deltaList
          setJobsList(copyWs);
        } else {
          setIsPageLoading(false);
          notifyToast("error", "Failed To Update Status");
          // throw new Error("Failed To Update Status");
        }
      });
      setSelectedJobsList({
        deltaList: dumpDeltaList,
        retryList: dumpRetryList,
      });
    } catch (error) {
      notifyToast("error", "");
    } finally {
      // setIsPageLoading(false);
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
    if (selectedErrorJob) {
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
  }, [selectedErrorMessages, selectedErrorJob]);

  const startRetryErrorMessages = async () => {
    setIsPageLoading(true);
    selectedErrorMessages?.map(async (data, tIndex) => {
      let res = await retryErrorMessages(data, selectedErrorJob);
      if (res?.status === "OK") {
        // document.querySelector('[data-message="' + data + '"]').checked = false;
        document.querySelector('[data-message="' + data + '"]').disabled = true;
        let copyJobsList = [...jobsList];
        if (tIndex === 0) {
          copyJobsList?.map((job, index) => {
            if (job?.id === selectedErrorJob) {
              copyJobsList[index].jobStatus = "IN_PROGRESS";
            }
          });
        }
        setJobsList(copyJobsList);
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
      <div className="cf_reports_content_container">
        <div className="cf_reports_migrations_info">
          <div
            className="cf_reports_migrations_info_title"
            style={{ gap: "10px" }}
          >
            <span>
              Updated{" "}
              {reportsInfo?.modifiedDate
                ? new Date(reportsInfo?.modifiedDate).toLocaleString()
                : ""}
            </span>
            {/* <span> */}
            <RefreshCw
              size={16}
              className="CF_Pointer"
              onClick={() => getRefreshReports()}
            />
            {/* </span> */}
          </div>
          <div className="cf_reports_migrations_info_body">
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Total Channels
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{reportsInfo?.totalChannelsCount ?? 0}</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed Channels
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{reportsInfo?.processedChannelsCount ?? 0}</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                In-Progress Channels
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{reportsInfo?.inprogressChannelsCount ?? 0}</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Total DM's
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{reportsInfo?.totalDmsCount ?? 0}</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                Processed DM's
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{reportsInfo?.processedDmsCount ?? 0}</p>
              </div>
            </div>
            <div className="cf_reports_migrations_info_body_tiles">
              <div className="cf_reports_migrations_info_body_tiles_title">
                In-Progress DM's
              </div>
              <div className="cf_reports_migrations_info_body_tiles_body">
                <p>{reportsInfo?.inprogressDmsCount ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
        <TabSwitcher
          returnCurrentTab={setCurrentTab}
          currentTab={currentTab}
          tabMenu={[
            {
              id: "CHANNELS",
              name: "Channels",
            },
            {
              id: "DM",
              name: "Direct Messages",
            },
          ]}
        />

        {currentTab === "CHANNELS" ? (
          <>
            {currentReportsView === "JOBS" ? (
              <>
                <div
                  className="cf_userMenu_action_pannel"
                  style={{ gap: "15px" }}
                >
                  <SearchComponent
                    autoOpen={true}
                    boxShadows={true}
                    inputName="searchInput"
                    defaultVal={searchVal}
                    inputPlaceHolder={
                      currentCombination === "S2C"
                        ? `Search By Space Name`
                        : currentCombination === "S2T" ||
                          currentCombination === "C2T"
                        ? `Search By Team Name`
                        : currentCombination === "S2S"
                        ? `Search By Channel Name`
                        : `Search By Channel Name`
                    }
                    onInputSearch={(e) => searchJobs(e?.searchInput)}
                  />
                  <span style={{ marginLeft: "auto" }}></span>
                  {currentCombination !== "S2T" ? (
                    <>
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
                        buttonClickAction={() =>
                          handleWorkSpaceMigrationStatus("PAUSE")
                        }
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
                        buttonClickAction={() =>
                          handleWorkSpaceMigrationStatus("RESUME")
                        }
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
                        buttonClickAction={() =>
                          handleWorkSpaceMigrationStatus("CANCLE")
                        }
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
                    </>
                  ) : (
                    ""
                  )}
                  <ActionButton
                    // customClass={`changeButtonColorOnHover ${
                    //   selectedJobsList?.retryList?.length > 0
                    //     ? ``
                    //     : `cf_button_disabled`
                    // }`}
                    customClass={`changeButtonColorOnHover ${
                      disabledList?.download ? "cf_button_disabled" : ""
                    }`}
                    customStyles={{
                      backgroundColor: "#f2f2f2",
                      padding: "8px 12px",
                      height: "40px",
                    }}
                    buttonType="button"
                    buttonClickAction={() => handleDownloadReport()}
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
                      <span style={{ fontSize: "12px", fontWeight: "500" }}>
                        Retry
                      </span>
                    </div>
                  </ActionButton>
                  <ActionButton
                    customClass={`changeButtonColorOnHover ${
                      disabledList?.closeTeams ? "cf_button_disabled" : ""
                    }`}
                    customStyles={{
                      backgroundColor: "#f2f2f2",
                      padding: "8px 12px",
                      height: "40px",
                    }}
                    buttonType="button"
                    buttonClickAction={() => startCloseTeams()}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <span style={{ fontSize: "12px", fontWeight: "500" }}>
                        Close Teams
                      </span>
                    </div>
                  </ActionButton>
                  <ActionButton
                    customClass={`changeButtonColorOnHover ${
                      disabledList?.initateDelta ? "cf_button_disabled" : ""
                    }`}
                    customStyles={{
                      backgroundColor: "#f2f2f2",
                      padding: "8px 12px",
                      height: "40px",
                    }}
                    buttonType="button"
                    buttonClickAction={() => initateDelta()}
                  >
                    <div style={{}}>
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
                  <table className="cf_table_common">
                    <thead
                      className="cf_table_common_header cf_messageReports_table_header"
                      style={{
                        backgroundColor: "transparent",
                        color: "#454545",
                      }}
                    >
                      <tr>
                        <th style={{ width: "2%" }}>
                          <div
                            className="CF_d-flex CF_Pointer ai-center"
                            style={{ gap: "10px" }}
                          >
                            <ChevronRight
                              size={12}
                              style={{ visibility: "hidden" }}
                            />
                            <input
                              type="checkbox"
                              onChange={handleSelectAll}
                              checked={
                                document.querySelectorAll("#jobCheckBox")
                                  .length ===
                                  document.querySelectorAll(
                                    "#jobCheckBox:checked"
                                  ).length &&
                                document.querySelectorAll("#jobCheckBox")
                                  .length > 0
                              }
                            />
                          </div>
                        </th>
                        <th style={{ width: "18%" }}>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            <div className="CF_d-flex ai-center">
                              <img
                                style={{ width: "20px", height: "20px" }}
                                src={cloudImageMapper(currentCombination)}
                                alt={currentCombination}
                              />
                            </div>
                            <span>
                              {currentCombination === "S2C" ||
                              currentCombination === "T2C" ||
                              currentCombination === "C2T" ||
                              currentCombination === "C2C"
                                ? `Space Name`
                                : ``}
                              {currentCombination === "S2T" ||
                              currentCombination === "T2T"
                                ? `Team Name`
                                : ``}
                              {currentCombination === "S2S"
                                ? `Channel Name`
                                : ``}
                              {currentCombination === "W2C" ||
                              currentCombination === "W2V"
                                ? `Group Name`
                                : ``}
                            </span>
                            <CustomDropDown
                              defaultVal={jobFilter?.deltaMessage}
                              dropDownList={[
                                { key: "All", value: "ALL" },
                                { key: "MESSAGE", value: "Delta Message" },
                              ]}
                              selectFilter={(e) =>
                                handleFilterChanges(e, "deltaMessage")
                              }
                            >
                              <span className="CF_Pointer CF_d-flex ai-center">
                                <BiFilterAlt />
                              </span>
                            </CustomDropDown>
                          </div>
                        </th>
                        {currentCombination === "S2T" ? (
                          <th style={{ width: "10%", textAlign: "center" }}>
                            Total Channels
                          </th>
                        ) : (
                          ""
                        )}
                        <th style={{ width: "12%", textAlign: "center" }}>
                          Total Messages
                        </th>
                        <th style={{ width: "15%", textAlign: "center" }}>
                          Processed Messages
                        </th>
                        <th style={{ width: "15%", textAlign: "center" }}>
                          In Progress Messages
                        </th>
                        <th style={{ width: "12%" }}>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            <span>Migration Status</span>
                            <CustomDropDown
                              customDropDownStyles={{ width: "170px" }}
                              defaultVal={jobFilter?.migrationStatus}
                              dropDownList={[
                                { key: "All", value: "ALL" },
                                { key: "In Progress", value: "IN_PROGRESS" },
                                { key: "Completed", value: "COMPLETED" },
                                { key: "Suspended", value: "SUSPENDED" },
                                {
                                  key: "Partially Completed",
                                  value: "PARTIALLY_COMPLETED",
                                },
                              ]}
                              selectFilter={(e) =>
                                handleFilterChanges(e, "migrationStatus")
                              }
                            >
                              <span className="CF_Pointer CF_d-flex ai-center">
                                <BiFilterAlt />
                              </span>
                            </CustomDropDown>
                          </div>
                        </th>
                        <th style={{ width: "8%" }}>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            <span>
                              {currentCombination === "S2T"
                                ? `Team Status`
                                : `Space Status`}
                            </span>
                            <CustomDropDown
                              customDropDownStyles={{
                                width: "120px",
                                right: "-100%",
                              }}
                              defaultVal={jobFilter?.teamStatus}
                              dropDownList={[
                                { key: "All", value: "All " },
                                { key: "Open", value: "Open" },
                                { key: "Closed", value: "Closed" },
                              ]}
                              selectFilter={(e) =>
                                handleFilterChanges(e, "teamStatus")
                              }
                            >
                              <span className="CF_Pointer CF_d-flex ai-center">
                                <BiFilterAlt />
                              </span>
                            </CustomDropDown>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="cf_messageReports_table_tbody">
                      {jobsList?.map((data) => {
                        return (
                          <>
                            <tr key={data?.id}>
                              <td style={{ width: "2%", padding: "10px" }}>
                                <div
                                  className="CF_d-flex ai-center"
                                  style={{ gap: "10px" }}
                                >
                                  {(data?.jobStatus === "COMPLETED" &&
                                    data?.totalMessages !==
                                      data?.processedMessages) ||
                                  selectedErrorJob === data?.id ? (
                                    selectedErrorJob === data?.id ? (
                                      <ChevronDown
                                        onClick={() => setSelectedErrorJob("")}
                                        className="CF_Pointer"
                                        size={12}
                                      />
                                    ) : (
                                      <ChevronRight
                                        onClick={() =>
                                          handleErrorMessages(data?.id)
                                        }
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
                                  {currentCombination !== "S2T" ? (
                                    data?.jobStatus === "CANCEL" ? (
                                      <input type="checkbox" disabled />
                                    ) : (
                                      <input
                                        type="checkbox"
                                        id="jobCheckBox"
                                        data-status={
                                          data?.jobStatus === "COMPLETED"
                                            ? data?.totalMessages !==
                                              data?.processedMessages
                                              ? "PARTIALLY_COMPLETED"
                                              : data?.jobStatus
                                            : data?.jobStatus
                                        }
                                        data-jobid={data?.id}
                                        onClick={handleJobInput}
                                        checked={
                                          selectedJobsList?.deltaList?.includes(
                                            data?.id
                                          ) &&
                                          selectedJobsList?.retryList?.includes(
                                            data?.id
                                          )
                                        }
                                      />
                                    )
                                  ) : (
                                    ""
                                  )}
                                  {currentCombination === "S2T" ? (
                                    data?.optedDeltaMigration &&
                                    (data?.jobStatus === "COMPLETED" ||
                                      data?.jobStatus ===
                                        "PARTIALLY_COMPLETED") ? (
                                      <input
                                        type="checkbox"
                                        id="jobCheckBox"
                                        data-status={
                                          data?.jobStatus === "COMPLETED"
                                            ? data?.totalMessages !==
                                              data?.processedMessages
                                              ? "PARTIALLY_COMPLETED"
                                              : data?.jobStatus
                                            : data?.jobStatus
                                        }
                                        data-jobid={data?.id}
                                        className={
                                          data?.optedDeltaMigration &&
                                          (data?.jobStatus === "COMPLETED" ||
                                            data?.jobStatus ===
                                              "PARTIALLY_COMPLETED")
                                            ? ""
                                            : "cf_button_disabled"
                                        }
                                        onClick={handleJobInput}
                                        checked={
                                          selectedJobsList?.deltaList?.includes(
                                            data?.id
                                          ) &&
                                          selectedJobsList?.retryList?.includes(
                                            data?.id
                                          )
                                        }
                                      />
                                    ) : (
                                      <input type="checkbox" disabled />
                                    )
                                  ) : (
                                    ""
                                  )}
                                </div>
                              </td>
                              <td>
                                <span
                                  className="cf_make_link_reports"
                                  onClick={() => setCurrentJobId(data?.id)}
                                >
                                  {getMaxChar(data?.jobName, 28)}
                                </span>
                              </td>
                              {currentCombination === "S2T" ? (
                                <td style={{ textAlign: "center" }}>
                                  {data?.totalChannels}
                                </td>
                              ) : (
                                ""
                              )}
                              <td style={{ textAlign: "center" }}>
                                {data?.totalMessages}
                              </td>
                              <td style={{ textAlign: "center" }}>
                                {data?.processedMessages}
                              </td>
                              <td style={{ textAlign: "center" }}>
                                {data?.inProgressMessages}
                              </td>
                              <td className={data?.jobStatus}>
                                {data?.jobStatus === "COMPLETED" &&
                                data?.totalMessages !== data?.processedMessages
                                  ? "Partially Completed"
                                  : getCloudName(data?.jobStatus)}
                              </td>
                              <td>
                                {data?.optedDeltaMigration ? "Open" : "Closed"}
                              </td>
                            </tr>
                            {selectedErrorJob === data?.id
                              ? Object.keys(errorList)?.map(
                                  (error, subIndex) => {
                                    return (
                                      <tr key={`d_${subIndex}`}>
                                        <td></td>
                                        <td colSpan="4">
                                          <div
                                            className="CF_d-flex"
                                            style={{ gap: "8px" }}
                                          >
                                            {(error?.includes(
                                              "SERVICE_UNAVAILABLE"
                                            ) ||
                                              error?.includes(
                                                "INACTIVE_USER_NOT_MAPPED"
                                              ) ||
                                              error?.includes("UNAVAILABLE") ||
                                              error?.includes(
                                                "RESOURCE_EXHAUSTED"
                                              ) ||
                                              error?.includes("INTERNAL") ||
                                              error?.includes(
                                                "INTERNAL_ERROR"
                                              ) ||
                                              error?.includes(
                                                "INACTIVE_USER_NOT_MAPPED"
                                              ) ||
                                              error?.includes(
                                                "FILE_UPLOAD_ISSUE"
                                              )) &&
                                            data?.optedDeltaMigration ? (
                                              <input
                                                type="checkbox"
                                                data-jobid={data?.id}
                                                data-message={error}
                                                onChange={(e) =>
                                                  handleSelectErrorMessage(
                                                    e,
                                                    error
                                                  )
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
                                                {error}&nbsp;({errorList[error]}
                                                )
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
                                  }
                                )
                              : ""}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="cf_message_footerVal">
                  <span>
                    Total Jobs :{" "}
                    {!isNaN(pagination?.totalDocuments)
                      ? pagination?.totalDocuments
                      : 0}{" "}
                  </span>
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
                        onChange={() =>
                          setDefaultReport("ACTIVE_INACTIVE_REPORT")
                        }
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
              </>
            ) : (
              ""
            )}
            {currentReportsView === "WORKSPACES" ? (
              <MessageReportWorkSpaces
                combination={currentCombination}
                updateReports={updateReports}
                refreshJobWorkspaces={getRefreshReports}
                changeCurrentView={setCurrentReportsView}
                setWorkspacesId={setWorkspacesId}
                jobId={currentJobId}
                changeCurrentJobId={setCurrentJobId}
              />
            ) : (
              ""
            )}
            {currentReportsView === "FILES" ? (
              <MessageReportsFiles
                updateReports={updateReports}
                refreshJobWorkspaces={getRefreshReports}
                changeCurrentView={setCurrentReportsView}
                workspacesId={workspacesId}
                jobId={currentJobId}
                changeCurrentJobId={setCurrentJobId}
              />
            ) : (
              ""
            )}
          </>
        ) : (
          <MessageReportsDMs
            updateReports={updateReports}
            combination={currentCombination}
          />
        )}
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessageReports;
