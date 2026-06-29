import {
  getContentUserId,
  getSelectedDestinationCloudId,
  getSelectedSourceCloudId,
  getUserAuthToken,
} from "../../../../helpers/utils";
import { xAxiosRequest } from "../../../../helpers/xcRequest";

let baseURI = `https://cloudfuzehost.com/cfcommon/api`;

if (
  window.location.origin.includes("localhost") ||
  window.location.origin.includes("127.0.0.1")
) {
  baseURI = `https://cloudfuzehost.com/cfcommon/api`;
  baseURI = `http://localhost:8080/cfcommon/api`;

  // baseURI = `https://entabhinit.cloudfuzehost.com/cfcommon/api`;
} else {
  // baseURI = `https://cloudfuzehost.com/cfcommon/api`;
  baseURI = `${window.location.origin}/cfcommon/api`;
}

export const getDomainsList = async (pageNo, pageSize, action) => {
  let path = "sourceCloudId";
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  action === "DESTINATION" ? (path = "destCloudId") : "";

  let domainsList = await xAxiosRequest({
    method: "GET",
    path: `/migration/domain/duplicate/list/${path}?srcCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=${pgNo}&pageSize=${pgSize}`,
  });
  if (domainsList?.status === "ERROR") {
    domainsList.message = "In Valid Credentials Try Again!";
    domainsList.res = [];
  } else {
    domainsList.message = "OK";
  }
  return domainsList;
};

export const getDomainsSearchList = async (
  searchInput,
  action,
  pageNo,
  pageSize
) => {
  let path = "sourceCloudId";
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  action === "DESTINATION" ? (path = "destCloudId") : "";

  let domainsList = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/user/autoSearchUsers/list/${path}?srcCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=${pgNo}&pageSize=${pgSize}&searchCloudUser=${searchInput}`,
  });
  if (domainsList?.status === "ERROR") {
    domainsList.message = "In Valid Credentials Try Again!";
    domainsList.res = [];
  } else {
    domainsList.message = "OK";
  }
  return domainsList;
};

export const getSearchUserByDomain = async (
  searchInput,
  action,
  pageNo,
  pageSize
) => {
  let path = "sourceCloudId";
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  action === "DESTINATION" ? (path = "destCloudId") : "";
  let domainsList = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/user/searchUsers/list/${path}?srcCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=${pgNo}&pageSize=${pgSize}&searchCloudUser=${searchInput?.trim()}`,
  });
  if (domainsList?.status === "ERROR") {
    domainsList.message = "In Valid Credentials Try Again!";
    domainsList.res = [];
  } else {
    domainsList.message = "OK";
  }
  return domainsList;
};

export const getDomainUsersList = async (
  pageNo,
  pageSize,
  action,
  domainName
) => {
  let path = "sourceCloudId";
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  action === "DESTINATION" ? (path = "destCloudId") : "";
  let domainUsersList = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/user/users/list/${path}?srcAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&domainName=${domainName}&pageNo=${pgNo}&pageSize=${pgSize}`,
  });
  if (domainUsersList?.status === "ERROR") {
    domainUsersList.res = [];
  }
  return domainUsersList;
};

export const getUserFoldersList = async (
  userCloudId,
  folderId,
  pageNo,
  pageSize
) => {
  let pgNo = pageNo ?? 1;
  let pgSize = pageSize ?? 50;
  let domainUsersList = await xAxiosRequest({
    method: "GET",
    path: `/migration/filefolder/userId/${getContentUserId()}/cloud/${userCloudId}?pageNbr=${pgNo}&pageSize=${pgSize}&folderId=${folderId}`,
  });
  if (domainUsersList?.status === "ERROR") {
    domainUsersList.res = [];
  }
  return domainUsersList;
};

export const saveMappings = async () => {
  let obj = localStorage?.globalState
    ? JSON.parse(localStorage?.globalState)
    : {};
  let source = obj?.mappingSource[0];
  let destination = obj?.mappingDestination[0];
  let domainUsersList = await xAxiosRequest({
    method: "POST",
    path: `/migration/mapping/user/unmapped/list?sourceCloudId=${
      source?.sourceCloudId
    }&destCloudId=${destination?.destCloudId}&sourcePath=${encodeURIComponent(
      source?.sourcePath
    )}&destPath=${encodeURIComponent(
      destination?.destPath
    )}&sourceFolderId=${encodeURIComponent(
      source?.sourceFolderId
    )}&destFolderId=${encodeURIComponent(
      destination?.destFolderId
    )}&isFolder=true`,
    body: "",
  });
  return domainUsersList;
};

export const getMappingCacheList = async (
  pageNo,
  pageSize,
  matchBy,
  sortBy
) => {
  let uri = `/migration/mapping/user/cache/list?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}`;
  if (sortBy) {
    uri = `${uri}&sortBy=${sortBy}&matchBy=${
      matchBy === "all" ? "" : matchBy
    }&orderBy=ASC`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const createPermissionMapping = async () => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/mapping/permissiondetiails/${getSelectedSourceCloudId()}/${getSelectedDestinationCloudId()}`,
    body: "",
  });
  return res;
};

