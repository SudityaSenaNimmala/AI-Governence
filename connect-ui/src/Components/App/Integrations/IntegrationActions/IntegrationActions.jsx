import { axiosRequest } from "../../../helpers/apiRequest";
import { newImplementation } from "../../../helpers/utils";

export const deleteVendor = async (vendorId, vendorName, id) => {
  let uri = `/vendor/remove?memberId=${vendorId}&vendor=${vendorName}`;
  // if (newImplementation.includes(vendorName)) {
  uri += `&adminCloudId=${id}`;
  // }
  let res = axiosRequest({
    method: "DELETE",
    path: uri,
  });
  return res;
};

export const saveApiKey = async (vendorId, vendorName, apiKey) => {
  let res = axiosRequest({
    method: "POST",
    path: `/teams/updateApikey/${vendorId}?vendor=${vendorName}&apiKey=${apiKey}`,
    body: "",
  });
  return res;
};

export const integrateSSOApp = async (app, ssoProvider) => {
  // let uri = `/vendor/add/saasvendor`;
  // if (ssoProvider === "OKTA") {
  // }
  let uri = `/vendor/add/ssoapp`;
  let res = axiosRequest({
    method: "POST",
    path: uri,
    body: app,
  });
  return res;
};
