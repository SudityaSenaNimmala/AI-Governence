import {
  getClouCombinationCode,
  getDomainName,
  getMessageUserId,
  getSelectedDestinationCloudId,
  getSelectedSourceCloudId,
  getSelectedSourceCloudName,
  getUserId,
} from "../../../../helpers/utils";
import { xAxiosRequest } from "../../../../helpers/xcRequest";

export const deleteMessaegCloud = async (cloudId) => {
  let res = await xAxiosRequest({
    method: "DELETE",
    path: `/messagemove/${getMessageUserId()}/cloud/delete/${cloudId}`,
  });
  return res;
};

export const getMessageAdminStatus = async (cloudId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/${cloudId}/list?admin=true`,
  });
  return res;
};

export const getProvisionMapping = async (
  cloudId,
  pageNo = 1,
  pageSize = 5
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/provisionmapping?adminCloudId=${cloudId}&sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}`,
  });
  return res;
};

export const getPermissionMapping = async (
  sourceCloudId,
  destinationCloudId,
  pageNo = 1,
  pageSize = 5
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/mapping/user/clouds/get/permissions?sourceCloudId=${sourceCloudId}&destCloudId=${destinationCloudId}&pageNo=${pageNo}&pageSize=${pageSize}`,
  });
  return res;
};

export const savePermissionMapping = async (pageNo = 1, pageSize = 5) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/user/clouds/save/permissions?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}`,
  });
  return res;
};

export const createProvisionMapping = async (
  sourceCloudId,
  destinationCloudId,
  pageNo = 1,
  pageSize = 5
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/create/provisionmapping?sourceAdminCloudId=${sourceCloudId}&destAdminCloudId=${destinationCloudId}&pageNo=${pageNo}&pageSize=${pageSize}`,
  });
  return res;
};

export const getSlackChannels = async (
  pageNo = 1,
  pageSize = 5,
  type = "public",
  isExistingTeam = false,
  isWorkplaceMig = false,
  isWorkplaceVivaMig = false
) => {
  let uri = `/messagemove/get/slack/channel?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}&channelType=${type}&isExistingTeam=${isExistingTeam}&isWorkplaceMig=${
    getSelectedSourceCloudName() === "FACEBOOK_WORKPLACE"
  }&isWorkplaceVivaMig=${isWorkplaceVivaMig}`;
  if (
    getClouCombinationCode() === "T2C" ||
    getClouCombinationCode() === "T2T"
  ) {
    uri = `/messagemove/get/teamslist?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}&teamType=${type}`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getTeamChannels = async (pageNo = 1, pageSize = 50, teamId) => {
  let uri = `/messagemove/get/channellist/${teamId}?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}`;

  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getPaginationCounts = async (
  isCSVMapping,
  isExistingTeam = false,
  type
) => {
  let uri = `/messagemove/get/channeldms/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&migrationType=${getClouCombinationCode()}`;
  if (isCSVMapping) {
    uri = `/messagemove/get/channelcache/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&isExistingTeam=${isExistingTeam}`;
  }

  if (
    type !== "DM" &&
    (getClouCombinationCode() === "T2C" || getClouCombinationCode() === "T2T")
  ) {
    uri = `/messagemove/get/msteams/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&isTeam=true&isChannel=false&migrationType=${getClouCombinationCode()}`;
  }

  if (type === "DM" && isCSVMapping) {
    uri = `/messagemove/get/dmscache/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`;
  }

  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getUserSalckSync = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/sync/slack/users?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getUsersSyncInfo = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/sync/slack/users/info?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getUsersPaginationCount = async (
  adminCloudId = getSelectedSourceCloudId()
) => {
  let combination = getClouCombinationCode();

  let uri = `/messagemove/get/provision/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&combination=${getClouCombinationCode()}`;
  if (combination === "S2S") {
    uri = `/messagemove/get/provision_S2S/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&adminCloudId=${adminCloudId}&combination=${getClouCombinationCode()}`;
  } else if (combination === "T2C" || combination === "T2T") {
    uri = `/messagemove/get/msteams/count?sourceAdminCloudId=${getSelectedSourceCloudId()}&isChannel=false&isTeam=true&migrationType=${getClouCombinationCode()}`;
  }

  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getUsersCSVReport = async (adminCloudId, cloudName) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/download/provisionmappinglist?adminCloudId=${adminCloudId}&cloudName=${cloudName}&sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
    body: "",
  });
  return res;
};

export const sendAuthenticateEmail = async (cloudIds, cloudName) => {
  let action = "teams";
  if (cloudName === "SLACK") {
    action = "slack";
  }
  let uri = `/messagemove/send/email/bulk/${action}?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&subDomain=${getDomainName()}`;
  if (action === "teams") {
    uri = `/messagemove/send/email/bulk/${action}?adminCloudId=${getSelectedDestinationCloudId()}&subDomain=${getDomainName()}`;
  }
  if (getClouCombinationCode() === "W2V") {
    uri = `/messagemove/send/email/bulk/viva?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&subDomain=${getDomainName()}`;
  }
  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: cloudIds,
  });
  return res;
};

export const getDms = async (pageNo = 1, pageSize = 50) => {
  let uri = `/messagemove/get/slackdms?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}&isWorkplaceMig=${
    getSelectedSourceCloudName() === "FACEBOOK_WORKPLACE"
  }&isGoogleChat=${getClouCombinationCode() === "C2C"}&channelType=`;
  if (
    getClouCombinationCode() === "T2C" ||
    getClouCombinationCode() === "T2T"
  ) {
    uri = `/messagemove/get/msteamsdms?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}&channelType=MSDMS&isExistingTeam=false`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const initiateMessageMigration = async (
  body,
  deltaMigration = false,
  jobId
) => {
  let uri = `/messagemove/create/custom?willHaveDelta=false&deltaMigration=${deltaMigration}`;
  if (jobId) {
    uri = `${uri}&jobId=${jobId}`;
  }
  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: body,
  });
  return res;
};

export const initiateMessageMigrationForExportDump = async (body) => {
  let uri = `/messagemove/exportdump/startmigration?batchId=null&deltaMigration=false&jobId=null`;
  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: body,
  });
  return res;
};

export const initiateMessageMigrationForDms = async (
  body,
  deltaMigration = false
) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/create?directOrGroupMessage=true&isDelta=${deltaMigration}&DisableQueueJob=${
      body[0]?.combination === "W2C"
    }`,
    body: body,
  });
  return res;
};

