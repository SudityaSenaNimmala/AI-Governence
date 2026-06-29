import { axiosRequest } from "../../../helpers/apiRequest";
import { getUserId } from "../../../helpers/utils";

export const getOauthKeys = async (cloudName) => {
  let keys = await axiosRequest({
    method: "GET",
    path: `/vendor/oauthkeys/${cloudName}`,
  });
  return keys;
};

export const saveOauthCode = async (cloudName, body) => {
  body.adminCloudId = body.adminCloudId || null;
  body.subDomain = body.subDomain || null;
  body.clientSecret = body.clientSecret || null;
  body.internal = body.internal || false;
  body.identityStoreId = body.identityStoreId || null;
  // if (cloudName === "ADOBE_CREATIVE" && window.location.origin?.includes("sacontain")) {
  //   body.code = getUserId();
  // }

  // let uri = `/vendor/add/${cloudName}`;

  // if (window.location.hostname.includes("qamanage")) {
  let uri = `/vendor/integrate/apps/${cloudName}`;  
  // }

  let keys = await axiosRequest({
    method: "POST",
    path: uri,
    body: body,
  });
  return keys;
};

export const authenticateSlackUser = async (userId, adminCloudId, code) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/messagemove/users/slack/provisionuseronline/${adminCloudId}/${userId}?code=${code}`,
    body: "",
  });
  return res;
};

export const authenticateTeamsUser = async (
  clientId,
  userId,
  cloudId,
  code,
  cloudName
) => {
  let res = await axiosRequest({
    method: "POST",
    path:
      cloudName === "Teams"
        ? `/messagemove/users/microsoft/teams/provisionuseronline/${clientId}/${userId}/${cloudId}?code=${code}`
        : `/messagemove/users/viva/provisionuseronline/${cloudId}/${userId}?code=${code}`,
    body: "",
  });
  return res;
};

export const saveOauthKeys = async (body) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/oauth/add`,
    body: body,
  });
  return res;
};

export const updateSaaSVendor = async (body) => {
  let res = await axiosRequest({
    method: "PUT",
    path: `/vendor/vendor/update`,
    body: body,
  });
  return res;
};


export const saveManuallyIntegration = async (body) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/vendor/external/add`,
    body: body,
  });
  return res;
};

export const saveVendorWithInvoice = async (body, fileType) => {
  let formData = new FormData();
  formData.append("file", body);
  const path = fileType
    ? `/invoice/upload?fileType=${fileType}`
    : `/invoice/upload`;
  let res = await axiosRequest({
    method: "POST",
    path: path,
    body: formData,
  });
  return res;
};

export const updateAdminEmail = async (id, email) => {
  let res = await axiosRequest({
    method: "PUT",
    path: `/vendor/update/admin/${id}/${email}`,
  });
  return res;
};