export const getPermissionMappingStatus = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/get/permissiondetiails/${getSelectedSourceCloudId()}/${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getPermissionMapping = async (
  pageNo,
  pageSize,
  sortBy,
  matchBy
) => {
  let uri = `/migration/mapping/user/clouds/get/permissions?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=${pageNo}&pageSize=${pageSize}`;
  if (sortBy) {
    uri = `${uri}&sortBy=${sortBy}&matchBy=${matchBy === "all" ? "" : matchBy}`;
  }
  let res = await xAxiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const updatePermissions = async (srcUserCloudId, dstnUserCloudId) => {
  let res = await xAxiosRequest({
    method: "PUT",
    path: `/migration/user/permission/update?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}&sourceCloudId=${srcUserCloudId}&destCloudId=${dstnUserCloudId}`,
    body: "",
  });
  return res;
};

export const searchPermissions = async (keyWord) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/user/autosearch/permission/list?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&searchMapp=${keyWord}&pageNo=1&pageSize=50&sortBy=sourceCloud&orderBy=ASC`,
  });
  return res;
};

export const deleteExistingMappings = async () => {
  let res = await xAxiosRequest({
    method: "DELETE",
    path: `/migration/mapping/deleteAll/mapplist?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  if (JSON.parse(localStorage.globalState)?.csvId) {
    let csvRemove = await deleteCSVMapping(
      JSON.parse(localStorage.globalState)?.csvId
    );
  }
  return res;
};

export const deleteCSVMapping = async (csvId) => {
  let csvDeleteRes = await xAxiosRequest({
    method: "DELETE",
    path: `/migration/mapping/delete/csvmappcache/${csvId}`,
  });
  return csvDeleteRes;
};

export const uploadCsvFile = async (fileStream) => {
  const formData = new FormData();
  formData.append("file", fileStream);
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/mapping/path/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=1&pageSize=20`,
    body: formData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const uploadPerMissionsCsvFile = async (fileStream) => {
  const formData = new FormData();
  formData.append("file", fileStream);
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/mapping/user/manualmapping/csv?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=1&pageSize=1000`,
    body: formData,
    customHeaders: { "Content-Type": "multipart/form-data" },
  });
  return res;
};

export const doAutoMap = async () => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/mapping/user/clouds/list?sourceCloudId=${getSelectedSourceCloudId()}&destCloudId=${getSelectedDestinationCloudId()}&pageNo=1&pageSize=5`,
    body: "",
  });
  return res;
};

export const checkMultiUserPair = async (body) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/move/multiuser/verify/${getContentUserId()}`,
    body: body,
  });
  return res;
};

export const createJob = async (mappingList) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/move/newmultiuser/create/job`,
    body: mappingList,
  });
  return res;
};

export const updateJob = async (jobId, params) => {
  let res = await xAxiosRequest({
    method: "PUT",
    path: `/migration/move/newmultiuser/update/${jobId}?toDate=undefined-undefined-&fromDate=&createdTimeForFiles=false&modifiedTimeForFiles=true&${params}`,
    body: "",
  });
  return res;
};

export const updateRestrictions = async (jobId, updateBody) => {
  let res = await xAxiosRequest({
    method: "PUT",
    path: `/migration/move/newmultiuser/update/restriction/${jobId}`,
    body: updateBody,
  });
  return res;
};

export const getPreViewDetails = async (jobId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/move/newmultiuser/preview/${jobId}?pageNo=1&pageSize=10`,
  });
  return res;
};

export const initiateMigration = async (jobId) => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/move/newmultiuser/create/${jobId}`,
    body: "",
  });
  return res;
};

export const getJobsList = async (pageNo, pageSize) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/move/newmultiuser/get/moveJob?page_nbr=${pageNo}&page_size=${pageSize}&matchBy=All&oneTimeJobs=false`,
  });
  return res;
};

export const getJobsWorkSpacesList = async (jobId, pageNo, pageSize) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/move/newmultiuser/get/list/${jobId}?page_nbr=${pageNo}&page_size=${pageSize}`,
  });
  return res;
};

export const getWorkspacesFileFolderCount = async (wsId) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/move/filefolderinfo/moveworkspacefilefoldercount?workspaceId=${wsId}`,
  });
  return res;
};

export const getWorkspacesFileFolderList = async (wsId, pageNo = 1) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/move/filefolderinfo/movereport?workspaceId=${wsId}&page_nbr=${pageNo}&status=all`,
  });
  return res;
};

export const downloadSampleCSV = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/download/samplecsv?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const downloadMappedCSV = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/download/userMapping?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const downloadPermissionMappingCSV = async () => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/mapping/download/permissionMapping?sourceAdminCloudId=${getSelectedSourceCloudId()}&destAdminCloudId=${getSelectedDestinationCloudId()}`,
  });
  return res;
};

export const getReportsFileFolderAggregates = async () => {
  let res = await xAxiosRequest({
    method: "POST",
    path: `/migration/dashboard/aggregation/filefolders`,
    body: {
      userId: getContentUserId(),
    },
  });
  return res;
};

export const changeMigrationStatus = async (wsId, status) => {
  let res = await xAxiosRequest({
    method: "GET",
    path: `/migration/move/pauseresume/workspaceId?workSpaceId=${wsId}&status=${status}&userId=${getContentUserId()}`,
  });
  return res;
};

export const downloadContentJobLevelReport = async (jobId) => {
  let res = await fetch(
    `${baseURI}/migration/mapping/download/workSpaceReportsByJob/${jobId}`,
    {
      method: "GET",
      headers: {
        Authorization: getUserAuthToken(),
      },
    }
  );

  return res;
};