export const getMessageJobs = async (
  pageNo = 1,
  pageSize = 50,
  migrationStatus = "All",
  teamStatus = "All",
  deltaMessages = "ALL",
  combination = "S2T",
  jobName = ""
) => {
  let uri = `/messagemove/get/moveJob?page_nbr=${pageNo}&page_size=${pageSize}&migrationStatus=${migrationStatus}&teamStatus=${teamStatus}&deltaMessages=${
    deltaMessages === "Delta Message" ? "MESSAGE" : deltaMessages
  }&combination=${combination}`;
  if (jobName) {
    uri = `${uri}&jobName=${jobName?.trim()}`;
  }
  // jobName = 1 - test;
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getMessageJobWorkSpaces = async (
  pageNo = 1,
  pageSize = 50,
  jobId,
  jobType = "all",
  processStatus = "all",
  channelName = ""
) => {
  let uri = `/messagemove/list/Channelworkspaces?page_nbr=${pageNo}&page_size=${pageSize}&isAscen=false&orderField=createdTime&processStatus=${processStatus}&Jobtype=${jobType}&jobId=${jobId}`;
  if (channelName) {
    uri = `${uri}&channelName=${channelName?.trim()}`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getMessageDMReports = async (
  pageNo = 1,
  pageSize = 50,
  dmJobType = "All",
  processStatus = "All",
  deltaMessages = "All",
  dmName,
  combination = "S2T"
) => {
  let uri = `/messagemove/list/workspaces?page_nbr=${pageNo}&page_size=${pageSize}&isAscen=false&orderField=createdTime&processStatus=${processStatus}&Jobtype=${dmJobType}&s2chat=false&deltaMessages=${deltaMessages}&combination=${combination}`;

  if (dmName) {
    uri = `${uri}&dmName=${dmName?.trim()}`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const deleteExistingChannelMapping = async (channelType = "public") => {
  let uri = `/messagemove/delete/slackChannelMapping/messageMappingCache?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&channelType=${channelType}`;

  if (
    getClouCombinationCode() === "T2C" ||
    getClouCombinationCode() === "T2T"
  ) {
    uri = `/messagemove/delete/teamsChannelMapping/messageMappingCache?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&channelType=${channelType}`;
  }

  let res = await xAxiosRequest({
    method: "DELETE",
    path: uri,
  });
  return res;
};

export const deleteExistingDMsMapping = async () => {
  let res = await xAxiosRequest({
    method: "DELETE",
    path: `/messagemove/delete/slackDmMapping/messageMappingCache?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const uploadChannelsCSVFile = async (fileStream, action = "public") => {
  const formData = new FormData();
  let uri = `/messagemove/channel/path/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}`;
  if (
    getClouCombinationCode() === "T2C" ||
    getClouCombinationCode() === "T2T"
  ) {
    uri = `/messagemove/upload/channel/csv/teams?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&types=${action}`;
    formData.append("file", fileStream);
  } else if (getClouCombinationCode() === "C2C") {
    uri = `/messagemove/spaceChatToChat/path/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&types=${action}`;
    formData.append("csvFile", fileStream);
  } else {
    formData.append("csvFile", fileStream);
  }

  if (getSelectedSourceCloudName() === "FACEBOOK_WORKPLACE") {
    uri = `${uri}&groupType=${action}`;
  }

  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: formData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const uploadDMsCSVFile = async (fileStream) => {
  const formData = new FormData();

  let uri = `/messagemove/dm/path/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}`;

  if (
    getClouCombinationCode() === "T2C" ||
    getClouCombinationCode() === "T2T"
  ) {
    uri = `/messagemove/msdms/path/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}`;
    formData.append("file", fileStream);
  } else if (getClouCombinationCode() === "C2C") {
    uri = `/messagemove/spaceDms/path/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}`;
    formData.append("csvFile", fileStream);
  } else {
    formData.append("csvFile", fileStream);
  }

  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: formData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const validateMessageCSVFile = async (
  fileStream,
  isChannel = true,
  type = "public"
) => {
  const formData = new FormData();
  formData.append("csvFile", fileStream);
  let uri = `/messagemove/report/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&isChannel=${isChannel}`;

  if (
    (getClouCombinationCode() === "T2C" ||
      getClouCombinationCode() === "T2T") &&
    isChannel
  ) {
    uri = `/messagemove/report/csv/teams?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&isChannel=${isChannel}&channelType=${type}`;
  }

  if (
    (getClouCombinationCode() === "T2C" ||
      getClouCombinationCode() === "T2T") &&
    !isChannel
  ) {
    uri = `/messagemove/report/csv/msdms?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&isChannel=false`;
  }

  if (getClouCombinationCode() === "T2T") {
    uri = `/messagemove/report/valided/csv/T2T?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&isChannel=${isChannel}&channelType=${type}`;
  }

  if (getSelectedSourceCloudName() === "FACEBOOK_WORKPLACE") {
    uri = `${uri}&groupType=${type}`;
  }

  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: formData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const downloadChannelsMappingCSV = async (
  isCSVMapping = false,
  channelType = "public"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/download/channelscsvreport?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&isDownloadCache=${isCSVMapping}&channelType=${channelType}`,
  });
  return res;
};

export const syncChannels = async (cloudId = getSelectedSourceCloudId()) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/sync/slack/channel?cloudId=${cloudId}&isAdmin=true`,
  });
  return res;
};

export const syncUserChannels = async (emailId, cloudName) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/sync/usersChannelDms?emailId=${emailId}&cloudName=${getSelectedSourceCloudName()}`,
  });
  return res;
};

