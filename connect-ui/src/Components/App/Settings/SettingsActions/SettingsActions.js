import { axiosRequest } from "../../../helpers/apiRequest";
import { env } from "../../../helpers/utils";

export const getUserRoles = async () => {
  let roles = await axiosRequest({
    method: "GET",
    path: "/roles",
  });
  return roles;
};

export const getDomainUsersList = async () => {
  let usersList = await axiosRequest({
    method: "GET",
    path: `/app/user-Domain/${env === "DEV"
      ? JSON.parse(localStorage?.globalState)?.user?.domain
      : window.location.host.split(".")[0]
      }`,
  });
  return usersList;
};

export const updateExistingUser = async (userBody) => {
  let updateUser = await axiosRequest({
    method: "PUT",
    path: "/app/update",
    body: userBody,
  });
  return updateUser;
};

export const deleteExistingUser = async (userBody) => {
  let deleteUser = await axiosRequest({
    method: "DELETE",
    path: "/app/remove",
    body: userBody,
  });
  return deleteUser
};

export const addRoles = async (roleBody) => {
  let res = await axiosRequest({
    method: "POST",
    path: "/settings/add/roles",
    body: roleBody,
  });
  return res
};

export const getRoles = async (roleBody) => {
  let res = await axiosRequest({
    method: "GET",
    path: "/settings/roles",
  });
  return res
};

/** Creates a long-lived client API access token (Bearer). Response: `{ token }` (optional `tokenCreatedTime`). */
export const createClientAccessToken = async () => {
  return axiosRequest({
    method: "GET",
    path: "/common/create/clientToken",
  });
};