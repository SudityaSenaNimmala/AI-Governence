import axios from "axios";
import { getUserAuthToken } from "./utils";

/** Resolves the same base URL used by {@link axiosRequest} (for docs, cURL, etc.). */
export const getCfApiBaseUri = (request = {}) => {
  let baseURI;
  if (
    window.location.origin.includes("localhost") ||
    window.location.origin.includes("127.0.0.1")
  ) {
    baseURI = `https://cfagentgovernence.cloudfuzehost.com/cfcommon/api`;
    if (request?.isDev) {
      baseURI = `http://localhost:8080/cfcommon/api`;
    }
  } else if (window.location.host?.includes("blogs") || window.location.host?.includes("sacontain")) {
    baseURI = `https://cfagentgovernence.cloudfuzehost.com/cfcommon/api`;
  } else {
    baseURI = `${window.location.origin}/cfcommon/api`;
  }
  return baseURI;
};

export const axiosRequest = async (
  request,
  cancelToken,
  isUserAuthNotRequired,
  customHeaders,
  customContentType
) => {
  let returnData, status, statusCode, responseHeaders;
  const baseURI = getCfApiBaseUri(request);


  const axiosConfig = isUserAuthNotRequired
    ? customHeaders ? Object?.keys(customHeaders)?.length > 0 ? { headers: customHeaders } : {}
      : {} : {
      headers: {
        Authorization: localStorage?.bToken ?? getUserAuthToken(),
      },
      cancelToken: cancelToken,
    };

  if (Object?.keys(customHeaders || {})?.length > 0 && customHeaders?.["departmentName"]) {
    axiosConfig.headers = {
      ...axiosConfig.headers,
      ...customHeaders,
    };
  }

  if (customContentType) {
    axiosConfig.headers["Content-Type"] = customContentType;
  }
  try {
    if (request?.method === "GET") {
      const res = await axios.get(`${baseURI}${request?.path}`, axiosConfig);
      status = "OK";
      returnData = res?.data;
      statusCode = res?.status;
      responseHeaders = res?.headers;
    } else if (request?.method === "POST") {
      const res = await axios.post(
        `${baseURI}${request?.path}`,
        request?.body,
        axiosConfig
      );
      status = "OK";
      returnData = res?.data;
      statusCode = res?.status;
      responseHeaders = res?.headers;
    } else if (request?.method === "PUT") {
      const res = await axios.put(
        `${baseURI}${request?.path}`,
        request?.body,
        axiosConfig
      );
      status = "OK";
      returnData = res?.data;
      statusCode = res?.status;
      responseHeaders = res?.headers;
    } else if (request?.method === "DELETE") {
      if (request?.body) {
        axiosConfig.data = request?.body;
      }
      const res = await axios.delete(`${baseURI}${request?.path}`, axiosConfig);
      status = "OK";
      returnData = res?.data;
      statusCode = res?.status;
      responseHeaders = res?.headers;
    }
    return {
      status: status,
      res: returnData,
      statusCode: statusCode,
      headers: responseHeaders,
    };
  } catch (err) {
    if (axios.isCancel(err)) {
    } else {
      status = "ERROR";
      statusCode = err.response?.status;
      responseHeaders = err?.headers;

      if (statusCode === 503 || statusCode === 403) {
        return axiosResponseHandler(err);
      } else if (statusCode !== 404 && statusCode !== 204) {
        // notifyToast("error", "Failed to get response");
      }
      returnData = err?.response?.data;

      return {
        status: status,
        res: returnData,
        statusCode: statusCode,
        headers: responseHeaders,
      };
    }
  }
};