export const channelsSyncInfo = async (
  existingTeam = false,
  cloudId = getSelectedSourceCloudId()
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/sync/info?adminCloudId=${cloudId}&existingTeam=${existingTeam}`,
  });
  return res;
};

export const runChannelPreMigration = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/run/premigration?cloudId=${getSelectedSourceCloudId()}`,
  });
  return res;
};

export const runDMsPreMigration = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/run/premigration?channelId=dm&cloudId=${getSelectedSourceCloudId()}`,
  });
  return res;
};

export const runUserPreMigration = async (
  pageNo = 1,
  pageSize = 50,
  count = true
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/run/premigration/userDetails?cloudId=${getSelectedSourceCloudId()}&getCount=${count}&pageNo=${pageNo}&pageSize=${pageSize}`,
  });
  return res;
};

export const downloadDmsCSV = async (isDownloadCache = false) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/download/dmscsvreport?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&isDownloadCache=${isDownloadCache}`,
  });
  return res;
};

export const getReportsUserInfo = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/usersinfo`,
  });
  return res;
};

export const searchInChannels = async (
  channelType = "public",
  searchName = "",
  isUploadedCache = false,
  searchInTeams = false
) => {
  let uri = `/messagemove/autoSearchChannels?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&channelType=${channelType}&pageNo=1&pageSize=50&searchName=${searchName?.trim()}&isUploadedCache=${isUploadedCache}&searchInTeams=${searchInTeams}`;
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const searchInTeams = async (
  channelType = "public",
  searchName = "",
  isUploadedCache = false,
  searchInTeams = true
) => {
  let uri = `/messagemove/autoSearchChannels?adminCloudId=${getSelectedDestinationCloudId()}&destAdminCloudId=${getSelectedSourceCloudId()}&channelType=${channelType}&pageNo=1&pageSize=50&searchName=${searchName?.trim()}&isUploadedCache=${isUploadedCache}&searchInTeams=${searchInTeams}`;
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const searchInDms = async (searchName = "", isUploadedCache = false) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/autoSearchDms?adminCloudId=${getSelectedSourceCloudId()}&searchName=${searchName?.trim()}&isUploadedCache=${isUploadedCache}`,
  });
  return res;
};

export const deleteExistingUserMapping = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/user/clouds/delete/permissionsreport?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const downloadExistingUserMapping = async (pageSize = 500) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/user/clouds/download/permissionsreport?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageSize=${pageSize}`,
  });
  return res;
};

