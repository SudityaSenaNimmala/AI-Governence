import { axiosRequest } from "../../helpers/apiRequest";

export const getAIHubData = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/performance-metrics",
    });
    return res;
};

export const getAIHubFeatures = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/features",
    });
    return res;
};

export const getAIHubSARTrend = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/sar-trend",
    });
    return res;
};

export const getAIHubUsageTrend = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/usage-trend",
    });
    return res;
};

export const getAIHubCPVTrend = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/cpv-trend",
    });
    return res;
};

export const getAIHubDepartments = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/departments",
    });
    return res;
};

export const getAIHubDailyUsagePattern = async () => {
    const res = await axiosRequest({
        method: "GET",
        path: "/copilot/adoption/daily-usage-pattern",
    });
    return res;
};