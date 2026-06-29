import axios from "axios";
let returnData, status, statusCode, responseHeaders;
let baseURI;

if (
    window.location.origin.includes("localhost") ||
    window.location.origin.includes("127.0.0.1")
) {
    baseURI = `https://cfagentgovernence.cloudfuzehost.com/cfcommon/api`;
} else {
    baseURI = `${window.location.origin}/cfcommon/api`;
}

export const EventAPIRequest = async (request) => {
    let returnData, status, statusCode, responseHeaders;
    try {

        const res = await axios.get(
            `${baseURI}${request?.path}`
        );
        status = "OK";
        returnData = res?.data;
        statusCode = res?.status;
        responseHeaders = res?.headers;
    } catch (err) {
        status = "ERROR";
        statusCode = err.response?.status;
        responseHeaders = err?.headers;
    }

    return {
        status: status,
        res: returnData,
        statusCode: statusCode,
        headers: responseHeaders,
    };
}