export const uploadUserMappingCSVFile = async (fileStream) => {
  const formData = new FormData();
  formData.append("csvFile", fileStream);
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/message/user/manualmapping/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=1&pageSize=1000`,
    body: formData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const getExistingTeamsList = async (
  teamType = "public",
  pageNo = 1,
  pageSize = 50
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/teamslist?pageNo=${pageNo}&pageSize=${pageSize}&teamType=${teamType}&adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getExistingTeamsChannels = async (
  teamId,
  pageNo = 1,
  pageSize = 50
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/channellist/${teamId}?pageNo=${pageNo}&pageSize=${pageSize}&adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getSerachMessageUserMapping = async (email) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/get/user/pair?email=${email}&sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getMessageDomainsSearchList = async (
  searchInput,
  action,
  pageNo,
  pageSize
) => {
  let path = "sourceCloudId";
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  action === "DESTINATION" ? (path = "destCloudId") : "";
  let srcCloudId = getSelectedSourceCloudId();
  let dstCloudId = getSelectedDestinationCloudId();
  if (action !== "sourceCloudId") {
    srcCloudId = dstCloudId;
    dstCloudId = getSelectedSourceCloudId();
  }
  let domainsList = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/autoSearchUsers/list/${path}?srcCloudId=${srcCloudId}&destCloudId=${dstCloudId}&pageNo=${pgNo}&pageSize=${pgSize}&searchCloudUser=${searchInput?.trim()}`,
  });
  if (domainsList?.status === "ERROR") {
    domainsList.message = "In Valid Credentials Try Again!";
    domainsList.res = [];
  } else {
    domainsList.message = "OK";
  }
  return domainsList;
};

