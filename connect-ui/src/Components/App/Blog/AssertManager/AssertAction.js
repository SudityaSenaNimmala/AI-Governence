import { axiosRequest } from "../../../helpers/apiRequest";

const getApiBaseUrl = () => {
  if (
    window.location.origin.includes("localhost") ||
    window.location.origin.includes("127.0.0.1")
  ) {
    // return "http://localhost:8080/cfcommon/";
    return `https://cloudfuzehost.com/cfcommon/`;
  }
  // return `${window.location.origin}/cfcommon/`;
  return `https://cloudfuzehost.com/cfcommon/`;
};

export const getS3Folders = async () => {
  let res = await axiosRequest({
    method: "GET",
    path: "/blogs/asserts/folders",
    // isDev: true,
  });
  const data = Array.isArray(res?.res) ? res.res : [];
  return {
    status: res?.status ?? "ERROR",
    res: res?.status === "OK" ? data : res?.res,
    statusCode: res?.statusCode,
  };
};

export const getS3Files = async (prefix) => {
  if (!prefix) return { status: "OK", res: [] };
  let res = await axiosRequest({
    method: "GET",
    path: `/blogs/asserts/files?prefix=${encodeURIComponent(prefix)}`,
    // isDev: true,
  });
  const data = Array.isArray(res?.res) ? res.res : [];
  return {
    status: res?.status ?? "ERROR",
    res: res?.status === "OK" ? data : res?.res,
    statusCode: res?.statusCode,
  };
};

export const getS3ImageUrl = (path) => {
  if (!path) return null;
  const encoded = path;
  return `${getApiBaseUrl()}api/blogs/asserts/${encoded}`;
};

export const uploadS3File = async (file, folder) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);
  let res = await axiosRequest({
    method: "POST",
    path: "/blogs/asserts/upload",
    body: formData,
    // isDev: true,
  });
  return {
    status: res?.status ?? "ERROR",
    res: res?.res,
    statusCode: res?.statusCode,
  };
};

export const getBlogPost = async (postId) => {
  let res = await axiosRequest({
    method: "GET",
    path: `/blogs/post/${postId}`,
    // isDev: true,
  });
  return res;
};

export const listBlogPosts = async () => {
  let res = await axiosRequest({
    method: "GET",
    path: "/blogs/list",
    // isDev: true,
  });
  return res;
};

export const saveBlogPost = async (body) => {
  let res = await axiosRequest({
    method: "POST",
    path: `/blogs/post`,
    body: body,
    // isDev: true,
  });
  return res;
};