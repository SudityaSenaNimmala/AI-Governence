import { axiosRequest } from "../../../helpers/apiRequest";
import { getDomainName, newImplementation } from "../../../helpers/utils";

export const getSaaSAppsData = async (
  vendorId,
  vendorName,
  nextToken,
  pageSize = 100,
  id
) => {
  if (
    newImplementation.includes(vendorName) &&
    vendorName !== "ENTRA_SSO" &&
    vendorName !== "OKTA"
  ) {
    let res = await axiosRequest({
      method: "GET",
      path: `/teams/shadowapps/${id}?pageNo=${nextToken}&pageSize=${pageSize}`,
    });
    return res;
  } else {
    let res = await axiosRequest({
      method: "POST",
      path: `/renewal/api/apps/${vendorId}?vendor=${vendorName}`,
      body: {
        nextPageToken: nextToken,
        pageSize: pageSize,
        count: false,
      },
    });
    return res;
  }
};

export const getSaaSGroupsPagination = async (vendorId, vendorName, id) => {
  if (newImplementation.includes(vendorName)) {
    let res = await axiosRequest({
      method: "GET",
      path: `/teams/groupDetailsinfo/${id}`,
    });
    return res;
  } else {
    let res = await axiosRequest({
      method: "POST",
      path: `/teams/groupsMatrix/${vendorId}?vendor=${vendorName}`,
      body: "",
    });
    return res;
  }
};

export const getResourceAppsPagination = async (vendorId, vendorName) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/renewal/connectAppMatrix/${vendorId}?vendor=${vendorName}`,
    body: "",
  });

  return res;
};

export const getSaaSGroupsData = async (
  vendorId,
  vendorName,
  nextToken,
  pageSize,
  teamsChannel,
  id
) => {
  if (newImplementation.includes(vendorName)) {
    let res = await axiosRequest({
      method: "GET",
      path: `/teams/groups/${id || vendorId
        }?pageNo=${nextToken}&pageSize=${pageSize}&ssoGroup=${teamsChannel?.length > 7 ? true : false}`,
    });
    return res;
  } else {
    let res = await axiosRequest({
      method: "POST",
      path: `/teams/groups/${vendorId}?vendor=${vendorName}`,
      body: {
        nextPageToken: nextToken ?? 0,
        pageSize: pageSize ?? 0,
        count: false,
        teamsChannel: teamsChannel ?? false,
      },
    });
    return res;
  }
};

export const getLicensesList = async (vendorEmail, vendorName, id) => {
  let uri = `/renewal/vendors/${vendorEmail}?vendor=${vendorName}`;
  if (
    newImplementation.includes(vendorName) ||
    vendorName === "ONE_PASSWORD" ||
    vendorName === "ADOBE_IDENTITY" ||
    vendorName === "FIGMA" ||
    vendorName === "OTHERS"
  ) {
    uri = `/license-config/subscriptions/${id}`;
  }
  let res = await axiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getLicensesListNew = async (vendorId, vendorName) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/license/vendor/${vendorName}/admin/${vendorId}`,
  });
  return res;
};

export const getLicensesUserList = async (
  vendorId,
  vendorName,
  licenseId,
  pageNo = 0,
  pageSize = 100,
  id,
  status = "ALL"
) => {
  if (newImplementation.includes(vendorName)) {
    let res = await axiosRequest({
      method: "GET",
      path: `/license-config/assignedusers/${id}/${licenseId}?pageNo=${pageNo}&pageSize=${pageSize}&status=${status}`,
    });
    return res;
  } else {
    let res = await axiosRequest({
      method: "POST",
      path: `/vendor/user/${vendorId}?vendor=${vendorName}`,
      body: {
        nextPageToken: null,
        licenseId: licenseId,
      },
    });
    return res;
  }
};

export const checkLicenseStatus = async (id) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/license-config/getcflicencedetails/${id}`,
  });
  return res;
};

export const getVendorDomains = async (vendorId, vendorName) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/teams/domains/${vendorId}?vendor=${vendorName}`,
  });
  return res;
};

export const downloadSaaSAppsReports = async (
  vendorId,
  vendorName,
  frequency,
  type
) => {
  let queryParam;
  // if (type === "USERS") {
  //   queryParam = `users=true&apps=false`;
  // } else if (type === "APPS") {
  //   queryParam = `apps=true&users=false`;
  // } else {
  //   queryParam = `teams=${type === "TEAMS"}&apps=false`;
  // }
  let res = await axiosRequest({
    method: "GET",
    path: `/teams/${vendorId}/report?vendor=${vendorName}&period=${frequency}&action=${type}&apps=true`,
  });
  return res;
};