export const getMessageDomainsSearchListUsers = async (
  searchInput,
  action,
  pageNo,
  pageSize
) => {
  let path = "sourceCloudId";
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  action === "DESTINATION" ? (path = "destCloudId") : "";
  let srcCloudId = getSelectedSourceCloudId();
  let dstCloudId = getSelectedDestinationCloudId();
  if (action !== "source") {
    srcCloudId = dstCloudId;
    dstCloudId = getSelectedSourceCloudId();
  }
  let domainsList = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/autoSearchUsers/list/sourceCloudId?srcCloudId=${srcCloudId}&destCloudId=${dstCloudId}&pageNo=${pgNo}&pageSize=${pgSize}&searchCloudUser=${searchInput?.trim()}`,
  });
  if (domainsList?.status === "ERROR") {
    domainsList.message = "In Valid Credentials Try Again!";
    domainsList.res = [];
  } else {
    domainsList.message = "OK";
  }
  return domainsList;
};

export const closeMessageTeams = async (jobId) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/close/createdteams?messageJobId=${jobId}`,
  });
  return res;
};

export const initiateDeltaJobLevel = async (body, code) => {
  let uri = `/messagemove/chat/initateDeltaBulk`;
  if (code === "T2T" || code === "S2T" || code === "C2T") {
    uri = `/messagemove/teams/initiateDeltaBulk`;
  }

  if (code === "T2C") {
    uri = `/messagemove/teamstochat/bulkDelta`;
  }
  if (code === "T2T") {
    uri = `/messagemove/teamstoteams/bulkDelta`;
  }

  let res = await xAxiosRequest({
    method: "POST",
    path: uri,
    body: body,
  });
  return res;
};

export const checkForDeltaMessages = async (
  isDirectOrGroupMessages = false,
  combination = "S2T"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/deltamessages?isDirectOrGroupMessages=${isDirectOrGroupMessages}&combination=${combination}`,
  });
  return res;
};

export const searchEmailAuthenticationUser = async (
  email,
  adminCloudId = getSelectedDestinationCloudId()
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/provision/pair?email=${email?.trim()}&adminCloudId=${adminCloudId}&sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getJobReportsPaginationCount = async (
  migrationStatus = "all",
  deltaMessages = "all",
  teamStatus = "all",
  combination = "S2T",
  messageJobName = "",
  jobType = "job",
  jobId = "undefined",
  processStatus = "all"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/movejobs/channelcache/filteredcount?jobType=${jobType}&migrationStatus=${migrationStatus}&deltaMessages=${
      deltaMessages === "Delta Message" ? "MESSAGE" : deltaMessages
    }&teamStatus=${teamStatus}&dmJobType=all&messageJobName=${messageJobName?.trim()}&jobId=${jobId}&combination=${combination}&processStatus=${processStatus}`,
  });
  return res;
};

export const getJobReportsPaginationCountDM = async (
  deltaMessages = "ALL",
  dmJobType = "All",
  processStatus = "All",
  messageJobName = "",
  combination = "S2T",
  s2chat = true
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/channelcache/filteredcount?jobType=dm&processStatus=${processStatus}&dmJobType=${dmJobType}&deltaMessages=${
      deltaMessages === "Delta Message" ? "MESSAGE" : deltaMessages
    }&messageJobName=${messageJobName?.trim()}&combination=${combination}&teamStatus=all&migrationStatus=all&migrationType=${combination}`,
  });
  return res;
};

export const getMessageReportsDetails = async (combination = "S2T") => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/initiatedChannelsDmsCount?userId=${getMessageUserId()}&combination=${combination}`,
  });
  return res;
};

