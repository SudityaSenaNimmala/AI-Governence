import { axiosRequest } from "../../../helpers/apiRequest";

export const getOnBoardUsersList = async (pageNo = 1, pageSize = 50) => {
    let res = await axiosRequest({
        method: "GET",
        path: `/user/onBoard?pageNo=${pageNo}&pageSize=${pageSize}`,
    });
    return res;
};

export const deleteOnBoardUserWithId = async (userId) => {
    let res = await axiosRequest({
        method: "DELETE",
        path: `/user/onBoard/delete/${userId}`,
    });
    return res;
};

export const saveOnBoardingUser = async (userObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/user/onBoard`,
        body: userObj,
    });
    return res;
};

export const onBoardToCloud = async (userObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/user/onBoard/runFlow`,
        body: userObj,
    });
    return res;
};

export const offBoardUser = async (userObj, permanently = false) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/user/offBoard/runFlow?permDelete=${permanently}`,
        body: userObj,
    });
    return res;
};

export const runBulkOnBoard = async (userObj) => {
    let res = await axiosRequest({
        method: "POST",
        // isDev: true,
        path: `/user/onBoard/users/runFlow`,
        body: userObj,
    });
    return res;
};

export const getWorkFlows = async (withSkus = false, searchVal = "") => {
    let res = await axiosRequest({
        method: "GET",
        path: `/workflow/get/workflows`,
        // path: `/workflow/onboard?withSkus=${withSkus}&searchVal=${searchVal}`,
        // isDev: true,
    });
    return res;
};

export const createWorkFlow = async (workFlowObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/workflow/onboard/create`,
        body: workFlowObj,
        // isDev: true,
    });
    return res;
};

export const updateWorkFlow = async (workFlowObj) => {
    let res = await axiosRequest({
        method: "PUT",
        path: `/workflow/update`,
        body: workFlowObj,
        // isDev: true,
    });
    return res;
};

export const deleteWorkFlow = async (workFlowId, isOffboardingWorkflow = false) => {
    let res = await axiosRequest({
        method: "DELETE",
        path: workFlowId?.includes("_TEMPLATE") ? `/workflow/delete/templete/${workFlowId?.split("_TEMPLATE")[0]}` : `/workflow/delete/${workFlowId}?isOffboardingWorkflow=${isOffboardingWorkflow}`,
    });
    return res;
};

export const saveNewWorkFlow = async (workFlowObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/workflow/create/workflow`,
        body: workFlowObj,
        // isDev: true,
    });
    return res;
};

export const configureFormWorkFlow = async (body) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/workflow/configureForm`,
        body,
    });
    return res;
};

export const updateFormWorkFlowId = async (formId, workFlowId) => {
    let res = await axiosRequest({
        method: "PUT",
        path: `/workflow/updateFormWorkFlow/${formId}/${workFlowId}`,
    });
    return res;
};

export const saveOffBoardWorkFlow = async (workFlowObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/workflow/create/offboardworkflow`,
        body: workFlowObj,
        // isDev: true,
    });
    return res;
};

export const saveOffBoardWorkFlowManual = async (workFlowObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/workflow/create/workflow`,
        body: workFlowObj,
        // isDev: true,
    });
    return res;
};

export const saveTemplateWorkFlow = async (workFlowObj) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/workflow/create/conditionalWorkFlows`,
        body: workFlowObj,
        // isDev: true,
    });
    return res;
};

export const getNotificationsList = async (pageNo = 1, pageSize = 10) => {
    let res = await axiosRequest({
        method: "GET",
        path: `/workflow/get/notifications?pageNumber=${pageNo}&pageSize=${pageSize}`,
    });
    return res;
}

export const markNotificationAsDone = async (id, isAll = false) => {
    let uri = `/workflow/update/notifications?notificationId=${id}&markreadAll=false`;
    if (isAll) {
        uri = `/workflow/update/notifications?markreadAll=${isAll}`;
    }
    let res = await axiosRequest({
        method: "PUT",
        path: uri,
    });
    return res;
}

export const getWorkFlowHistory = async (workFlowId, type = "ONBOARD") => {
    let res = await axiosRequest({
        method: "GET",
        path: type === "ONBOARD" ? `/workflow/get/workflowsdetails/${workFlowId}` : `/workflow/get/offboarddetails/${workFlowId}`,
    });
    return res;
}

export const getTemplatesList = async () => {
    let res = await axiosRequest({
        method: "GET",
        path: `/workflow/get/conditionalWorkFlows`,
    });
    return res;
}

export const getOffBoardWorkFlowHistory = async (workFlowId, type = "NORMAL") => {
    let res = await axiosRequest({
        method: "GET",
        path: type === "NORMAL" ? `/workflow/get/onboarddetails/${workFlowId}` : `/workflow/offBoardApps/${workFlowId}`,
    });
    return res;
}

export const getDepartMentCategoryList = async (appId) => {
    let res = await axiosRequest({
        method: "GET",
        path: `/user/apps/roles/${appId}`,
    });
    return res;
}


export const getUsersByDepartment = async (adminCloudId, departments, pageNo = 1, pageSize = 100) => {
    // if (dept?.toLowerCase() === "others") {
    //     dept = null;
    // }
    let res = await axiosRequest({
        method: "POST",
        path: `/user/users/${adminCloudId}?pageNo=${pageNo}&pageSize=${pageSize}`,
        body: departments,
    });
    return res;
}

export const getUsersApplicationsByEmail = async (email) => {
    let res = await axiosRequest({
        method: "GET",
        path: `/user/users/apps/${email}`,
    });
    return res;
}

export const updatePrimaryApplication = async (adminCloudId) => {
    let res = await axiosRequest({
        method: "PUT",
        path: `/vendor/update/primaryapp/${adminCloudId}`,
    });
    return res;
}

export const saveOrgChartTemplate = async (body) => {
    let res = await axiosRequest({
        method: "POST",
        path: `/common/create/orgchart`,
        body: body,
    });
    return res;
}

export const getOrgChart = async () => {
    let res = await axiosRequest({
        method: "GET",
        path: `/common/orgchart`,
    });
    return res;
}