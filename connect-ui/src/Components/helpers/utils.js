import { toast } from "react-toastify";
import { axiosRequest } from "./apiRequest";
import { xAxiosRequest } from "./xcRequest";
import TimeAgo from "javascript-time-ago";
import en from "javascript-time-ago/locale/en";
import moment from "moment";
import { getOauthKeys } from "../App/Oauth/OauthActions/OauthApiActions";
import { integrationsList } from "./helpers";
import SalesForceLanguages from "./JSON/SalesForceLanguages.json";
import SalesForceRegions from "./JSON/SalesForceRegions.json";
import SalesForceTimeZones from "./JSON/SalesForceTimeZones.json";

TimeAgo.addDefaultLocale(en);

export const env = window.location.host.includes("localhost") ? "DEV" : "PROD";

export const parentDomain = window.location.host.includes("localhost")
  ? "localhost:3000"
  : "cloudfuzehost.com";

export const generateBasicAuth = (string1, string2) => {
  return `Basic ${btoa(`${string1}:${string2}`)}`;
};

export const validateEmail = (input) => {
  const emailRegx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegx.test(input);
};

export const clearLocalStorage = () => {
  const preserved = ['cf_user_name'];
  const saved = {};
  preserved.forEach(key => { const v = localStorage.getItem(key); if (v !== null) saved[key] = v; });
  localStorage.clear();
  Object.entries(saved).forEach(([key, val]) => localStorage.setItem(key, val));
};

