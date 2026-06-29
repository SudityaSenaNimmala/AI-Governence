import { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import TopNav from "../../Resuables/Nav/TopNav";
import {
  customAppMenu,
  downloadGlobalCSV,
  notifyToast,
  onlyGroupsRequired,
  onlyTeamsRequired,
} from "../../helpers/utils";
import DemoSideNav from "./DemoSideNav";
import DemoTabSwitcher from "./DemoTabSwitcher";
import DemoTopInfo from "./DemoTopInfo";
import "./Demos.css";
import DemoConnectedApps from "./DemoConnectedApps";
import DemoLicenseManagement from "./DemoLicenseManagement";
import DemoUserManagement from "./DemoUserManagement";
import DemoOverView from "./DemoOverView";
import {
  downloadSaaSAppsReports,
  getDownloadSaaSReport,
  getDownloadStatus,
  getSaaSGroupsPagination,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import {
  getDemoLicensesList,
  getDownloadTODO,
  getGitHubUsersList,
  getGitHubWorkspaces,
} from "./DemoActions/DemoActions";
import DemoUserManagementGitHub from "./DemoUserManagementGitHub";
import DemoLicenseManagementGitHub from "./DemoLicenseManagementGitHub";
import DemoGroupManagement from "./DemoGroupManagement";
import DemoDomains from "./DemoDomains";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import Popup from "../../Resuables/Popup/Popup";
import { useNavigate } from "react-router-dom";
import SideNav from "../../Resuables/Nav/SideNav";
import DemoAssesments from "./DemoAssesments";
import SaaSAssessments from "./SaaSAssessments/SaaSAssessments";
import SaaSAssessmentCandidates from "./SaaSAssessments/SaaSAssessmentCandidates";
import SaaSAssessmentInvitation from "./SaaSAssessments/SaaSAssessmentInvitation";
import ShadowITOverView from "../ShadowIT/ShadowITOverView";
import ShadowITInfo from "../ShadowIT/ShadowITInfo";
import ClaudeOverview from "./ClaudeOverview/ClaudeOverview";
import GeminiOverview from "./GeminiOverview/GeminiOverview";
import { FileDown, RotateCw } from "lucide-react";
const DemosAppInsights = () => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [options, setOptions] = useState([]);
  const [orgData, setOrgData] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const { globalContext } = useContext(GlobalContext);
  const [totalCost, setTotalCost] = useState(0);
  const [currentTab, setCurrentTab] = useState(null);
  const [isGroupSync, setIsGroupSync] = useState(false);
  const [isLicenseSync, setIsLicenseSync] = useState(false);
  const [checkSync, setCheckSync] = useState("");
  const [isDownloadReportsLoading, setIsDownloadReportsLoading] = useState(false);
  const [isDownloadReportsReady, setIsDownloadReportsReady] = useState(false);
  const [isLoadingCompleted, setIsLoadingCompleted] = useState(false);
  const [activeReportType, setActiveReportType] = useState("");
  const [reportStatusMap, setReportStatusMap] = useState({});
  const statusPollTimersRef = useRef({});
  const statusInFlightRef = useRef({});
  const [claudeMetrics, setClaudeMetrics] = useState({
    totalTokens: 0,
    cachedTokens: 0,
    totalCost: 0,
  });
  const { adminEmail, memberId, providerName, ssoIdpCloudId, id } = {
    ...globalContext?.saasCloud,
  };
  const asyncReportProviders = [
    "DROPBOX_BUSINESS",
    "SHAREPOINT_ONLINE_BUSINESS",
    "MICROSOFT_OFFICE_365",
  ];
  const isAsyncReportProvider = asyncReportProviders.includes(providerName);
  const dropboxReportActions = [
    { value: "DROPBOX_REPORTS", label: "Member Deletion" },
    { value: "DROPBOX_TRANSFER_REPORTS", label: "Folder Transfer" },
  ];
  const sharepointReportActions = [
    { value: "ONDRIVE_USAGES", label: "OneDrive Usage" },
    { value: "SHAREPOINT_SITE_REPORT", label: "SharePoint Site" },
    { value: "SHAREPOINT_LIST_REPORT", label: "SharePoint List" },
    { value: "SHAREPOINT_PAGE_REPORT", label: "SharePoint Page" },
    { value: "SHAREPOINT_DOCUMENT_REPORT", label: "SharePoint Document" },
  ];
  const powerReportActions = [
    { value: "POWER_ENVIRONMENTS", label: "Power Environments" },
    { value: "POWER_USERS", label: "Power Users" },
    { value: "POWER_APPS", label: "Power Apps" },
    { value: "BOOKING_BUSINESS_REPORT", label: "Booking Business" },
    { value: "BOOKING_CUSTOMER_REPORT", label: "Booking Customer" },
    { value: "BOOKING_STAFF_MEMBER_REPORT", label: "Booking Staff" },
    { value: "BOOKING_SERVICE_REPORT", label: "Booking Service" },
    { value: "SIGNIN_AUDIT_LOGS", label: "Entra Applications Audit Logs" },
  ];
  // { value: "USER_SITE_REPORTS", label: "SharePoint Sites Activity Reports" },
  const directActions = [
    { value: "TODO", label: "TODO" },
    { value: "PLANER", label: "Planer" },
    { value: "LEARNING", label: "Learning" },
  ];
  const asyncReportOptions =
    providerName === "DROPBOX_BUSINESS"
      ? dropboxReportActions
      : providerName === "MICROSOFT_OFFICE_365"
        ? [...sharepointReportActions, ...powerReportActions]
        : sharepointReportActions;
  const showGenerateReportsSection =
    providerName !== "SENDGRID" &&
    providerName !== "JIRA" &&
    providerName !== "DROPBOX_BUSINESS" &&
    providerName !== "SHAREPOINT_ONLINE_BUSINESS" &&
    providerName !== "SHARE_FILE_BUSINESS";
  const showDurationSection =
    providerName !== "DROPBOX_BUSINESS" &&
    providerName !== "SHAREPOINT_ONLINE_BUSINESS" &&
    (showGenerateReportsSection ||
      providerName === "SENDGRID" ||
      providerName === "SHARE_FILE_BUSINESS");
  const trackedReportType =
    activeReportType || localStorage.getItem(`${providerName}ReportOptions`) || "";
  const getOptionStatusText = (type) => {
    const status = reportStatusMap?.[type];
    if (status === "PROCESSED") return "Processed";
    if (status === "DOWNLOAD") return "Downloading Report";
    if (status === "IN_PROGRESS") return "In progress";
    if (status === "CHECKING") return "Checking...";
    if (status === "REQUESTED") return "Requested";
    if (status === "FAILED") return "Failed";
    return "";
  };
  const clearStatusPoll = (type) => {
    if (statusPollTimersRef.current[type]) {
      clearTimeout(statusPollTimersRef.current[type]);
      delete statusPollTimersRef.current[type];
    }
  };
  const scheduleStatusPoll = (type) => {
    clearStatusPoll(type);
    statusPollTimersRef.current[type] = setTimeout(() => {
      checkDownloadReportsStatus(type);
    }, 10000);
  };
  const renderDurationOptions = () => (
    <>
      {providerName === "SENDGRID" ||
        providerName === "SHARE_FILE_BUSINESS" ? (
        <div className="CF_d-flex ai-center" style={{ gap: "20px", flexWrap: "wrap" }}>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="30Days"
              onChange={() =>
                setReportOptions({
                  ...reportOptions,
                  duration: 30,
                  custom: false,
                })
              }
              checked={reportOptions?.duration === 30}
            />
            <label htmlFor="30Days" style={{ fontWeight: "500" }}>
              30 Days
            </label>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="60Days"
              onChange={() =>
                setReportOptions({
                  ...reportOptions,
                  duration: 60,
                  custom: false,
                })
              }
              checked={reportOptions?.duration === 60}
            />
            <label style={{ fontWeight: "500" }} htmlFor="60Days">
              60 Days
            </label>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="90Days"
              onChange={() =>
                setReportOptions({
                  ...reportOptions,
                  duration: 90,
                  custom: false,
                })
              }
              checked={reportOptions?.duration === 90}
            />
            <label style={{ fontWeight: "500" }} htmlFor="90Days">
              90 Days
            </label>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="custom"
              onChange={() =>
                setReportOptions({
                  ...reportOptions,
                  custom: true,
                  duration: 120,
                })
              }
              checked={reportOptions?.custom}
            />
            <label style={{ fontWeight: "500" }} htmlFor="custom">
              Custom
            </label>
          </div>
          {reportOptions?.custom ? (
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              <div className="CF_customDuration_div">
                <div
                  className={
                    reportOptions?.duration < 150
                      ? "cf_cal_nextDate_disabled"
                      : ""
                  }
                  onClick={() => {
                    setReportOptions({
                      ...reportOptions,
                      duration: reportOptions?.duration - 30,
                    });
                  }}
                >
                  -
                </div>
                <input
                  type="number"
                  value={reportOptions?.duration}
                  readOnly
                />
                <div
                  onClick={() => {
                    setReportOptions({
                      ...reportOptions,
                      duration: reportOptions?.duration + 30,
                    });
                  }}
                >
                  +
                </div>
              </div>
            </div>
          ) : (
            ""
          )}
        </div>
      ) : (
        <div className="CF_d-flex ai-center" style={{ gap: "20px", flexWrap: "wrap" }}>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="7Days"
              onChange={() =>
                setReportOptions({ ...reportOptions, duration: 7 })
              }
              checked={reportOptions?.duration === 7}
            />
            <label htmlFor="7Days" style={{ fontWeight: "500" }}>
              7 Days
            </label>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="30Days"
              onChange={() =>
                setReportOptions({ ...reportOptions, duration: 30 })
              }
              checked={reportOptions?.duration === 30}
            />
            <label style={{ fontWeight: "500" }} htmlFor="30Days">
              30 Days
            </label>
          </div>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            <input
              type="radio"
              name="durationReport"
              id="180Days"
              onChange={() =>
                setReportOptions({ ...reportOptions, duration: 180 })
              }
              checked={reportOptions?.duration === 180}
            />
            <label style={{ fontWeight: "500" }} htmlFor="180Days">
              180 Days
            </label>
          </div>
        </div>
      )}
    </>
  );
  const [reportOptions, setReportOptions] = useState({
    type:
      providerName === "SHAREPOINT_ONLINE_BUSINESS"
        ? "SHAREPOINT_SITE_REPORT"
        : "TEAMS",
    duration: providerName === "SENDGRID" ? 30 : 7,
    custom: false,
  });

  const setMenuOptions = () => {
    let menuList = [];

    if (customAppMenu.overviewApps.includes(providerName)) {
      menuList.push({
        key: "OVERVIEW",
        value: "Overview",
      });
    }

    // if (customAppMenu.shadowItApps.includes(providerName)) {
    //   menuList.push({
    //     isSynced: true,
    //     key: "SHADOW_IT",
    //     value: "Shadow IT",
    //   });
    // }

    if (customAppMenu.assesmentsApps.includes(providerName)) {
      menuList.push({
        key: "ASSESSMENTS",
        value: "Assessments",
      });
    }

    if (customAppMenu.assessmentCandidatesApps.includes(providerName)) {
      menuList.push({
        isSynced: true,
        key: "ASSESSMENT_CANDIDATES",
        value: "Assessment Candidates",
      });
    }

    if (customAppMenu.assessmentInvitation.includes(providerName)) {
      menuList.push({
        isSynced: true,
        key: "ASSESSMENT_INVITATION",
        value: "Assessment Invitation",
      });
    }

    if (customAppMenu.interviewApps.includes(providerName)) {
      menuList.push({
        key: "INTERVIEWS",
        value: "Interviews",
      });
    }

    if (!customAppMenu.noResourcesApps.includes(providerName)) {
      menuList.push({
        key: "CONNECTED_APPS",
        value:
          providerName === "TAILSCALE"
            ? "Connected Devices"
            : providerName === "INSIGHTFUL"
              ? "Employee Management"
              : "Connected Apps",
      });
    }

    if (!customAppMenu.noUserManagementApps.includes(providerName)) {
      menuList.push({
        key: "USER_MANAGEMENT",
        value: "User Management",
      });
    }

    if (!customAppMenu.noTeamsGroupsApps.includes(providerName)) {
      menuList.push({
        key: "TEAMS_GROUPS",
        value:
          providerName === "CLAUDE" ? "Workspace Management" :
            providerName === "SLACK"
              ? `Channel Management`
              : onlyTeamsRequired.includes(providerName) ||
                providerName === "INSIGHTFUL"
                ? `Team Management`
                : `Group Management`,
      });
    }

    if (!customAppMenu.noLicenseApps.includes(providerName)) {
      menuList.push({
        key: "LICENSE_MANAGEMENT",
        value: "License Management",
      });
    }

    if (customAppMenu.noDomainApps.includes(providerName)) {
      menuList.push({
        isSynced: true,
        key: "DOMAINS",
        value: "Domains",
      });
    }

    if (customAppMenu.noDownloadApps.includes(providerName)) {
      menuList.push({
        isSynced: true,
        key: "DOWNLOAD_REPORTS",
        value: "Download Reports",
      });
    }

    if (ssoIdpCloudId && providerName !== "ATLASSIAN") {
      menuList = [];

      menuList.push({
        key: "USER_MANAGEMENT",
        value: "User Management",
      });

      menuList.push({
        key: "TEAMS_GROUPS",
        value:
          providerName === "SLACK"
            ? `Channel Management`
            : onlyTeamsRequired.includes(providerName) ||
              providerName === "INSIGHTFUL"
              ? `Team Management`
              : `Group Management`,
      });
    }

    setOptions(menuList);
  };

  useEffect(() => {
    setMenuOptions();
  }, [providerName, memberId, id]);

  const switchTab = (tab) => {
    if (tab?.key === "DOWNLOAD_REPORTS") {
      let currentOldTab = { ...currentTab };
      setIsVisible(true);
      setCurrentTab({});
      setCurrentTab(currentOldTab);
    } else {
      setCurrentTab(tab);
      let historyHash = window.location.hash.replace("#", "")?.split("?")[0];
      if (!window.location.hash?.includes("?")) {
        navigate(`#${tab?.key}`);
      }
      if (historyHash !== tab?.key) {
        navigate(`#${tab?.key}`);
      }
    }
  };

  useEffect(() => {
    let hash = window.location.hash.replace("#", "");
    if (options.length > 0 && !hash) {
      setCurrentTab(options[0]);
    }
  }, [options]);

  useEffect(() => {
    if (
      providerName === "GITHUB" ||
      providerName === "ATLASSIAN" ||
      providerName === "TERRAFORM" ||
      providerName === "ASANA" ||
      providerName === "PANDADOC" ||
      providerName === "SNOWFLAKE" ||
      providerName === "MAILTRAP" ||
      providerName === "HUBSTAFF" ||
      providerName === "AHA" ||
      providerName === "SENTRY" ||
      providerName === "CANNY"
    ) {
      setIsPageLoading(true);
      getTotalCostForGithub();
      fetchGitHubWorkspaces(memberId);
    }
  }, [id]);

  const fetchGitHubWorkspaces = async () => {
    let res = await getGitHubWorkspaces(id);
    if (res?.status === "OK") {
      setOrgData(
        providerName === "ATLASSIAN" ||
          providerName === "TERRAFORM" ||
          providerName === "ASANA" ||
          providerName === "PANDADOC" ||
          providerName === "AHA" ||
          providerName === "SENTRY" ||
          providerName === "MAILTRAP" ||
          providerName === "HUBSTAFF" ||
          providerName === "CANNY"
          ? {
            ...res?.res,
            data: [
              ...res?.res?.data,
              {
                organization: "ALL",
                usersCount: 0,
                githubCopilotUsersCount: 0,
                githubUsersCount: 0,
                copilotUsersCount: 0,
                totalCost: 0,
              },
            ],
          }
          : res?.res
      );
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const handleOrgChange = (org) => {
    setSelectedOrg(org);
  };

  const getTotalCostForGithub = async () => {
    let res = await getDemoLicensesList(id, providerName, "ALL");
    if (res?.status === "OK") {
      setTotalCost(res?.res?.reduce((acc, curr) => acc + curr?.cost, 0));
    }
  };

  const getToDoList = async (type) => {
    let res = await getDownloadTODO(id, type);
    if (res?.status === "OK") {
      downloadGlobalCSV(res?.res, `${providerName}_${reportOptions?.type}_`);
    }
  };

  const getReports = async () => {
    let csvGenerator = [
      "SHAREPOINT_SITE_REPORT",
      "SHAREPOINT_LIST_REPORT",
      "SHAREPOINT_PAGE_REPORT",
      "SHAREPOINT_DOCUMENT_REPORT",
      "DROPBOX_REPORTS",
      "DROPBOX_TRANSFER_REPORTS",
      "POWER_ENVIRONMENTS",
      "POWER_USERS",
      "POWER_APPS",
      "BOOKING_BUSINESS_REPORT",
      "BOOKING_CUSTOMER_REPORT",
      "BOOKING_STAFF_MEMBER_REPORT",
      "BOOKING_SERVICE_REPORT",
      "SIGNIN_AUDIT_LOGS",
      "USER_SITE_REPORTS",
      "ONDRIVE_USAGES"
    ];

    let directAPI = ["TODO", "PLANER", "LEARNING"];

    if (directAPI.includes(reportOptions?.type)) {
      getToDoList(reportOptions?.type);
    }

    if (
      providerName === "DROPBOX_BUSINESS" ||
      providerName === "SHAREPOINT_ONLINE_BUSINESS" ||
      csvGenerator.includes(reportOptions?.type)
    ) {
      // setIsVisible(false);
      localStorage.setItem(`${providerName}ReportOptions`, reportOptions?.type);
      setActiveReportType(reportOptions?.type);
      downloadDropboxReports(reportOptions?.type)
      return;
    }
    notifyToast("success", "Started Generating Your Report");
    setIsVisible(false);
    let res = await downloadSaaSAppsReports(
      memberId,
      providerName,
      reportOptions?.duration,
      reportOptions?.type
    );
    if (res?.status === "OK") {
      setIsVisible(false);
      if (res?.res) downloadGlobalCSV(res?.res, `${providerName}_${reportOptions?.type}_${reportOptions?.duration}D`);
    } else {
      setIsVisible(false);
      notifyToast("error", "Failed To Generate Report");
    }
  };

  useEffect(() => {
    let hash = window.location.hash.replace("#", "");
    if (hash?.includes("?")) {
      hash = hash?.split("?")[0];
    }
    if (hash) {
      if (hash === "CONNECTED_APPS") {
        let currentTab = {
          key: "CONNECTED_APPS",
          value:
            providerName === "TAILSCALE"
              ? "Connected Devices"
              : providerName === "INSIGHTFUL"
                ? "Employee Management"
                : "Connected Apps",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "LICENSE_MANAGEMENT") {
        let currentTab = {
          key: "LICENSE_MANAGEMENT",
          value: "License Management",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "USER_MANAGEMENT") {
        let currentTab = {
          key: "USER_MANAGEMENT",
          value: "User Management",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "TEAMS_GROUPS") {
        let currentTab = {
          key: "TEAMS_GROUPS",
          value: "Team Management",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "DOMAINS") {
        let currentTab = {
          key: "DOMAINS",
          value: "Domains",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "ASSESSMENTS") {
        let currentTab = {
          key: "ASSESSMENTS",
          value: "Assessments",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "ASSESSMENT_CANDIDATES") {
        let currentTab = {
          key: "ASSESSMENT_CANDIDATES",
          value: "Assessment Candidates",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "ASSESSMENT_INVITATION") {
        let currentTab = {
          key: "ASSESSMENT_INVITATION",
          value: "Assessment Invitation",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "OVERVIEW") {
        let currentTab = {
          key: "OVERVIEW",
          value: "Overview",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      } else if (hash === "SHADOW_IT") {
        let currentTab = {
          key: "SHADOW_IT",
          value: "Shadow IT",
        };
        setCurrentTab(currentTab);
        switchTab(currentTab);
      }
      if (!window.location.hash?.includes("?")) {
        navigate(`#${hash}`);
      }
    }
  }, [window.location.hash]);


  const checkDownloadReportsStatus = async (type) => {
    if (!type || statusInFlightRef.current[type]) return;
    statusInFlightRef.current[type] = true;
    setActiveReportType(type);
    setReportStatusMap((prev) => ({ ...prev, [type]: "IN_PROGRESS" }));
    setIsLoadingCompleted(true);
    let res = await getDownloadStatus(id, type);
    if (res?.status === "OK") {
      setIsLoadingCompleted(false);
      if (res?.res?.status === "PROCESSED") {
        clearStatusPoll(type);
        setIsDownloadReportsLoading(false);
        setIsDownloadReportsReady(true);
        setReportStatusMap((prev) => ({ ...prev, [type]: "PROCESSED" }));
      } else if (res?.res?.status === "IN_PROGRESS") {
        setIsDownloadReportsLoading(true);
        setIsDownloadReportsReady(false);
        setReportStatusMap((prev) => ({ ...prev, [type]: "IN_PROGRESS" }));
        scheduleStatusPoll(type);
      } else {
        clearStatusPoll(type);
        setReportStatusMap((prev) => ({ ...prev, [type]: "REQUESTED" }));
      }
    } else {
      clearStatusPoll(type);
      setReportStatusMap((prev) => ({ ...prev, [type]: "FAILED" }));
    }
    statusInFlightRef.current[type] = false;
  };

  const downloadDropboxReports = async (type) => {
    if (!type) return;
    setActiveReportType(type);
    setReportStatusMap((prev) => ({ ...prev, [type]: "DOWNLOAD" }));
    setIsDownloadReportsLoading(true);
    setIsDownloadReportsReady(false);
    let res = await getDownloadSaaSReport(id, type, providerName);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.headers["content-type"] === "text/csv") {
        clearStatusPoll(type);
        setIsDownloadReportsLoading(false);
        setIsDownloadReportsReady(false);
        setIsLoadingCompleted(false);
        let cpyMap = { ...reportStatusMap }
        delete cpyMap[type];
        setReportStatusMap(cpyMap);
        downloadGlobalCSV(res?.res, `${providerName}_${memberId}_${type}`);
      } else {
        setReportStatusMap((prev) => ({ ...prev, [type]: "IN_PROGRESS" }));
        checkDownloadReportsStatus(type);
      }
    } else {
      clearStatusPoll(type);
      setReportStatusMap((prev) => ({ ...prev, [type]: "FAILED" }));
    }
  };

  const preloadReportStatuses = async () => {
    if (!isAsyncReportProvider || !isVisible) return;
    const statusEntries = await Promise.all(
      asyncReportOptions.map(async (option) => {
        let res = await getDownloadStatus(id, option.value);
        if (res?.status === "OK" && res?.res?.status) {
          return [option.value, res?.res?.status];
        }
        return [option.value, ""];
      })
    );
    setReportStatusMap(Object.fromEntries(statusEntries));
  };

  // useEffect(() => {
  //   if (
  //     providerName === "DROPBOX_BUSINESS" ||
  //     providerName === "SHAREPOINT_ONLINE_BUSINESS" ||
  //     providerName === "MICROSOFT_OFFICE_365"
  //   ) {
  //     checkDownloadReportsStatus(localStorage.getItem(`${providerName}ReportOptions`));
  //   }
  // }, [id, providerName]);

  // useEffect(() => {
  //   if (
  //     providerName === "DROPBOX_BUSINESS" ||
  //     providerName === "SHAREPOINT_ONLINE_BUSINESS" ||
  //     providerName === "MICROSOFT_OFFICE_365"
  //   ) {
  //     checkDownloadReportsStatus(localStorage.getItem(`${providerName}ReportOptions`));
  //   }
  // }, [checkSync]);

  useEffect(() => {
    preloadReportStatuses();
  }, [isVisible, providerName, id]);

  useEffect(() => {
    if (!isVisible) {
      Object.keys(statusPollTimersRef.current).forEach((type) => clearStatusPoll(type));
    }
  }, [isVisible]);

  useEffect(() => {
    return () => {
      Object.keys(statusPollTimersRef.current).forEach((type) => clearStatusPoll(type));
    };
  }, []);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="Applications" />
        <div className="cf_main_content_place">
          <TopNav
            pageName={
              providerName === "CURSOR_AI" || providerName === "CLAUDE" ? `AI Management` : `SaaS Management`
            }
            backLink={"/Applications"}
          />
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{ padding: "10px 0", flexDirection: "column", gap: "15px" }}
          >
            <DemoTopInfo orgData={orgData} totalCost={totalCost} claudeMetrics={claudeMetrics} />
            <DemoTabSwitcher
              tabs={options}
              currentTab={currentTab?.key ? currentTab : options[0]}
              setCurrentTab={switchTab}
              orgData={orgData?.data}
              // orgData={[]}
              handleOrgChange={handleOrgChange}
              isGroupSync={isGroupSync}
              setCheckSync={setCheckSync}
              isLicenseSync={isLicenseSync}
              isDownloadReportsLoading={isAsyncReportProvider ? false : isDownloadReportsLoading}
              isDownloadReportsReady={isAsyncReportProvider ? false : isDownloadReportsReady}
              isLoadingCompleted={isAsyncReportProvider ? true : isLoadingCompleted}
              downloadDropboxReports={downloadDropboxReports}
            />
            {currentTab?.key === "OVERVIEW" ? providerName === "GOOGLE_WORKSPACE_" ? <GeminiOverview /> : providerName === "CLAUDE" ? <ClaudeOverview
              setClaudeMetrics={setClaudeMetrics}
            /> : <DemoOverView /> : ""}
            {currentTab?.key === "CONNECTED_APPS" ? <DemoConnectedApps /> : ""}
            {currentTab?.key === "ASSESSMENT_CANDIDATES" ? (
              <SaaSAssessmentCandidates />
            ) : (
              ""
            )}
            {currentTab?.key === "ASSESSMENT_INVITATION" ? (
              <SaaSAssessmentInvitation />
            ) : (
              ""
            )}
            {currentTab?.key === "LICENSE_MANAGEMENT" ? (
              providerName === "GITHUB_" ? (
                <DemoLicenseManagementGitHub
                  selectedOrgData={selectedOrg}
                  setIsLicenseSync={setIsLicenseSync}
                />
              ) : (
                <DemoLicenseManagement
                  selectedOrgData={selectedOrg}
                  setIsLicenseSync={setIsLicenseSync}
                  isLicenseSync={isLicenseSync}
                  checkSync={checkSync}
                />
              )
            ) : (
              ""
            )}
            {currentTab?.key === "USER_MANAGEMENT" ? (
              providerName === "GITHUB" ||
                providerName === "ASANA" ||
                providerName === "PANDADOC" ||
                providerName === "ATLASSIAN" ||
                providerName === "MAILTRAP" ||
                providerName === "HUBSTAFF" ||
                providerName === "AHA" ||
                providerName === "SENTRY" ||
                providerName === "CANNY" ||
                providerName === "TERRAFORM" ? (
                <DemoUserManagementGitHub selectedOrgData={selectedOrg} />
              ) : (
                <DemoUserManagement />
              )
            ) : (
              ""
            )}
            {currentTab?.key === "TEAMS_GROUPS" ? (
              <DemoGroupManagement
                setIsGroupSync={setIsGroupSync}
                isGroupSync={isGroupSync}
                checkSyncGroups={checkSync}
              />
            ) : (
              ""
            )}
            {currentTab?.key === "DOMAINS" ? <DemoDomains /> : ""}
            {currentTab?.key === "SHADOW_IT" ? (
              <DemoConnectedApps />
            ) : (
              // <ShadowITInfo filter="GOOGLE_WORKSPACE" />
              ""
            )}
            {currentTab?.key === "ASSESSMENTS" ? (
              providerName === "CODER_BYTE" ? (
                <DemoAssesments />
              ) : (
                <SaaSAssessments
                  setIsGroupSync={setIsGroupSync}
                  isGroupSync={isGroupSync}
                  checkSyncGroups={checkSync}
                />
              )
            ) : (
              ""
            )}
          </div>
        </div>
      </div>

      <Popup
        options={{
          isOpen: isVisible,
          title: `Download Report`,
          popupWidth: providerName === "MICROSOFT_OFFICE_365" ? "65%" : providerName === "DROPBOX_BUSINESS" ? "40%" : "45%",
          popupHeight:
            providerName === "DROPBOX_BUSINESS" ||
              providerName === "SENDGRID" ||
              providerName === "JIRA" ||
              providerName === "SHARE_FILE_BUSINESS"
              ? "300px"
              : "560px",
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "10px",
            flexDirection: "column",
            gap: "14px",
            justifyContent: "flex-start",
          }}
        >
          {showGenerateReportsSection ? (
            <div className="CF_Reports_Body_Div" style={{ border: "1px solid #e7e7ee", borderRadius: "8px", padding: "10px" }}>
              <p style={{ margin: "0 0 10px 0", fontWeight: "600" }}>Generate Reports For</p>
              <div className="CF_d-flex ai-center" style={{ gap: "20px", flexWrap: "wrap" }}>
                {!onlyGroupsRequired.includes(providerName) ? (
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="nameTeams"
                      checked={reportOptions?.type === "TEAMS"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "TEAMS" })
                      }
                    />
                    <label htmlFor="nameTeams" style={{ fontWeight: "500" }}>
                      {providerName === "SLACK" ? `Channels` : `Teams`}
                    </label>
                  </div>
                ) : (
                  ""
                )}
                {!onlyTeamsRequired.includes(providerName) ? (
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="nameGroups"
                      checked={reportOptions?.type === "GROUPS"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "GROUPS" })
                      }
                    />
                    <label style={{ fontWeight: "500" }} htmlFor="nameGroups">
                      Groups
                    </label>
                  </div>
                ) : (
                  ""
                )}
                {providerName !== "DROPBOX_BUSINESS" && <>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="nameUsers"
                      checked={reportOptions?.type === "USERS"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "USERS" })
                      }
                    />
                    <label style={{ fontWeight: "500" }} htmlFor="nameUsers">
                      Users
                    </label>
                  </div>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="appUsers"
                      checked={reportOptions?.type === "APPS"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "APPS" })
                      }
                    />
                    <label style={{ fontWeight: "500" }} htmlFor="appUsers">
                      Apps
                    </label>
                  </div>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="vivaEngage"
                      checked={reportOptions?.type === "VIVA"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "VIVA" })
                      }
                    />
                    <label style={{ fontWeight: "500" }} htmlFor="vivaEngage">
                      VIVA Engage
                    </label>
                  </div>
                  <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
                    <input
                      type="radio"
                      name="teamsReport"
                      id="sitesUsageReport"
                      checked={reportOptions?.type === "SITES"}
                      onChange={() =>
                        setReportOptions({ ...reportOptions, type: "SITES" })
                      }
                    />
                    <label style={{ fontWeight: "500" }} htmlFor="sitesUsageReport">
                      Sites Usage Report
                    </label>
                  </div>
                </>}
              </div>
              {showDurationSection && (
                <div style={{ marginTop: "12px" }}>
                  <p style={{ margin: "0 0 10px 0", fontWeight: "600" }}>Select Duration</p>
                  {renderDurationOptions()}
                </div>
              )}
            </div>
          ) : (
            ""
          )}
          {isAsyncReportProvider && (
            <div className="CF_Reports_Body_Div" style={providerName === "MICROSOFT_OFFICE_365" ? { padding: "0px", marginTop: "-10px" } : { border: "1px solid #e7e7ee", borderRadius: "8px", padding: "10px" }}>
              <p style={{ margin: "0 0 10px 0", fontWeight: "600" }}>
                {providerName === "DROPBOX_BUSINESS"
                  ? "Dropbox Reports"
                  : providerName === "MICROSOFT_OFFICE_365"
                    ? ""
                    : "SharePoint Reports"}
              </p>
              {providerName === "MICROSOFT_OFFICE_365" && <div className="CF_Reports_Body_Div" style={{ padding: "0px" }}>
                {directActions.map((option) => (
                  <div className="CF_d-flex" style={{ flexDirection: "column", gap: "8px" }}>
                    <label
                      key={option.value}
                      htmlFor={option.value}
                      className="CF_d-flex ai-center"
                      style={{
                        justifyContent: "space-between",
                        padding: "8px 10px",
                        cursor: "pointer",
                        border: reportOptions?.type === option.value ? "1px solid #6f2dff" : "1px solid #ececf5",
                        borderRadius: "6px",
                      }}
                    >
                      <span className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                        <input
                          type="radio"
                          name="teamsReport"
                          id={option.value}
                          checked={reportOptions?.type === option.value}
                          onChange={() =>
                            setReportOptions({ ...reportOptions, type: option.value })
                          }
                        />
                        <span style={{ fontWeight: "500" }}>{option.label}</span>
                      </span>
                    </label>
                  </div>
                ))}
              </div>}
              <div className="CF_d-flex" style={{ flexDirection: "column", gap: "8px" }}>
                {asyncReportOptions.map((option) => (
                  <label
                    key={option.value}
                    htmlFor={option.value}
                    className="CF_d-flex ai-center"
                    style={{
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      cursor: "pointer",
                      border: reportOptions?.type === option.value ? "1px solid #6f2dff" : "1px solid #ececf5",
                      borderRadius: "6px",
                    }}
                  >
                    <span className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                      <input
                        type="radio"
                        name="teamsReport"
                        id={option.value}
                        checked={reportOptions?.type === option.value}
                        onChange={() =>
                          setReportOptions({ ...reportOptions, type: option.value })
                        }
                      />
                      <span style={{ fontWeight: "500" }}>{option.label}</span>
                    </span>
                    <span className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "600",
                          color: trackedReportType === option.value ? "#0062ff" : "#6f6f7d",
                          background: trackedReportType === option.value ? "" : "",
                          borderRadius: "999px",
                          padding: "3px 8px",
                        }}
                      >
                        {getOptionStatusText(option.value)}
                      </span>
                      {reportStatusMap?.[option.value] && reportStatusMap?.[option.value] !== "PROCESSED" && reportStatusMap?.[option.value] !== "DOWNLOAD" ? (
                        <ActionButton
                          buttonType="button"
                          buttonClickAction={() => checkDownloadReportsStatus(option.value)}
                          customStyles={{
                            border: "none",
                            borderRadius: "4px",
                            background: "#f1f4ff",
                            color: "#0062ff",
                            fontSize: "11px",
                            fontWeight: "600",
                            padding: "4px 8px",
                            cursor: "pointer",
                            minWidth: "30px",
                          }}
                          title="Refresh status"
                        >
                          <div className="CF_d-flex ai-center">
                            <RotateCw size={10} />
                          </div>
                        </ActionButton>
                      ) : (
                        ""
                      )}
                      {reportStatusMap?.[option.value] === "PROCESSED" && reportStatusMap?.[option.value] !== "DOWNLOAD" ? (
                        <ActionButton
                          buttonType="button"
                          buttonClickAction={() => downloadDropboxReports(option.value)}
                          customStyles={{
                            border: "none",
                            borderRadius: "4px",
                            // background: "#ddd",
                            color: "#0062ff",
                            fontSize: "11px",
                            fontWeight: "600",
                            cursor: "pointer",
                            minWidth: "30px",
                          }}
                          title="Download report"
                        >
                          <div className="CF_d-flex ai-center">

                            <FileDown size={14} />
                          </div>
                        </ActionButton>
                      ) : (
                        ""
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {!showGenerateReportsSection && showDurationSection &&
            <div className="CF_Reports_Body_Div" style={{ border: "1px solid #e7e7ee", borderRadius: "8px", padding: "10px" }}>
              <p style={{ margin: "0 0 10px 0", fontWeight: "600" }}>Select Duration</p>
              {renderDurationOptions()}
            </div>}
        </div>
        <div
          className="cf_popup_container_footer"
          style={{ borderTop: "1px solid #ddd" }}
        >
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="150px"
            isLoading={false}
            isDisabled={false}
            buttonName="Download Report"
            buttonClickAction={() => getReports()}
          />
        </div>
      </Popup >

      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default DemosAppInsights;
