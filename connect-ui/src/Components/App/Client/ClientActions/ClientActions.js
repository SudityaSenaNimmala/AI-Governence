import { axiosRequest } from "../../../helpers/apiRequest";

export const verifyOnboardUser = async (onBoardUserInfoId, adminCloudId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/client/onboardInfo/${onBoardUserInfoId}/${adminCloudId}/verify`,
    isDev: true,
  });
  return res;
};


export const getOnboardUserGroups = async (
  onBoardUserInfoId,
  adminCloudId,
  search = "null"
) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/client/onboardInfo/${onBoardUserInfoId}/${adminCloudId}/groups?search=${search}`,
    isDev: true,
  });
  return res;
};


export const assignGroupsToUser = async (
  onBoardUserInfoId,
  adminCloudId,
  groupsPayload
) => {
  let res = await axiosRequest({
    method: "PUT",
    path: `/client/onboardInfo/${onBoardUserInfoId}/${adminCloudId}/groups/onboard`,
    body: groupsPayload,
    isDev: true,
  });
  return res;
};
