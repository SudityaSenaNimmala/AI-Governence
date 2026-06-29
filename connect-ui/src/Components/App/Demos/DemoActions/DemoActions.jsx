import { axiosRequest } from "../../../helpers/apiRequest";

export const getGitHubWorkspaces = async (vendorId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/github/workspaces/${vendorId}`,
  });

  return res;
};

export const getGitHubUsersList = async (
  adminCloudId,
  pageNo,
  pageSize,
  orgName = "ALL",
  providerName,
  userType = "ALL",
  activeStatus = "ALL",
  searchVal
) => {
  let uri = `/common/get/users/${adminCloudId}?orgName=${orgName}&vendor=${providerName}&pageNo=${pageNo}&pageSize=${pageSize}&userType=${userType}&activeStatus=${activeStatus}`;
  if (searchVal && searchVal?.trim() !== "") {
    uri = `${uri}&searchVal=${searchVal?.trim()}`;
  }
  let res = await axiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getDemoLicensesList = async (vendorEmail, vendorName, orgName) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/github/licenses/${vendorEmail}?orgName=${orgName}&vendor=${vendorName}`,
  });
  return res;
};

export const getDownloadTODO = async (adminCloudId, type) => {
  let uri = `/teams/todo/csv/${adminCloudId}`;
  if (type === "PLANER") {
    uri = `/teams/planner/csv/${adminCloudId}`;
  }
  if (type === "LEARNING") {
    uri = `/teams/learning/csv/${adminCloudId}`;
  }
  let res = await axiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getAssessments = async (
  adminCloudId,
  pageNo,
  pageSize,
  searchVal
) => {
  let uri = `/common/get/assessments/${adminCloudId}?pageSize=${pageSize}&pageNo=${pageNo}`;
  if (searchVal && searchVal?.trim() !== "") {
    uri = `${uri}&searchVal=${searchVal?.trim()}`;
  }
  let res = await axiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const getAssessmentCandidates = async (
  adminCloudId,
  pageNo,
  pageSize,
  assessment = "ALL",
  status = "ALL",
  searchVal,
  uniqueList = false
) => {
  let uri = `/common/get/assessment/user/${adminCloudId}?pageSize=${pageSize}&pageNo=${pageNo}&status=${status}&assessment=${assessment}&uniqueList=${uniqueList}`;
  if (searchVal && searchVal?.trim() !== "") {
    uri = `${uri}&searchVal=${searchVal?.trim()}`;
  }
  let res = await axiosRequest({
    method: "GET",
    path: uri,
  });
  return res;
};

export const inviteUsersToAssessment = async (adminCloudId, body) => {
  let uri = `/common/assessment/${adminCloudId}/invite`;
  let res = await axiosRequest({
    method: "POST",
    path: uri,
    body: body,
  });
  return res;
};

export const getBambooHRUserApps = async (email) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/common/users/${encodeURIComponent(email)}`,
  });
  return res;
};


//     private String gitMemberId;

// @GetMapping("/users/{email}")
// public ResponseEntity<?> getUserApplications(@RequestAttribute("userId") String userId,
//                                              @PathVariable("email") String email) {
//     return ResponseEntity.ok(clientServices.getUserApplications(userId, email));
// }