export const notifyToast = (action, message, position) => {
  if (action === "success") {
    return toast.success(message, {
      position: position ?? "top-right",
      autoClose: 1500,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  } else if (action === "warn") {
    return toast.warn(message, {
      position: position ?? "top-right",
      autoClose: 1500,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  } else if (action === "error") {
    return toast.error(message, {
      position: position ?? "top-right",
      autoClose: 1500,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  } else {
    return toast.info(message, {
      position: position ?? "top-right",
      autoClose: 1500,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
    });
  }
};

export const isSessionValid = () => {
  let store = localStorage?.globalState
    ? JSON.parse(localStorage?.globalState)
    : {};

  let userTime = localStorage?.time ? +localStorage?.time : 0;
  const currentTime = new Date().getTime();
  const fifteenMinutes = 15 * 60 * 1000; // 15 minutes

  if (userTime === 0) {
    return false;
  }

  if (userTime && currentTime - userTime > fifteenMinutes) {
    return false;
  }

  if (store?.user?.id && store?.user && store?.authToken) {
    return true;
  } else {
    return false;
  }
};

export const isTimedOut = () => {
  let userTime = localStorage?.time ? +localStorage?.time : 0;
  const currentTime = new Date().getTime();
  const fifteenMinutes = 15 * 60 * 1000; // 15 minutes
  if (userTime === 0) {
    return false;
  }
  if (userTime && currentTime - userTime > fifteenMinutes) {
    return false;
  }
  return true;
};

export const protectedRoutes = () => {
  return "";
};

export const getUserId = () => {
  return JSON.parse(localStorage?.globalState)?.userId;
};

export const getDomainName = () => {
  return JSON.parse(localStorage?.globalState)?.user?.domain;
};

export const getUserAuthToken = () => {
  return localStorage?.globalState
    ? JSON.parse(localStorage?.globalState)?.authToken
      ? JSON.parse(localStorage?.globalState)?.authToken
      : ""
    : "";
};

export const getSelectedSourceCloudId = () => {
  return JSON.parse(localStorage?.globalState)?.sourceCloud?.id;
};

export const getSelectedDestinationCloudId = () => {
  return JSON.parse(localStorage?.globalState)?.destinationCloud?.id;
};

export const getSelectedSourceCloudName = () => {
  return JSON.parse(localStorage?.globalState)?.sourceCloud?.cloudName;
};

export const getSelectedDestinationCloudName = () => {
  return JSON.parse(localStorage?.globalState)?.destinationCloud?.cloudName;
};

export const getContentUserId = () => {
  return localStorage?.CFUser
    ? JSON.parse(localStorage?.CFUser)?.content?.id
    : "";
};

export const getMessageUserId = () => {
  return localStorage?.CFUser
    ? JSON.parse(localStorage?.CFUser)?.message?.id
    : "";
};

export const getCloudsList = async (action) => {
  let cl = [];
  let cloudDetails = await axiosRequest({
    method: "GET",
    path: `/vendor/list`,
  });
  if (action === "MIGRATION") {
    let contentUserId = getContentUserId();
    let xcloudDetails = {
      res: [],
    };
    if (contentUserId) {
      xcloudDetails = await xAxiosRequest({
        method: "GET",
        path: `/migration/users/${getContentUserId()}/get/all/cloud`,
      });
    }
    let messageUserId = getMessageUserId();
    let messageClouds = {
      res: [],
    };
    if (messageUserId) {
      messageClouds = await xAxiosRequest({
        method: "GET",
        path: `/messagemove/users/${messageUserId}/get/all/cloud`,
      });
    }

    if (xcloudDetails?.status === "OK") {
      cl = [...cl, ...xcloudDetails?.res];
    }
    if (messageClouds?.status === "OK") {
      cl = [...cl, ...messageClouds?.res];
    }
  }
  if (cloudDetails?.status === "OK") {
    cl = [...cl, ...cloudDetails?.res];
  }

  cloudDetails.res = cl;
  return cloudDetails;
};

export const getMaxChar = (string, trimCount) => {
  if (string) {
    string = string.replace(/  +/g, " ");
    string = string.replace("<", "&lt;");
    var f = "...";
    var d = string != undefined ? string.length : 0;
    if (string == "" || d < trimCount) {
      return string;
    } else {
      string = string.substring(0, trimCount - 3) + f;
    }
    return string;
  } else {
    return "-";
  }
};

export const validatePassword = (password, key) => {
  const minLength = /.{8,}/;
  const hasUpperCase = /[A-Z]/;
  const hasLowerCase = /[a-z]/;
  const hasDigit = /\d/;
  const hasSpecialChar = /[!@#$%^&*()_+{}[\]:;"'<>,.?~\-]/;

  key = key ?? `Password`;
  if (!password) {
    return `${key} is required`;
  }

  if (!minLength.test(password)) {
    return `${key} must be at least 8 characters long.`;
  }
  if (!hasUpperCase.test(password)) {
    return `${key} must contain at least one uppercase letter.`;
  }
  if (!hasLowerCase.test(password)) {
    return `${key} must contain at least one lowercase letter.`;
  }
  if (!hasDigit.test(password)) {
    return `${key} must contain at least one digit.`;
  }
  if (!hasSpecialChar.test(password)) {
    return `${key} must contain at least one special character.`;
  }

  return "";
};

export const getDateFormatted = (time) => {
  const timeAgo = new TimeAgo("en-US");
  return timeAgo.format(time);
};

export const getSizeFormatted = (sizeBytes, type) => {
  if (
    sizeBytes === undefined ||
    sizeBytes === null ||
    sizeBytes === 0 ||
    sizeBytes < 0 ||
    sizeBytes === "---"
  ) {
    return "0 KB";
  } else if (type === "FOLDER") {
    return "---";
  } else {
    if (sizeBytes === 0) {
      return "0 B";
    }
    const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const k = 1024;
    const decimalPlaces = 2;

    const i = Math.floor(Math.log(sizeBytes) / Math.log(k));
    const size = parseFloat(
      (sizeBytes / Math.pow(k, i)).toFixed(decimalPlaces)
    );
    return `${size} ${units[i]}`;
  }
};

export const downloadGlobalCSV = (fileStream, fileName, message) => {
  if (fileStream?.length === 0) {
    notifyToast(
      "success",
      "Report is in Progress,will be ready in few minutes"
    );
    return false;
  }
  var blob = new Blob([fileStream]);
  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.download =
    fileName +
    "_" +
    moment(new Date().getTime()).format("MMM Do, h:mm A") +
    ".csv";
  document.body.appendChild(link);
  link.setAttribute("type", "hidden");
  link.click();
  notifyToast("success", message ?? "Report Downloaded Successfully");
};

export const downloadGlobalZIP = (fileStream, fileName, message) => {
  if (!fileStream) {
    notifyToast("error", "No file found to download");
    return false;
  }

  const defaultFileName =
    fileName + "_" + moment().format("MMM Do, h:mm A") + ".zip";

  if (fileStream.size === 0) {
    notifyToast(
      "success",
      "Report is in progress, will be ready in a few minutes."
    );
    return false;
  }

  const downloadUrl = window.URL.createObjectURL(fileStream);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = defaultFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(downloadUrl);
};

export const getFileIcons = (fileName, type, isSite, extension) => {
  if (isSite) {
    type = "";
  }
  if (fileName === undefined || fileName === "undefined") return "-";
  let fileTypeImages = {
    pdf: "pdf.svg",
    ppt: "pptx.svg",
    pptx: "pptx.svg",
    doc: "docx.svg",
    docx: "docx.svg",
    xls: "xlsx.svg",
    xlsx: "xlsx.svg",
    csv: "xlsx.svg",
    jpeg: "photo.svg",
    jpg: "photo.svg",
    png: "photo.svg",
    gif: "photo.svg",
    zip: "zip.svg",
    mp4: "video.svg",
    mov: "video.svg",
    mkv: "video.svg",
    wmv: "video.svg",
    avi: "video.svg",
    webm: "video.svg",
    flv: "video.svg",
    exe: "exe.svg",
    html: "html.svg",
    folder: "folder.svg",
    file: "file.svg",
    txt: "file.svg",
    bin: "file.svg",
    SITE: "spo.svg",
    gdoc: "gdocs.svg",
  };
  let fileType = fileName.split(".")[fileName.split(".").length - 1];
  if (type === "folder") {
    if (fileTypeImages[fileType]) {
      return fileTypeImages[fileType];
    } else {
      return fileTypeImages[type];
    }
  } else if (isSite) {
    return "spo.svg";
  } else if (fileTypeImages[extension]) {
    return fileTypeImages[extension];
  } else if (fileTypeImages[fileType]) {
    return fileTypeImages[fileType];
  } else if (fileTypeImages[fileType] === undefined && type === "file") {
    return "file.svg";
  } else {
    return "folder.svg";
  }
};

export const getClouCombinationCode = (combination) => {
  let mapperString =
    combination ??
    `${getSelectedSourceCloudName()}_${getSelectedDestinationCloudName()}`;

  let mapper = {
    GOOGLE_CHAT_GOOGLE_CHAT: "C2C",
    GOOGLE_CHAT_MICROSOFT_TEAMS: "C2T",
    SLACK_MICROSOFT_TEAMS: "S2T",
    SLACK_GOOGLE_CHAT: "S2C",
    SLACK_SLACK: "S2S",
    FACEBOOK_WORKPLACE_GOOGLE_CHAT: "W2C",
    FACEBOOK_WORKPLACE_MS_VIVA_ENGAGE: "W2V",
    MICROSOFT_TEAMS_GOOGLE_CHAT: "T2C",
    MICROSOFT_TEAMS_MICROSOFT_TEAMS: "T2T",
  };
  return mapper[mapperString];
};

export const jsonToCSV = (jsonData, customHeaders, customKeys) => {
  const headers = Object.keys(jsonData[0]);

  const rows = jsonData.map((row) =>
    headers.map((header) => row[header]).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  return csv;
};

export const tableToCSV = (tableRef) => {
  const table = tableRef.current;
  let csvContent = "";

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const rowData = [];

    for (let j = 0; j < row.cells.length; j++) {
      rowData.push(
        row.cells[j].getAttribute("title")
          ? row.cells[j].getAttribute("title")
          : row.cells[j].textContent
      );
    }

    csvContent += rowData.join(",") + "\n";
  }
  return csvContent;
};

export const splitZipFile = async (file, chunkSize, type) => {
  let fileName = file?.name;
  let start = 0;
  let chunkCount = 1;
  let isFileUploading = true;
  let end = Math.min(chunkSize, file.size);
  let zipFileSize = file.size;
  let uploadedChunksSize = 0;
  let chunkFormData = new FormData();
  let fileSize = file.size;
  let totalChunkSize = 0;
  while (start < file.size) {
    const chunk = file.slice(start, end);
    chunkFormData.append(chunkCount, chunk);
    totalChunkSize += chunk?.size;
    start = end;
    chunkCount += 1;
    end = Math.min(start + chunkSize, file.size);
  }
  return {
    fileName: fileName,
    chunks: chunkFormData,
    chunkCount: chunkCount,
    zipFileSize: zipFileSize,
    totalChunks: Array.from(chunkFormData.keys).length,
    chunkTime: new Date().getTime(),
  };
  // deleteMappingCSV(type, "UPLOAD", chunkFormData.get(1), "ZIP");
};

export const getSourceAndDestination = (code, action) => {
  let mapper = {
    S2T: {
      SOURCE: "SLACK",
      DESTINATION: "MICROSOFT_TEAMS",
    },
    S2C: {
      SOURCE: "SLACK",
      DESTINATION: "GOOGLE_CHAT",
    },
    S2S: {
      SOURCE: "SLACK",
      DESTINATION: "SLACK",
    },
    C2C: {
      SOURCE: "GOOGLE_CHAT",
      DESTINATION: "GOOGLE_CHAT",
    },
    C2T: {
      SOURCE: "GOOGLE_CHAT",
      DESTINATION: "MICROSOFT_TEAMS",
    },
    T2C: {
      SOURCE: "MICROSOFT_TEAMS",
      DESTINATION: "GOOGLE_CHAT",
    },
    T2T: {
      SOURCE: "MICROSOFT_TEAMS",
      DESTINATION: "MICROSOFT_TEAMS",
    },
    W2C: {
      SOURCE: "FACEBOOK_WORKPLACE",
      DESTINATION: "GOOGLE_CHAT",
    },
    W2V: {
      SOURCE: "FACEBOOK_WORKPLACE",
      DESTINATION: "MS_VIVA_ENGAGE",
    },
  };
  return mapper[code] ? mapper[code][action] : "---";
};

export const globalDebounce = (func, delay) => {
  let debounceTimer;
  return function (...args) {
    const context = this;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => func.apply(context, args), delay);
  };
};

// export const combinationTypes = [
//   "COLLABORATION",
//   "CONTENT",
//   "CANVAS",
//   "EMAIL",
//   "TICKETING",
//   "CODE_REPOSITORY",
// ];

export const combinationTypes = [
  "MARKETING",
  "HR_EMPLOYEE_ENGAGEMENT",
  "COLLABORATION_COMMUNICATION",
  "PROJECT_MANAGEMENT",
  "DESING",
  "FILE_STORAGE_SHARING",
  "SCHEDULING",
  "ASSEMENTS_INTERVIEW",
  "IDENTITY_PROVIDER",
  "VIDEO_CONFERENCING",
  "INFRASTRUCTURE_AS_CODE",
  "NETWORKING_SOFTWARE",
  "VIDEO_LIVE_STREAMING_AND_ON_DEMAND",
  "WEBSITE_HOSTING",
  "EMAIL_MARKETING",
  "AI_ASSISTANT",
  "EMPLOYEE_MONITORING_AND_TIME_TRACKING",
  "AI_POWERED_CODE_EDITOR",
  "PASSWORD_MANAGER",
  "OTHERS",
  "VISUAL_ANALYTICS_PLATFORM",
  "HR_AND_PAYROLL",
];

export const categorizedApps = {
  MARKETING: ["HUBSPOT", "SENDGRID", "INSTANTLY"],
  HR_EMPLOYEE_ENGAGEMENT: ["MS_VIVA_ENGAGE"],
  COLLABORATION_COMMUNICATION: [
    "SLACK",
    "MICROSOFT_TEAMS",
    "GOOGLE_CHAT",
    "FACEBOOK_WORKPLACE",
    "MS_VIVA_ENGAGE",
    "CALENDLY",
  ],
  PROJECT_MANAGEMENT: [
    "BITBUCKET",
    "JIRA",
    "ASANA",
    "CLICKUP",
    "GITHUB",
    "ATLASSIAN",
    "CONFLUENCE",
    "NOTION",
    "ZOHO_DESK",
    "TEAMWORK",
  ],
  DESING: ["MURAL", "MIRO", "FIGMA"],
  FILE_STORAGE_SHARING: [
    "DROPBOX_BUSINESS",
    "GOOGLE_WORKSPACE",
    "SHARE_FILE_BUSINESS",
    "ONEDRIVE_BUSINESS_ADMIN",
    "SHAREPOINT_ONLINE_BUSINESS",
    "G_SUITE",
    "GOOGLE_SHARED_DRIVES",
    "MICROSOFT_OFFICE_365",
    "FILES_COM",
  ],
  SCHEDULING: ["GOOGLE_CALENDAR", "MICROSOFT_OUTLOOK"],
  ASSEMENTS_INTERVIEW: ["CODER_BYTE", "BRILLIUM"],
  IDENTITY_PROVIDER: ["ENTRA_SSO", "OKTA", "ONELOGIN"],
  VIDEO_CONFERENCING: ["ZOOM"],
  INFRASTRUCTURE_AS_CODE: ["TERRAFORM"],
  CLOUD_COMPUTING: ["AWS"],
  NETWORKING_SOFTWARE: ["TAILSCALE", "OPENVPN_CLOUD"],
  VIDEO_LIVE_STREAMING_AND_ON_DEMAND: ["TWITCH", "VIMEO"],
  WEBSITE_HOSTING: [
    "WORDPRESS",
    "WIX",
    "SQUARESPACE",
    "WEBSITE_BUILDER",
    "ZOHO_MAIL",
  ],
  AI_ASSISTANT: ["KAPA_AI"],
  EMAIL_MARKETING: ["SENDGRID", "MAILCHIMP", "CAMPAIGN_MONITOR"],
  EMAIL_HOSTING: ["GMAIL", "OUTLOOK", "YAHOO_MAIL", "HOTMAIL"],
  LEARNING_MANAGEMENT_SYSTEM: ["THINKIFIC"],
  EMPLOYEE_MONITORING_AND_TIME_TRACKING: ["INSIGHTFUL"],
  AI_POWERED_CODE_EDITOR: ["CURSOR_AI"],
  OTHERS: ["PANDADOC", "DOCUSIGN", "ADOBE_CREATIVE", "ADOBE_IDENTITY", "ONE_PASSWORD", "OTHERS"],
  PASSWORD_MANAGER: ["LASTPASS"],
  VISUAL_ANALYTICS_PLATFORM: ["TABLEAU"],
  HR_AND_PAYROLL: ["GUSTO"],
};

export const categorizedAppsNames = (name) => {
  let map = {
    MARKETING: "Marketing & Sales",
    HR_EMPLOYEE_ENGAGEMENT: "HR & Employee Engagement",
    COLLABORATION_COMMUNICATION: "Collaboration & Communication",
    DESING: "Design",
    PROJECT_MANAGEMENT: "Project Management",
    FILE_STORAGE_SHARING: "File Storage & Sharing",
    SCHEDULING: "Scheduling",
    ASSEMENTS_INTERVIEW: "Assessments & Interviews",
    IDENTITY_PROVIDER: "Identity Provider",
    VIDEO_CONFERENCING: "Video Conferencing",
    INFRASTRUCTURE_AS_CODE: "Infrastructure as Code",
    CLOUD_COMPUTING: "Cloud Computing",
    NETWORKING_SOFTWARE: "Networking Software",
    VIDEO_LIVE_STREAMING_AND_ON_DEMAND: "Video Live Streaming & On Demand",
    WEBSITE_HOSTING: "Website Hosting",
    EMAIL_MARKETING: "Email Marketing",
    EMAIL_HOSTING: "Email Hosting",
    AI_ASSISTANT: "AI Assistant",
    LEARNING_MANAGEMENT_SYSTEM: "Learning Management System",
    EMPLOYEE_MONITORING_AND_TIME_TRACKING: "Employee Monitoring & Time Tracking",
    AI_POWERED_CODE_EDITOR: "AI Powered Code Editor",
    PASSWORD_MANAGER: "Password Manager",
    OTHERS: "Others",
    VISUAL_ANALYTICS_PLATFORM: "Visual Analytics Platform",
    HR_AND_PAYROLL: "HR & Payroll",
  };
  return map[name] ?? "null";
};

export const getConvertedText = (text) => {
  if (!text) return "";
  text = text?.toLowerCase();
  let replace = text?.replaceAll("_", " ");
  let split = replace?.split(" ");
  let capitalize = split?.map(
    (word) => word?.charAt(0)?.toUpperCase() + word?.slice(1)
  );
  return capitalize?.join(" ");
};

export const formatDateToString = (inputDate) => {
  const [month, day, year] = inputDate.split("/");
  const fullYear = parseInt(year, 10) + 2000;

  const date = new Date(`${fullYear}-${month}-${day}`);

  const options = { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleDateString("en-US", options).replace(",", "");
};

export const openLinkInNewTab = (link) => {
  window.open(link, "_blank");
};

export const copyToClipboard = (text, message = "Link") => {
  navigator.clipboard.writeText(text).then(() => {
    notifyToast("success", `${message ?? "Link"} Copied to Clipboard`);
  });
};

export const makeFirstLetterCapital = (text) => {
  if (!text) return "";
  let split = text?.split(" ");
  let capitalize = split?.map(
    (word) => word?.charAt(0)?.toUpperCase() + word?.slice(1)?.toLowerCase()
  );
  return capitalize?.join(" ");
};

export const newImplementation = [
  ...(integrationsList()?.reduce((acc, cloud) => {
    return [...acc, cloud.cloudName];
  }, ["OTHERS"]) ?? []),
];

export const customAppMenu = {
  overviewApps: ["CURSOR_AI", "GITHUB", "CLAUDE", "GOOGLE_WORKSPACE_"],
  noResourcesApps: [
    "MIRO",
    "BOX",
    "BOX_BUSINESS",
    "DROPBOX",
    "DROPBOX_BUSINESS",
    "MURAL",
    "SENDGRID",
    "SHARE_FILE_BUSINESS",
    "BITBUCKET",
    "JIRA",
    "HUBSPOT",
    "SENDGRID",
    "FACEBOOK_WORKPLACE",
    "CODER_BYTE",
    "BRILLIUM",
    "CLICKUP",
    "GITHUB",
    "ZOOM",
    "TERRAFORM",
    "ATLASSIAN",
    "THINKIFIC",
    "ASANA",
    "DOCUSIGN",
    "PANDADOC",
    "CURSOR_AI",
    "OTHERS",
    "LUMA",
    "OPENVPN_CLOUD",
    "LASTPASS",
    ...newImplementation,
    // "INSIGHTFUL"
  ],
  noDomainApps: ["GOOGLE_WORKSPACE", "MICROSOFT_OFFICE_365"],
  noLicenseApps: ["FACEBOOK_WORKPLACE", "INSIGHTFUL", "LUMA"],
  noUserManagementApps: [""],
  noTeamsGroupsApps: ["CODER_BYTE", "TAILSCALE", "BRILLIUM", "PANDADOC", "CURSOR_AI", "OTHERS", "LUMA", "MAILCHIMP", "BAMBOOHR", "LINKEDIN", "MAILTRAP"],
  noDownloadApps: ["GOOGLE_WORKSPACE", "MICROSOFT_OFFICE_365", "DROPBOX_BUSINESS"],
  shadowItApps: ["GOOGLE_WORKSPACE", "MICROSOFT_OFFICE_365"],
  assesmentsApps: ["CODER_BYTE", "BRILLIUM"],
  assessmentCandidatesApps: ["BRILLIUM"],
  assessmentInvitation: ["BRILLIUM"],
  interviewApps: [""],
};

export const onlyTeamsRequired = ["HUBSPOT", "GITHUB", "ZOOM", "TERRAFORM"];

export const onlyGroupsRequired = [
  "GOOGLE_WORKSPACE",
  "BITBUCKET",
  "JIRA",
  "ASANA",
  "MIRO",
  "MURAL",
  "BOX_BUSINESS",
  "DROPBOX_BUSINESS",
  "SHARE_FILE_BUSINESS",
  "FACEBOOK_WORKPLACE",
  // "GITHUB",
  "CLICKUP",
  "CONFLUENCE",
  "ATLASSIAN",
  // "ZOOM",
];

export const noGroupsRequiredGroups = [
  "GOOGLE_WORKSPACE",
  "BITBUCKET",
  "JIRA",
  "ASANA",
  "MIRO",
  "MURAL",
  "BOX_BUSINESS",
  "DROPBOX_BUSINESS",
  "SHARE_FILE_BUSINESS",
  "FACEBOOK_WORKPLACE",
  "CLICKUP",
  "CONFLUENCE",
  "ATLASSIAN",
  // "ZOOM",
];

export const onlyTeamsRequiredGroups = [
  "HUBSPOT",
  "GITHUB",
  "ZOOM",
  "TERRAFORM",
];

export const getFilterStatus = (status) => {
  let mapper = {
    ALL: { key: "ALL", value: "All" },
    ACTIVE: { key: "ACTIVE", value: "Active" },
    IDLE: { key: "IDLE", value: "Idle" },
    IN_ACTIVE: { key: "IN_ACTIVE", value: "In Active" },
  };
  return mapper[status] ?? mapper["ALL"];
};

export const getStatusColor = (status, isBackground = false) => {
  if (!status) return isBackground ? "#f3f4f6" : "#6b7280";

  const statusColorMap = {
    ACTIVE: "#00c64f",
    COMPLETED: "#00c64f",
    PROCESSED: "#00c64f",
    APPROVED: "#16a34a",
    PROCESSED_WITH_SOME_ERRORS: "#00c64f",
    PROCESSED_WITH_SOME_WARNINGS: "#00c64f",
    PROCESSED_WITH_SOME_CONFLICTS: "#00c64f",
    PROCESSED_WITH_SOME_PAUSE: "#00c64f",
    PROCESSED_WITH_SOME_CONFLICTS_AND_PAUSE: "#00c64f",

    IN_PROGRESS: "#1220f6",
    IN_QUEUE: "#8B4513",
    NOT_STARTED: "#8B4513",
    NOT_PROCESSED: "#8B4513",
    PENDING: "#0062ff",

    ERROR: "#ff4c4c",
    FAILED: "#ff4c4c",
    REJECTED: "#ef4343e6",
    CANCEL: "#ff4c4c",
    CONFLICT: "#ff4c4c",

    WARNING: "#fbda78a4",
    SUSPENDED: "#cc6600",
    PAUSE: "#ff4c4c",
    IDLE: "#8B4513",

    IN_ACTIVE: "#6b7280",
    INACTIVE: "#6b7280",
  };

  const statusBackgroundColorMap = {
    ACTIVE: "rgba(200, 247, 214, 0.52)",
    COMPLETED: "rgba(200, 247, 214, 0.52)",
    PROCESSED: "rgba(200, 247, 214, 0.52)",
    APPROVED: "rgba(200, 247, 214, 0.52)",
    PROCESSED_WITH_SOME_ERRORS: "rgba(200, 247, 214, 0.52)",
    PROCESSED_WITH_SOME_WARNINGS: "rgba(200, 247, 214, 0.52)",
    PROCESSED_WITH_SOME_CONFLICTS: "rgba(200, 247, 214, 0.52)",
    PROCESSED_WITH_SOME_PAUSE: "rgba(200, 247, 214, 0.52)",
    PROCESSED_WITH_SOME_CONFLICTS_AND_PAUSE: "rgba(200, 247, 214, 0.52)",

    IN_PROGRESS: "#f2f3ff",
    IN_QUEUE: "#fef2e8",
    NOT_STARTED: "#fef2e8",
    NOT_PROCESSED: "#fef2e8",
    PENDING: "#f2f3ff",

    ERROR: "#fef2f2",
    FAILED: "#fef2f2",
    REJECTED: "#fef2f2",
    CANCEL: "#fef2f2",
    CONFLICT: "#fef2f2",

    WARNING: "#fef9e7",
    SUSPENDED: "#fff4e6",
    PAUSE: "#fef2f2",
    IDLE: "#fef2e8",

    IN_ACTIVE: "#f3f4f6",
    INACTIVE: "#f3f4f6",
  };

  const colorMap = isBackground ? statusBackgroundColorMap : statusColorMap;

  if (colorMap[status]) {
    return colorMap[status];
  }

  const upperStatus = status.toUpperCase();

  const sortedKeys = Object.keys(statusColorMap).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    if (upperStatus.includes(key) || key.includes(upperStatus)) {
      return colorMap[key] || (isBackground ? "#f3f4f6" : "#6b7280");
    }
  }

  return isBackground ? "#f3f4f6" : "#6b7280";
};

export const getCategoryForCloud = (vendorName) => {
  const category = Object.keys(categorizedApps).find((list) =>
    categorizedApps[list]?.includes(vendorName)
  );
  return category ? categorizedAppsNames(category) : "Others";
};

export const makeDataForCalender = (data) => {
  let res = {};
  let newData = data?.filter((cld) => Object.values(cld?.expiryDateMap)?.length > 0);
  let as = newData?.reduce((acc, cld) => {
    return [...acc, ...makeDataForVendor(cld)];
  }, []);
  return as;
};

const makeDataForVendor = (data) => {
  let renList = [];
  Object.keys(data?.expiryDateMap)?.forEach((key) => {
    let date = new Date(data?.expiryDateMap[key])
      ?.toISOString()
      ?.split("T")[0]
      ?.split("-");
    let timestamp = 0;
    if (date) {
      timestamp = new Date(date[0], date[1] - 1, date[2]).getTime();
    }
    renList.push({
      renewalDate: timestamp,
      productKey: key,
      cost: data?.totalCost,
      vendorName: data?.vendorName,
      adminCloudId: data?.adminCloudId,
      externalProviderName: data?.externalProviderName,
    })
  })

  return renList;
}

export const transformDataToCalender = (input) => {
  const result = {};

  for (const [productKey, productArray] of Object.entries(input)) {
    productArray.forEach((product) => {
      for (const [name, dateStr] of Object.entries(product)) {
        if (dateStr) {
          let date = new Date(dateStr)
            ?.toISOString()
            ?.split("T")[0]
            ?.split("-");
          let timestamp = 0;
          if (date) {
            timestamp = new Date(date[0], date[1] - 1, date[2]).getTime();
          }

          if (!result[timestamp]) {
            result[timestamp] = [];
          }
          result[timestamp].push(productKey);
        }
      }
    });
  }
  return result;
};

export const formatDateForRenewal = (date) => {
  const momentDate = moment.utc(date);
  const formatted = momentDate.format("ddd MMM DD HH:mm:ss [UTC] YYYY");
  return formatted;
};


const colors = [
  "#4CAF50",
  "#388E3C",
  "#81C784",
  "#A5D6A7",
  "#2C6B2F",
  "#66BB6A",
  "#8BC34A",
  "#43A047",
  "#64B5F6",
  "#FFC107",
  "#FF5722",
  "#9C27B0",
  "#00BCD4",
  "#FF9800",
  "#3F51B5",
  "#607D8B",
  "#009688",
  "#F44336",
  "#2196F3",
  "#673AB7",
  "#001a6f",
];

export const dullBackgroundColors = [
  "#CDE3D3",
  "#BFD8CC",
  "#D1E2E7",
  "#C8D9E4",
  "#B4C6CC",
  "#E6E6E6",
  "#F3EAE3",
  "#DAD7CD",
  "#E0D4C0",
  "#D6E3DA",
  "#E8E1EF",
  "#F2F2F2",
  "#D9E3E4",
  "#ECE6F0",
  "#EDE7DD",
  "#FFF2EB",
  "#F5F3FF",
  "#E2EFE6",
  "#DAE3EC",
  "#DDE6DB",
  "#D7E6F0",
  "#CEDDD8",
  "#E8F1F5",
  "#CBDAD5",
  "#F0F5F0",
];

export const getRandomColor = (action) => {
  const randomIndex = Math.floor(Math.random() * (action === "dull" ? dullBackgroundColors.length : colors.length));
  return action === "dull" ? dullBackgroundColors[randomIndex] : colors[randomIndex];
};

// const dullBackgroundColors = [
//   "#CDE3D3",
//   "#BFD8CC",
//   "#D1E2E7",
//   "#C8D9E4",
//   "#B4C6CC",
//   "#FFF2EB",
//   "#F5F3FF",
//   "#E2EFE6",
//   "#DAE3EC",
//   "#DDE6DB",
//   "#D7E6F0",
//   "#CEDDD8",
//   "#E8F1F5",
//   "#CBDAD5",
//   "#F0F5F0",
//   "#D8DADC",
//   "#C2B9C6",
//   "#B6C1A9",
//   "#D6B2A1",
//   "#CFC4B6",
//   "#BFAEA0",
//   "#C3C3B5",
//   "#AEB2B5",
//   "#D1C5B8",
//   "#D7C5D0"
// ];


export const formatCurrencyShort = (num) => {

  if (!num) return 0;

  if (num >= 1e9) {
    return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  }
  if (num >= 1e6) {
    return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1e3) {
    return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}


export const checkForKeyExists = async (vendor) => {
  if (localStorage.cursorInviteLink === "true") {
    return true;
  }

  if (localStorage.cursorInviteLink === "false") {
    return false;
  }

  let res = await getOauthKeys("CURSOR_AI")

  if (res?.status === "OK" && res?.res?.redirectUrl) {
    localStorage.setItem("cursorInviteLink", "true");
    return true;
  } else {
    localStorage.setItem("cursorInviteLink", "false");
    return false;
  }

  return false;

}
export const getPotentialCostSaving = (data) => {
  let count = data?.potentialCostSaving === 0
    ? data?.totalCost
      ? (
        (data?.totalCost / data?.totalUserCount) *
        (data?.idleUserCount + data?.inactiveUserCount)
      )
      : data?.potentialCostSaving
    : data?.potentialCostSaving;
  return count?.toString() === "NaN" ? 0 : count;
};

export const makeOnBoardObjectForExistingUser = (obj) => {

  let vendorFilter = obj?.vendorAdminCloudId?.filter(data => data?.split(":")[1])

  let listExistingVendor = obj?.vendorAdminCloudId?.reduce((acc, data) => {
    return acc.includes(`${data?.split(":")[0]}|${data?.split(":")[1]}`) ? acc : [...acc, `${data?.split(":")[0]}|${data?.split(":")[1]}`];
  }, [])


  if (vendorFilter?.length === 0) {
    vendorFilter = obj?.vendorAdminCloudId[0];
  } else {
    vendorFilter = vendorFilter[0];
  }

  let objs = {
    "email": obj?.email?.split("@")[0],
    "name": null,
    "firstName": null,
    "lastName": null,
    "passWord": null,
    "displayName": obj?.email,
    "changePasswordAtNextLogin": true,
    "alternateEmail": null,
    "vendor": null,
    "role": "OTHER",
    "subscriptionsCount": 0,
    "subIds": null,
    "createdTime": null,
    "errorMsg": null,
    "memberId": null,
    "location": null,
    "adminMemberId": null,
    "totalAllocatedSize": 0,
    "usedSize": 0,
    "freeSize": 0,
    "deleted": false,
    "assessmentUrl": null,
    "existingUser": true,
    "existingVendors": listExistingVendor,
    "existingAdminCloudId": vendorFilter?.split(":")[1],
    "existingMemberId": obj?.email,
    "saasUserId": null,
  }

  return objs;
}

export const downloadUserPasswordCSV = (data) => {
  let obj = data?.reduce((acc, data) => {
    if (data.errorMsg?.includes("User created") || !data?.errorMsg) {
      acc.push({
        Cloud: data?.vendor,
        Email: data?.email,
        Password: data?.password || data?.passWord,
      })
    }
  }, [])
  return acc;

  let csvData = jsonToCSV(obj);

  downloadGlobalCSV(csvData, `${data[0]?.email}-user-password.csv`, "User Credentials");
}

export const onBoardWithOutLicense = ["BOX_BUSINESS", "THINKIFIC", "DOCUSIGN", "LASTPASS", "FILES_COM", "TABLEAU", "GUSTO", "SNOWFLAKE", "S MARTSHEET", "MONGODBATLAS", "ZOHOCRM", "BAMBOOHR", "SERVICENOW", "CLOUDFLARE", "SALESFORCE", "INFORMATICA", "CONTENTFUL", "CHATGPT", "WORKDAY", "FRESH_DESK", "MAILGUN", "LATTICE", "TAXJAR", "PIPEDRIVE", "BILL_COM", "ACTIVECAMPAIN", "ZUORA", "OWNBACKUP", "RIPPLING", "DYNAMICS_365_SALES", "SAP_HANA_CLOUD", "AWS_IC", "AWS", "TRELLO", "MOUSEFLOW", "LAMBDATEST", "BITBUCKET", "FIVETRAN", "ZOHOCRM", "CLOUDFLARE", "FIVETRAN", "OPENVPN_CLOUD", "UBERALL", "SNIPE_IT", "SONARCLOUD", "YEXT", "AUTH0", "SENTRY", "PLANHAT", "DATADOG", "HEROKU", "PAGERDUTY", "TWILIO", "TAXJAR", "INSTANTLY", "JUMPCLOUD", "ACTIVE_CAMPAIGN", "PANDADOC", "TRELLO", "ACTIVECAMPAIGN", "SLING", "APPVEYOR", "XCORP", "MEMZO", "CHECKR", "PUBNUB", "VERCEL", "STATUSCAKE", "PISIGNAGE", "GEMFURY", "AVALARA", "ROLLBAR", "KINSTA", "MEMZO", "WP_ENGINE", "SHIFTER_IO", "VISUAL_VISITOR", "HACKERONE", "GURU", "POSTHOG", "AZURE_DEVOPS", "NETLIFY", "CLICKSEND", "ENVOY", "JOTFORM", "QUICKSIGHT_AWS", "WISTIA", "UNBOUNCE", "MIXPANEL", "DATABOX", "FAVRO", "AIRCALL", "CURSOR_AI", "GITHUB", "DOMO", "CISCO_WEBEX_TEAMS", "SIGMA_COMPUTING", "DOMO", "AIRCALL", "ROCKET_REACH", "EIGHTXEIGHT", "NEW_RELIC", "AUTOMOX", "APOLLO_IO", "AHA", "DYNATRACE", "DIGITALOCEAN", "DOCKER", "REDHAT", "DOMO", "SIGMA_COMPUTING", "FIFTEEN_FIVE", "AIKIDO", "RUNN", "HEX", "CLOSE", "CROWDSTRIKE",
  "ACTION1",
  "GRAFANA",
  "KAITEN",
  "PRODUCTBOARD",
  "SIGNNOW",
  "ZUBE_IO",
  "WAFEQ",
  "WORKABLE",
  "TESTFAIRY",
  "ZENDUTY",
  "LARKSUITE",
  "ARTICULATE_360",
  "JITBIT",
  "TWINGATE",
  "ISPRING_LEARN",
  "FRONT",
  "TESTRAIL",
  "LEARNUPON",
  "TWILIO_SEGMENT",
  "GODADDY",
  "SURVEYMONKEY",
  "DEEL",
  "CALENDAR_HERO",
  "ALTERYX_CLOUD",
  "HUBSTAFF",
  "MONDAY",
  "TEAMWORK",
  "EZ_OFFICE",
  "OTHERS"
];

export const makeWorkFlowObject = (workFlow, workFlowBody, cloudsList) => {

  let workFlowClouds = workFlow?.workFlowLists;

  let cloudsMap = workFlowClouds?.reduce((acc, data) => {
    acc[data?.providerName + "|" + data?.adminCloudId] = cloudsList?.find((cloud) => cloud?.id === data?.adminCloudId)?.memberId;
    return acc;
  }, {})

  let adminCloudIdMap = workFlowClouds?.reduce((acc, data) => {
    acc[data?.providerName + "|" + data?.adminCloudId] = data?.adminCloudId;
    return acc;
  }, {})

  let uniqueCloudsList = workFlowClouds?.reduce((acc, data) => {
    acc.push(data?.providerName + "|" + data?.adminCloudId);
    return acc;
  }, [])

  let skews = workFlowClouds?.reduce((acc, data) => {
    acc[`${data?.providerName}|${cloudsList?.find((cloud) => cloud?.id === data?.adminCloudId)?.id}`] = {};
    return acc;
  }, {})

  let saaSApplicationRoles = workFlowClouds?.reduce((acc, data) => {
    acc[data?.providerName + "|" + data?.adminCloudId] = data?.saaSApplicationRoles;
    return acc;
  }, {})

  let timeZones = workFlowClouds?.reduce((acc, data) => {
    console.log(data)
    acc[data?.providerName + "|" + data?.adminCloudId] = data?.timeZone;
    return acc;
  }, {})

  let languages = workFlowClouds?.reduce((acc, data) => {
    acc[data?.providerName + "|" + data?.adminCloudId] = data?.language;
    return acc;
  }, {})

  let regions = workFlowClouds?.reduce((acc, data) => {
    acc[data?.providerName + "|" + data?.adminCloudId] = data?.region;
    return acc;
  }, {})

  workFlowClouds?.map((data) => {
    let pushData = []
    if (data?.providerName === "THINKIFIC") {
      pushData.push(data?.domainName);
    } else {
      data?.skus?.map((skew) => {
        if (skew?.vendor === "THINKIFIC") {
          pushData.push(skew?.domainName);
        } else {
          pushData.push({
            "planName": skew?.planName,
            "planId": skew?.planId,
            "productId": skew?.vendor === "TERRAFORM" ? skew?.organization : skew?.productId
          })
        }
      })
    }
    skews[`${data?.providerName}|${cloudsList?.find((cloud) => cloud?.id === data?.adminCloudId)?.id}`] = pushData;
  })

  let cloudsStatus = workFlowClouds?.reduce((acc, data) => {
    acc[data?.providerName + "|" + data?.adminCloudId] = "IN_PROGRESS";
    return acc;
  }, {})

  let workFlowObject = {
    ...workFlowBody,
    user: { ...workFlowBody?.user, jobTitle: workFlow?.workFlowName },
    clouds: cloudsMap,
    adminCloudId: adminCloudIdMap,
    uniqueCloudsList: uniqueCloudsList,
    skews: skews,
    saaSApplicationRoles: saaSApplicationRoles,
    onBoardingStarted: true,
    cloudsStatus: cloudsStatus,
    timeZones: timeZones,
    languages: languages,
    regions: regions,
  }

  return workFlowObject;

};


export const formatDateForGraph = (timestamp) => {
  const date = new Date(timestamp);
  const options = { month: 'short', day: 'numeric' };
  const formattedDate = date.toLocaleDateString('en-US', options);

  return formattedDate;
};


export const formatDataForGraph = (date, headers) => {
  let newArr = []
  date?.map((data) => {
    newArr.push({ name: formatDateForGraph(data?.usageOn ?? data?.usegeOn), "AI-Assisted Lines Added": data?.totalLinesAdded, "AI-Suggested Tabs Accepted": data?.totalTabsAccepted })
  })
  return newArr;
}


export const isGroupUserManagementExist = [
  "GOOGLE_WORKSPACE",
  "ATLASSIAN",
  "MICROSOFT_OFFICE_365",
  "HUBSPOT",
  "DROPBOX_BUSINESS",
  "BOX_BUSINESS",
  "ZOOM",
  "SLACK",
  "GUSTO",
  "JUMPCLOUD",
  "SMARTSHEET",
  "SNOWFLAKE",
  "MONGODBATLAS",
  "SAP_HANA_CLOUD",
  "ZOHOCRM",
  "SALESFORCE",
  "SERVICENOW",
  "INFORMATICA",
  "ASANA",
  "CLOUDFLARE",
  "AWS",
  "CHATGPT",
  "OPENAI",
  "WORKDAY",
  "FRESH_DESK",
  "MAILGUN",
  "LATTICE",
  "TAXJAR",
  "PIPEDRIVE",
  "BILL_COM",
  "ACTIVECAMPAIN",
  "ZUORA",
  "OWNBACKUP",
  "RIPPLING",
  "DYNAMICS_365_SALES",
  "SAP_HANA_CLOUD",
  "SERVICENOW",
  "INFORMATICA",
  "SALESFORCE",
  "CLOUDFLARE",
  "GITLAB",
  "TRELLO",
  "MOUSEFLOW",
  "LAMBDATEST",
  "UBERALL",
  "SNIPE_IT",
  "SONARCLOUD",
  "YEXT",
  "AUTH0",
  "SENTRY",
  "PLANHAT",
  "DATADOG",
  "HEROKU",
  "PAGERDUTY",
  "GURU",
  "SLING",
  "VERCEL",
  "STATUSCAKE",
  "PISIGNAGE",
  "ROLLBAR",
  "SHIFTER_IO",
  "AZURE_DEVOPS",
  "AWS_IC",
  "QUICKSIGHT_AWS",
  "AIRCALL",
  "GITHUB",
  "DOMO",
  "CISCO_WEBEX_TEAMS",
  "SIGMA_COMPUTING",
  "ROCKET_REACH", "EIGHTXEIGHT", "NEW_RELIC", "AUTOMOX", "APOLLO_IO", "AHA", "DYNATRACE", "DIGITALOCEAN", "DOCKER", "REDHAT", "DOMO", "SIGMA_COMPUTING", "FIFTEEN_FIVE", "AIKIDO", "RUNN", "HEX", "CLOSE", "CROWDSTRIKE",
  "ACTION1",
  "GRAFANA",
  "KAITEN",
  "PRODUCTBOARD",
  "SIGNNOW",
  "ZUBE_IO",
  "WAFEQ",
  "WORKABLE",
  "TESTFAIRY",
  "ZENDUTY",
  "LARKSUITE",
  "ARTICULATE_360",
  "JITBIT",
  "TWINGATE",
  "ISPRING_LEARN",
  "FRONT",
  "TESTRAIL",
  "MONDAY",
  "TABLEAU",
  "MONDAY",
  "TEAMWORK",
  "ALTERYX_CLOUD",
  "SHARE_FILE_BUSINESS",
  "DUO",
  "BRIVO",
  "EGNYTE_ADMIN"
];

export const formatMsToDateString = (ms) => {
  const d = new Date(ms);
  const date = d.getFullYear() + "-"
    + String(d.getMonth() + 1).padStart(2, "0") + "-"
    + String(d.getDate()).padStart(2, "0");

  return date;
};


export const listOfAIApplications = ["CURSOR_AI", "GITHUB"];


export const onBoardFields = {
  ZOHOCRM: [
    {
      name: "Profile Name *",
      type: "select",
      id: "PROFILES",
    },
    {
      name: "Role *",
      type: "select",
      id: "USER",
    },
  ],
  MONGODBATLAS: [
    {
      name: "Role *",
      type: "select",
      id: "USER",
    },
  ],
  CLOUDFLARE: [
    {
      name: "Role *",
      type: "select",
      id: "USER",
      inputType: "checkbox",
    },
  ],
  SALESFORCE: [
    {
      name: "TimeZone *",
      type: "select",
      id: "TIME_ZONES",
    },
    {
      name: "Region *",
      type: "select",
      id: "REGIONS",
    },
    {
      name: "Language *",
      type: "select",
      id: "LANGUAGES",
    },
    {
      name: "Profiles *",
      type: "select",
      id: "PROFILES",
    },
  ],
  INFORMATICA: [
    {
      name: "Role *",
      type: "select",
      id: "USER",
    },
  ],
  MOUSEFLOW: [
    {
      name: "Permission *",
      type: "select",
      id: "PERMISSION_ROLES",
    },
  ],
  "FIVETRAN": [
    {
      name: "Role *",
      type: "select",
      id: "USER",
    },
  ],
  "OPENVPN_CLOUD": [
    {
      name: "Permission *",
      type: "select",
      id: "PERMISSION_ROLES",
    },
  ],
  "SENTRY": [
    {
      name: "Organization *",
      type: "select",
      id: "SENTRY_ORGANIZATION",
    },
    {
      name: "Organization Role *",
      type: "select",
      id: "ORG_ROLES",
    },
    {
      name: "Team Role *",
      type: "select",
      id: "TEAM_ROLES",
    },
  ],
  "FRESH_DESK": [
    {
      name: "Role *",
      type: "select",
      id: "ROLE",
    },
  ],
  "TAXJAR": [
    {
      name: "Exemption Type *",
      type: "select",
      id: "EXEMPTION_TYPE",
    },
  ],
  "INSTANTLY": [
    {
      name: "Workspace *",
      type: "select",
      id: "WORKSPACE_ROLES",
    },
  ],
  "PANDADOC": [
    {
      name: "Workspace *",
      type: "select",
      id: "WORKSPACES",
    },
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    },
    {
      name: "Access Level *",
      type: "select",
      id: "LICENSES",
    },
  ],
  "TRELLO": [
    {
      name: "Workspace *",
      type: "select",
      id: "CUSTOM_ACTION",
      isApiAction: false
    }
  ],
  "MEMZO": [
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    },
  ],
  "WP_ENGINE": [
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    },
    {
      name: "Account *",
      type: "select",
      id: "ACCOUNT",
    },
  ],
  "VISUAL_VISITOR": [
    {
      name: "User Type *",
      type: "select",
      id: "USER",
    },
    {
      name: "Timezone *",
      type: "select",
      id: "TIMEZONE",
    },
  ],
  "QUICKSIGHT_AWS": [
    {
      name: "User Role *",
      type: "select",
      id: "USERROLE",
    },
    {
      name: "Namespace *",
      type: "select",
      id: "NAME_SPACE",
    }
  ],
  "DOMO": [
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    }
  ],
  "SIGMA_COMPUTING": [
    {
      name: "Account Type *",
      type: "select",
      id: "ACCOUNT_TYPES",
    }
  ],
  "GITHUB": [
    {
      name: "Role *",
      type: "select",
      id: "ROLE",
    },
    {
      name: "Organization *",
      type: "Select",
      id: "ORGANIZATION",
    }
  ],
  "RUNN": [
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    },
  ],
  "NEW_RELIC": [
    {
      name: "User Type *",
      type: "select",
      id: "USER_TYPE",
    },
  ],
  "LARKSUITE": [
    {
      name: "Role *",
      type: "select",
      id: "USER",
    },
  ],
  "KAITEN": [
    {
      name: "Role for Spaces *",
      type: "select",
      id: "ROLE_FOR_SPACES",
    },
  ],
  "LEARNUPON": [
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    },
  ],
  "TWILIO_SEGMENT": [
    {
      name: "User *",
      type: "select",
      id: "USER",
    },
  ],
  "MONDAY": [
    {
      name: "Role *",
      type: "select",
      id: "USER_ROLE",
    },
  ],
  "EZ_OFFICE": [
    {
      name: "Role *",
      type: "select",
      id: "ROLES",
    },
  ],
  "SHARE_FILE_BUSINESS": [
    {
      name: "Role *",
      type: "select",
      id: "PERMISSION_ROLES",
    },
  ],
};


export const userActionRequired = [
  "BAMBOOHR",
  "MONGODBATLAS",
  "ZOHOCRM",
  "CLOUDFLARE",
  "SALESFORCE",
  "INFORMATICA",
  "MOUSEFLOW",
  "FIVETRAN",
  "OPENVPN_CLOUD",
  "SENTRY",
  "FRESH_DESK",
  "TAXJAR",
  "INSTANTLY",
  "PANDADOC",
  "TRELLO",
  "MEMZO",
  "WP_ENGINE",
  "VISUAL_VISITOR",
  "QUICKSIGHT_AWS",
  "CURSOR_AI",
  "DOMO",
  "SIGMA_COMPUTING",
  "GITHUB",
  "RUNN",
  "NEW_RELIC",
  "LARKSUITE",
  "KAITEN",
  "LEARNUPON",
  "TWILIO_SEGMENT",
  "MONDAY",
  "EZ_OFFICE",
  "SHARE_FILE_BUSINESS"
  // "ACTIVECAMPAIGN",
];


export const colorPairs = [
  { dull: "#FFDFC8", dark: "#B2562B" },
  { dull: "#E8D9FF", dark: "#5A2E8A" },
  { dull: "#DDE7F2", dark: "#3A4F7A" },
  { dull: "#FFD6E7", dark: "#9E2A5C" },
  { dull: "#CFE8F3", dark: "#1E5673" },
  { dull: "#FFE6C8", dark: "#9C5A1A" },
  { dull: "#D6E9FF", dark: "#2F5FA8" },
  { dull: "#C8F7D6", dark: "#2D7F44" },
  { dull: "#D6F5EE", dark: "#1F6F63" },
  { dull: "#E0F2D8", dark: "#4E7C2F" },
  { dull: "#E6EBF0", dark: "#4A5568" },
  { dull: "#DCC8FF", dark: "#6B3DB2" },
];


export const zoomToFit = (containerRef, innerRef) => {
  const container = containerRef.current;
  const inner = innerRef.current;

  if (!container || !inner) {
    return { x: 0, y: 0, scale: 1 };  // safe fallback
  }

  const containerRect = container.getBoundingClientRect();
  const contentWidth = inner.scrollWidth;
  const contentHeight = inner.scrollHeight;

  const scaleX = containerRect.width / contentWidth;
  const scaleY = containerRect.height / contentHeight;

  const nextScale = Math.min(scaleX, scaleY, 1);

  const newX = (containerRect.width - contentWidth * nextScale) / 2;
  const newY = (containerRect.height - contentHeight * nextScale) / 2;

  return {
    x: newX,
    y: newY,
    scale: nextScale,
  };
};


export const getMomentAgo = (date) => {
  const now = moment();
  const targetTime = moment(date);

  const diffInDays = now.diff(targetTime, 'days');
  const diffInHours = now.diff(targetTime, 'hours');

  if (diffInDays > 0) {
    if (diffInDays === 1) {
      return `${diffInDays} day ago`;
    }
    return `${diffInDays} days ago`;
  } else if (diffInHours > 0) {
    if (diffInHours === 1) {
      return `${diffInHours} hour ago`;
    }
    return `${diffInHours} hours ago`;
  } else {
    return 'Just now';
  }
}

export const splitAlternate = (str) => {
  let first = "";
  let second = "";

  for (let i = 0; i < str.length; i++) {
    if (i % 2 === 0) {
      first += str[i];
    } else {
      second += str[i];
    }
  }

  return [first, second];
};


let typeFormat = new Map();
typeFormat.set("My Drive", "DRIVE");
typeFormat.set("SharePoint Site", "SITE");
typeFormat.set("SharePoint SubSite", "SUBSITE");
typeFormat.set("Shared Drive", "SHARED_DRIVE");
typeFormat.set("User", "USER");

export const csvToJson = (csvString, delimiter = ",", headerMap = null) => {
  const lines = csvString.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const csvHeaders = lines[0]
    .split(delimiter)
    .map((header) => header.trim().replace(/^"+|"+$/g, ""));
  const mappedHeaders = csvHeaders.map((header) =>
    headerMap && headerMap[header] ? headerMap[header] : header
  );
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return mappedHeaders.reduce((obj, header, index) => {
      let val = values[index] ? values[index].trim().replace(/^"+|"+$/g, "") : "";
      if (header === "type" && typeFormat.has(val)) {
        val = typeFormat.get(val);
      }
      obj[header] = val;
      return obj;
    }, {});
  });
};

export const csvFileToJson = (file, headerMap = null) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = csvToJson(e.target.result, ",", headerMap);
        resolve(json);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
};

export const formatEnumLabel = (value) => {
  if (value == null) return "";
  const str = String(value).trim();
  if (!str) return "";
  return str
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const getBreadCrumbRoot = (type, vendor) => {
  if (vendor === "GOOGLE_WORKSPACE") {
    if (type === "DRIVE") {
      return "My Drive";
    } else {
      return "Shared Drive";
    }
  } else if (vendor === "MICROSOFT_OFFICE_365") {
    if (type === "DRIVE") {
      return "My Files";
    } else {
      return "Sites";
    }
  } else {
    return formatEnumLabel(type);
  }
}