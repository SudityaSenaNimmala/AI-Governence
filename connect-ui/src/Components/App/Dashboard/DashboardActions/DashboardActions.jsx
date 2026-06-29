import { axiosRequest } from "../../../helpers/apiRequest";
import { getDomainName, getUserId } from "../../../helpers/utils";

export const getTeamsGroupsSummary = async (vendorId, vendorName) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/teams/groups/${vendorId}?vendor=${vendorName}`,
    body: {
      nextPageToken: null,
      teams: null,
      count: true,
    },
  });
  return res;
};

export const fetchLicensedData = async (memberId, vendorName) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/domainlicense/getalllicensevendor?adminMemberId=${memberId}&userId=${getUserId()}&domain=${getDomainName()}&vendorName=${vendorName}`,
  });
  return res;
};

export const getAppsSummary = async (vendorId, vendorName) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/renewal/api/apps/${vendorId}?vendor=${vendorName}`,
    body: {
      nextPageToken: null,
      count: true,
    },
  });
  return res;
};

export const getSaaSCosting = async () => {
  let res = await axiosRequest({
    method: "GET",
    path: `/vendor/get-all-cloud-cost/`,
  });
  return res;
};

export const getSaaSCostingWithAppList = async () => {
  let res = await axiosRequest({
    method: "GET",
    path: `/vendor/list/usermetrics`,
  });
  return res;
};

export const getUniqueUsersList = async (
  pageNo = 1,
  PageSize = 100,
  vendor = "ALL"
) => {
  let res = await axiosRequest({
    method: "GET",
    // isDev: true,
    path: `/common/users/list?pageNo=${pageNo}&pageSize=${PageSize}&vendor=${vendor}`,
  });
  return res;
};

export const getLicenseSubscriptionsByEmail = async (emailId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/license-config/${emailId}/subscriptions`,
  });
  return res;
};

export const putLicenseConfigLicenses = async (body) => {
  let res = await axiosRequest({
    method: "PUT",
    path: `/license-config/licenses`,
    body,
  });
  return res;
};

export const updateCostPerLicense = async (
  memberId,
  vendorName,
  costPerLicense,
  totalLicense
) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/license-metrics/calculate?memberId=${memberId}&vendorName=${vendorName}&costPerLicense=${costPerLicense}&totalLicense=${totalLicense}`,
    body: "",
  });
  return res;
};

export const getOptimizationSuggestion = async () => {
  let res = await axiosRequest({
    method: "GET",
    path: `/license-metrics/optimization-suggestions`,
  });
  return res;
};

export const updateDomainLicense = async (body) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/domainlicense/addDomainLicense`,
    body: body,
  });
  return res;
};

export const fetchGroupWithEmail = async (adminCloudId, email) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/teams/get/group/${adminCloudId}/${email}`,
  });
  return res;
};