export const getErrorMessages = async (status = true, jobId, workSpaceId) => {
  let uri = `/messagemove/get/error/info?status=${status}&jobId=${jobId}`;

  if (workSpaceId) {
    uri = `/messagemove/get/error/info?status=${status}&messageMoveWorkSpaceId=${workSpaceId}`;
  }

  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getChannelFiles = async (
  pageNo = 1,
  pageSize = 50,
  workspaceId
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/channelFiles?workspaceId=${workspaceId}&page_nbr=${pageNo}&page_size=${pageSize}`,
  });
  return res;
};

export const checkForMessageCheckBoxs = async (
  isDirectOrGroupMessage = false,
  combination = "S2T"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/workspace/checkbox?isDirectOrGroupMessage=${isDirectOrGroupMessage}&combination=${combination}`,
  });
  return res;
};

export const getPreMigrationChannels = async (
  pageNo = 1,
  pageSize = 50,
  messageWSId,
  cloudId = getSelectedSourceCloudId()
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/run/premigration/channeldetails?messageWSId=${messageWSId}&pageNo=${pageNo}&pageSize=${pageSize}&cloudId=${cloudId}`,
  });
  return res;
};

export const getPauseCountForWorkSpaces = async (jobId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/status/count?jobId=${jobId}`,
  });
  return res;
};

export const changeMessageWorkSpaceStatus = async (
  action,
  messageWorkSpaceId,
  type
) => {
  let uri = `/messagemove/teams/workspaces/${action}?messageWorkSpaceId=${messageWorkSpaceId}`;
  if (type === "DM") {
    uri = `/messagemove/workspaces/${action}?messageWorkSpaceId=${messageWorkSpaceId}`;
  } else if (type === "JOB") {
    uri = `/messagemove/workspaces/${action}?jobId=${messageWorkSpaceId}`;
  } else {
    uri = `/messagemove/teams/workspaces/${action}?messageWorkSpaceId=${messageWorkSpaceId}`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getExportQueues = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/exportJsonQueues?exportType=DM`,
  });
  return res;
};

export const getExportDms = async (
  pageNo = 1,
  pageSize = 50,
  sessionId = "",
  channelType = "export"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/get/slack/exportjsondms?exportType=DM&adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}&sessionId=${sessionId}&channelType=${channelType}`,
  });
  return res;
};

export const uploadDmToSpacesChunk = async (
  chunk,
  sessionId,
  chunkIndex,
  totalChunks,
  isLastChunk,
  zipFileName
) => {
  let fileFormData = new FormData();
  fileFormData.append("zipFile", chunk);
  let res = await xAxiosRequest({
    method: "POST",
    path: `/messagemove/zipFile/chunk?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&type=export&sessionId=${sessionId}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}&isLastChunk=${isLastChunk}&zipFileName=${zipFileName}`,
    body: fileFormData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const getJobLevelReport = async (jobId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/download/user/message/report?jobId=${jobId}`,
  });
  return res;
};

export const getJobLevelCustomReport = async (
  jobId,
  reportType = "ERROR",
  action = "jobId"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/download/conflict/report?reportType=${reportType}&${action}=${jobId}`,
  });
  return res;
};

export const deletePreMigration = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/remove/premigration/details`,
  });
  return res;
};

export const downloadWSReport = async (wsId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/download/messagechannelreport/${wsId}`,
  });
  return res;
};

export const downloadDMReport = async (wsId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/download/messagedmreport/${wsId}`,
  });
  return res;
};

export const downloadExportCSV = async (sessionId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/export/downloadcsv?adminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&isDownloadCache=true&sessionId=${sessionId}`,
  });
  return res;
};

export const getMatchedUsers = async (
  pageNo = 1,
  pageSize = 200,
  cloudName = "SLACK"
) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/mapping/MATCHED?userId=${getMessageUserId()}&sourceCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&pageSize=${pageSize}&pageNo=${pageNo}&cloudName=${cloudName}`,
  });
  return res;
};

export const retryErrorMessages = async (status, jobId, workSpaceId) => {
  let uri = `/messagemove/message/retry?status=${status}&jobId=${jobId}`;
  if (workSpaceId) {
    uri = `/messagemove/message/retry?status=${status}&messageMoveWorkSpaceId=${workSpaceId}`;
  }

  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const syncDMs = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/messagemove/sync/slack/dm?cloudId=${getSelectedSourceCloudId()}&isAdmin=true`,
  });
  return res;
};