export const getSaaSUsersList = async (
  vendorId,
  pageNo,
  pageSize,
  userType,
  activeStatus,
  providerName,
  id
) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/user/${vendorId}/users?pageNo=${pageNo}&pageSize=${pageSize}&userType=${userType}&activeStatus=${activeStatus}&vendor=${providerName}&adminCloudId=${id}`,
  });
  return res;
};

export const getSaaSUsersListCount = async (
  vendorId,
  userType,
  activeStatus,
  providerName,
  id
) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/user/${vendorId}/users/count?userType=${userType}&activeStatus=${activeStatus}&vendor=${providerName}&adminCloudId=${id}`,
  });
  return res;
};

export const getSaaSCloudStatus = async (vendorName, vendorId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/vendor/getSaasVendor?domain=${getDomainName()}&sVendorLabel=${vendorName}&memberId=${vendorId}`,
  });
  return res;
};

export const getDownloadStatus = async (vendorId, searchParam) => {
  let uri = `/common/check/downloadInfo/${vendorId}`;
  if (searchParam) {
    uri = `${uri}?query=${searchParam}`;
  }
  let res = await axiosRequest({
    method: "GET",
    // isDev: true,
    path: uri,
  });
  return res;
};

export const getDownloadSaaSReport = async (vendorId, action, vendorName = "OTHERS") => {
  let res = await axiosRequest({
    method: "GET",
    // isDev: true,
    path: `/common/generateCSV/${vendorId}/${action}?vendor=${vendorName}`,
  });
  return res;
};

export const getVendorSearch = async (
  vendorId,
  action,
  searchValue,
  teamsChannel = false,
  vendor = "ALL",
  id
) => {
  searchValue = searchValue?.trim()?.toLowerCase();
  let uri = `/common/search/${vendorId}/${action}?searchValue=${searchValue?.trim()}&teamsChannel=${teamsChannel}`;
  if (vendor) {
    uri = `${uri}&vendor=${vendor}`;
  }
  if (newImplementation.includes(vendor) && action === "teamgroups") {
    uri = `/teams/searchgroup/${id}?groupName=${searchValue?.trim()}`;
  }
  if (newImplementation.includes(vendor) && action === "apps") {
    uri = `/teams/searchshadowapp/${id}?appName=${searchValue?.trim()}`;
  }
  let res = await axiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getShadowItAppsList = async (adminMemberId, vendor) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/vendor/getNonApprovedApplications?adminMemberId=${adminMemberId}&vendor=${vendor}`,
  });
  return res;
};

export const getAssessmentsList = async (email) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/coderByte/${email}/assessments`,
  });
  return res;
};

export const getAssessmentsUsersList = async (email, assessmentId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/coderByte/${email}/assessments/${assessmentId}/users`,
  });
  return res;
};

export const inviteUsersToAssessment = async (adminEmail, body) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/coderByte/${adminEmail}/assessments/invite`,
    body: body,
  });
  return res;
};

export const saveAndUpdateLicense = async (body, providerName) => {
  let uri = `/license/save`;
  let method = "POST";
  if (
    newImplementation.includes(providerName) ||
    providerName === "ONE_PASSWORD" ||
    providerName === "ADOBE_IDENTITY" ||
    providerName === "FIGMA"
  ) {
    uri = `/license-config/updatesku`;
    method = "PUT";
  }
  let res = await axiosRequest({
    method: method,
    path: uri,
    body: body,
  });
  return res;
};

export const inviteUsersToCursor = async (body, adminCloudId) => {
  let uri = `/teams/send/invitations/${adminCloudId}`;
  let method = "POST";
  let res = await axiosRequest({
    method: method,
    path: uri,
    body: body,
  });
  return res;
};

export const addMemebersToAGroup = async (
  groupId,
  adminCloudId,
  vendorName,
  isTeams,
  usersList
) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/teams/groups/addMembers/${groupId}/${adminCloudId}?teams=${isTeams}&vendor=${vendorName}`,
    body: usersList,
  });
  return res;
};

export const removeMembersFromAGroup = async (
  groupId,
  adminCloudId,
  vendorName,
  isTeams,
  usersList
) => {
  let res = await axiosRequest({
    method: "DELETE",
    path: `/teams/groups/removeMembers/${groupId}/${adminCloudId}?teams=${isTeams}&vendor=${vendorName}`,
    body: usersList,
  });
  return res;
};

export const getAIUsageInsights = async (adminCloudId, email) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/aiusageinsights/${adminCloudId}/${email}?pageNo=1&pageSize=10`,
    // isDev: true,
  });
  return res;
};

export const getAIUsageInsight = async (adminCloudId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/aiusageinsights/${adminCloudId}?pageNo=1&pageSize=30`,
    // isDev: true,
  });
  return res;
};

export const getClaudCodeUsage = async (adminCloudId, period = "30D") => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/claudeCodeUsageRow/${adminCloudId}?period=${period}`,
    // isDev: true,
  });
  return res;
};

export const getInsightFullAppUsageInsights = async (adminCloudId, memberId, startDate, endDate) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/userAppAnalytics/${adminCloudId}?memberId=${memberId}&startDate=${startDate}&endDate=${endDate}`,
    // isDev: true,
  });
  return res;
};

