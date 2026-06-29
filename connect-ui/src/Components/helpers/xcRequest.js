import axios, { CancelToken } from "axios";
import { env, getUserAuthToken } from "./utils";

export const xAxiosRequest = async (
  request,
  cancelToken,
  isUserAuthNotRequired
) => {
  let returnData, status, statusCode, responseHeaders;

  let baseURI = `https://cfagentgovernence.cloudfuzehost.com/cfcommon/api`;

  if (
    window.location.origin.includes("localhost") ||
    window.location.origin.includes("127.0.0.1")
  ) {
    baseURI = `https://cfagentgovernence.cloudfuzehost.com/cfcommon/api`;
    // baseURI = `http://localhost:8080/cfcommon/api`;
    // baseURI = `https://devconnect.cloudfuzehost.com/cfcommon/api`;
    // baseURI = `https://entabhinit.cloudfuzehost.com/cfcommon/api`;
  } else {
    // baseURI = `https://cfagentgovernence.cloudfuzehost.com/cfcommon/api`;
    // baseURI = `https://devconnect.cloudfuzehost.com/cfcommon/api`;
    baseURI = `${window.location.origin}/cfcommon/api`;
  }

  let token = getUserAuthToken();

  const axiosConfig = isUserAuthNotRequired
    ? {}
    : {
      headers: {
        ...(request?.customHeaders ?? { "Content-Type": "application/json" }),
        Authorization: token,
      },
      cancelToken: cancelToken,
    };
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
      const res = await axios.delete(`${baseURI}${request?.path}`, axiosConfig);
      status = "OK";
      returnData = res?.data;
      statusCode = res?.status;
      responseHeaders = res?.headers;
    }

    if (returnData === "Error processing request") {
      returnData = [];
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