export const getAIUsageInfo = async (adminCloudId, period = "6D") => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/aianalyticsinfo/${adminCloudId}?period=${period}`,
  });
  return res;
};

export const getAIUsageInfoForDashboard = async () => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/aianalyticsinfo?period=10D`,
  });
  return res;
};

export const getNewShadowAppsList = async (
  adminCloudId = null,
  searchValue = null,
  pageNo = 1,
  pageSize = 100
) => {
  let uri = `/common/shadowIT`;
  uri = `${uri}?pageNo=${pageNo}&pageSize=${pageSize}`;
  if (searchValue) {
    uri = `${uri}&searchValue=${searchValue}`;
  }
  if (adminCloudId) {
    uri = `${uri}&adminCloudId=${adminCloudId}`;
  }
  let res = await axiosRequest({
    method: "GET",
    // isDev: true,
    path: uri,
  });
  return res;
};

export const getNewShadowAppsListForUser = async (adminCloudId, memberId) => {
  let res = await axiosRequest({
    method: "GET",
    // isDev: true,
    path: `/common/shadowIT/${adminCloudId}?memberId=${memberId}`,
  });
  return res;
};

export const getShadowITUsersList = async (adminCloudId, appId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/shadowIT/userinfo?adminCloudId=${adminCloudId}&appId=${appId}`,
  });
  return res;
};

export const getBrowserActivity = async (
  pageNo = 1,
  pageSize = 100,
  email = null
) => {
  let res = await axiosRequest({
    method: "GET",
    // isDev: true,
    path: `/browserExtension/activity/list?pageNo=${pageNo}&pageSize=${pageSize}&userEmail=${email}`,
  });
  return res;
};

export const getActivityLogs = async (pageNo = 1, pageSize = 100) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/getAccessLogs?pageNo=${pageNo}&pageSize=${pageSize}`,
  });
  return res;
};

export const sendOTPForUIConfig = async (emailId) => {
  let res = await axiosRequest(
    {
      method: "POST",
      path: `/uiconfig/validate/${emailId}`,
      body: "",
    },
    "",
    true
  );
  return res;
};

export const validateOTPForUIConfig = async (emailId, otp) => {
  let res = await axiosRequest(
    {
      method: "POST",
      path: `/uiconfig/validate/${emailId}/${otp}`,
      body: "",
    },
    "",
    true
  );
  return res;
};

export const getAppConfigurationList = async () => {
  let res = await axiosRequest(
    {
      method: "GET",
      path: `/uiconfig/`,
    },
    "",
    true
  );
  return res;
};

export const saveAppConfiguration = async (body, email, headerKey) => {
  let res = await axiosRequest(
    {
      method: "PUT",
      path: `/uiconfig/update`,
      body: body,
    },
    "",
    true,
    {
      [headerKey]: email,
    }
  );
  return res;
};

export const getSaaSRolesForApplication = async (vendorName, type, adminCloudId = null) => {
  let action = ["TIME_ZONES", "REGIONS", "LANGUAGES"]

  if (action.includes(type) && vendorName === "SALESFORCE") {
    adminCloudId = vendorName;
  }

  let res = await axiosRequest({
    method: "GET",
    path: `/common/getSaaSAppsRoles/${vendorName}?type=${type}&adminCloudId=${adminCloudId}`,
  });
  return res;
};

export const uploadUsersCSVFile = async (
  fileStream,
  adminCloudId,
  isUserLevel = false
) => {
  let formData = new FormData();
  formData.append("inputStream", fileStream);
  let res = await axiosRequest({
    method: "POST",
    path: `/user/import/csv/${adminCloudId}?userlevel=${isUserLevel}`,
    body: fileStream,
    // isDev: true,
  });
  return res;
};

export const getWorkFlowByWorkflowId = async (workflowId) => {
  let res = await axiosRequest(
    {
      method: "GET",
      path: `/workflow/offboarddetails?workflowId=${workflowId}`,
    },
    "",
    false
  );
  return res;
};

export const updateWorkFlowApproval = async (workflowId, approvalStatus) => {
  let res = await axiosRequest(
    {
      method: "PUT",
      path: `/workflow/offboarddetails/update?workflowId=${workflowId}&approveStatus=${approvalStatus}`,
    },
    "",
    false
  );
  return res;
};


export const manualTriggerWorkflow = async (apiBody) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/workflow/create/manual/workflow`,
    body: apiBody,
  });
  return res;
};

export const revokeAccessForApplication = async (adminCloudId, appId, vendorName) => {
  let res = await axiosRequest({
    method: "PUT",
    path: `/vendor/revoke/shadowapp/${adminCloudId}/${appId}?vendorName=${vendorName}`,
  });
  return res;
};