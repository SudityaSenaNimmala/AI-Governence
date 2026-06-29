import { Group } from "lucide-react";
import { getRolesInternal } from "../../NewFlow/utils/workflowUtils";

export const checkForCustomRoles = async (e, currentApplication = null, commonName = null, listOfSelectedRoles = []) => {
    let mapper = `${currentApplication?.providerName}|${currentApplication?.adminCloudId}`;
    let res = await getRolesInternal(
        e.reduce((acc, res) => {
            acc.push(res?.id);
            return acc;
        }, []),
        currentApplication,
        mapper
    );
    if (res) {
        let selMap = {};
        e.forEach((rol) => {
            let rolMap = selMap[mapper] || {};
            if (rol.id === "CUSTOM_ACTION") {
                rolMap[rol?.id] = [
                    res[mapper]?.[rol?.id]?.find(
                        (res1) => res1?.id === commonName
                    ) || null,
                ];
            } else {
                rolMap[rol?.id] = [
                    res[mapper]?.[rol?.id]?.find((res1) =>
                        listOfSelectedRoles?.includes(res1?.id)
                    ) || null,
                ];
            }
            selMap[mapper] = rolMap;
        });
        return {
            userInfoMap: res,
            selectedUserInfoMap: selMap,
        };
    } else {
        return {
            userInfoMap: {},
            selectedUserInfoMap: {},
        };
    }
};

export const transformWorkFlowToJSON = (workFlowObject, workFlowId = null) => {
    let workFlowPrimaryApplications = workFlowObject?.primaryApplications?.map((application) => transformApplicationToJSON(application));

    let deptPrimaryApplications = [];
    let rolePrimaryApplications = [];
    let locationPrimaryApplications = [];
    workFlowObject?.departMentsList?.map((departMent) => {
        let currentDepartMent = workFlowObject?.departMentsMap[departMent];
        let deptApp = currentDepartMent?.primaryApplications?.map((application) => transformApplicationToJSON({ ...application, mandatory: false }));
        if (deptApp?.length > 0) {
            // deptPrimaryApplications.push(...deptApp);
            workFlowPrimaryApplications = [...deptApp];
        }
        currentDepartMent?.rolesList?.map((role) => {
            let currentRole = currentDepartMent?.rolesMap[role];
            let roleApp = currentRole?.primaryApplications?.map((application) => transformApplicationToJSON({ ...application, mandatory: application?.mandatory || true }));

            if (roleApp?.length > 0) {
                rolePrimaryApplications.push(...roleApp);
            }
            currentRole?.locationsList?.map((location) => {
                let currentLocation = currentRole?.locationsMap[location];
                let locationApp = currentLocation?.map((application) => transformApplicationToJSON(application));
                if (locationApp?.length > 0) {
                    locationPrimaryApplications.push(...locationApp);
                }
            });

        });
    })
    return {
        type: "DEPARTMENT",
        conditionValue: workFlowObject?.departMentsList[0] === "Department Not Met" ? null : workFlowObject?.departMentsList[0] || null,
        mandatoryApplications: workFlowPrimaryApplications,
        workFlowApplications: [...rolePrimaryApplications, ...locationPrimaryApplications, ...deptPrimaryApplications],
    }
}

export const transformApplicationToJSON = (application = {}, workFlowId = null) => {

    let groupsObject = application?.GROUPS?.map((group) => {
        return {
            groupName: group?.groupName,
            groupId: group?.groupId,
        }
    });
    let licensesObject = application?.LICENSES?.map((license) => {
        return {
            subscriptionName: license?.planName,
            subscriptionId: license?.id,
        }
    });

    let bdy = {
        deleted: false,
        groupIds: groupsObject,
        roles: application?.roles || [],
        usubscriptionIds: licensesObject,
        title: application?.roleName === "Title Not Met" ? null : application?.roleName || null,
        workFlowId: application?.workFlowId || null,
        commonName: application?.commonName || null,
        location: application?.mandatory && !application?.locationName ? null : application?.locationName === "Location Not Met" ? null : application?.locationName || null,
        divisionName: application?.divisionName === "Division Not Met" ? null : application?.divisionName || null,
        adminCloudId: application?.currentApplication?.id,
        mandatory: application?.mandatory || false,
        departMentName: application?.departMentName || null,
        applicationName: application?.currentApplication?.providerName,
    };

    if (application?.currentApplication?.workFlowApplicationId) {
        bdy.id = application?.currentApplication?.workFlowApplicationId;
    }

    return bdy;

}

export const transformTemplateResponseToWorkFlowJSON = (template = {}, cloudsList = [], removeExistingIds = false, metaData = null) => {
    let templateJSON = {
        primaryApplications: [],
        departMentsList: [],
        rolesList: [],
        departMentsMap: {},
        templateJSON: [],
    }

    let deptList = []
    let mandateApplication = []
    let deptMap = {}
    if (template?.conditionValue) {
        deptList.push(template?.conditionValue);

        if (template?.mandatoryApplications?.length > 0) {
            mandateApplication = template?.mandatoryApplications?.map((application) => applicationToWorkflowJSON(application, cloudsList, removeExistingIds, metaData));
        }

        deptMap[template?.conditionValue] = {
            primaryApplications: mandateApplication,
            rolesList: [],
            rolesMap: {},
        }

        let cpyRoles = [];
        let cpyRolesMap = {}
        if (template?.workFlowApplications?.length > 0) {
            template?.workFlowApplications?.map((app) => {
                // if (app?.title) {
                let title = app?.title || "Title Not Met";
                if (!cpyRoles.includes(title)) {
                    cpyRoles.push(title);
                    if (!cpyRolesMap[title]) {
                        cpyRolesMap[title] = {
                            primaryApplications: [],
                            locationsList: [],
                            locationsMap: {}
                        }
                    }
                }
                let location = app?.mandatory && !app?.location ? null : app?.location || "Location Not Met";
                if (location) {
                    if (!cpyRolesMap[title]?.locationsList?.includes(location)) {
                        cpyRolesMap[title]?.locationsList.push(location);
                    }
                    if (!cpyRolesMap[title]?.locationsMap[location]) {
                        cpyRolesMap[title].locationsMap[location] = [];
                    }
                    cpyRolesMap[title]?.locationsMap[location].push(applicationToWorkflowJSON(app, cloudsList, removeExistingIds, metaData));
                } else {
                    cpyRolesMap[title]?.primaryApplications.push(applicationToWorkflowJSON(app, cloudsList, removeExistingIds, metaData));
                }
                // } else {
                // deptMap[template?.conditionValue]?.primaryApplications.push(applicationToWorkflowJSON(app, cloudsList, removeExistingIds));
                // }

            })
        }

        deptMap[template?.conditionValue] = {
            ...deptMap[template?.conditionValue],
            rolesList: cpyRoles,
            rolesMap: cpyRolesMap,
        }
    } else {
        if (template?.mandatoryApplications?.length > 0) {
            mandateApplication = template?.mandatoryApplications?.map((application) => applicationToWorkflowJSON(application, cloudsList, removeExistingIds, metaData));
        }
        templateJSON.primaryApplications = mandateApplication;
    }
    templateJSON.departMentsList = deptList;
    templateJSON.departMentsMap = deptMap;
    return templateJSON;
}

export const applicationToWorkflowJSON = (application = {}, cloudsList = [], removeExistingIds = false, metaData = null) => {
    let currentApplication = cloudsList?.find((cloud) => cloud?.id === application?.adminCloudId);
    return {
        "action": "ONBOARD_TO_APPLICATIONS",
        currentApplication: { ...currentApplication, id: application?.adminCloudId, workFlowApplicationId: removeExistingIds ? null : application?.id, applicationName: application?.applicationName },
        title: (application?.roleName || metaData?.roleName) === null ? "Title Not Met" : application?.roleName || metaData?.roleName || null,
        locationName: application?.mandatory && !application?.location ? null : (application?.location || metaData?.locationName) === null ? "Location Not Met" : application?.location || metaData?.locationName || null,
        roleName: application?.title || metaData?.roleName || null,
        divisionName: (application?.divisionName || metaData?.divisionName) === null ? "Division Not Met" : application?.divisionName || metaData?.divisionName || null,
        deleted: currentApplication?.id ? application?.deleted || false : true,
        departMentName: application?.departMentName || metaData?.departMentName || null,
        roles: application?.roles || [],
        commonName: application?.commonName || null,
        GROUPS: application?.groupIds || [],
        workFlowId: application?.workFlowId || metaData?.workFlowId || null,
        LICENSES: application?.usubscriptionIds?.reduce((acc, license) => {
            acc.push({
                id: license?.subscriptionId,
                planName: license?.subscriptionName,
            });
            return acc;
        }, []),
    }
}

export const transforWorkFlowToEditWorkFlowJSON = (workFlowObject = {}) => {
    let workFlowPrimaryApplications = workFlowObject?.primaryApplications?.map((application) => transformApplicationToJSON(application));
    let workFlowDepartments = workFlowObject?.departMentsList?.map((department) => transformDepartmentToJSON(department));
    return {
        primaryApplications: workFlowPrimaryApplications,
        departMentsList: workFlowDepartments,
    }
}

export const transformApiWorkFlowToMasterWorkFlowData = (workflowApi = {}, cloudsList = []) => {
    const workFlowId = workflowApi?.id || null;
    const triggerCloud = cloudsList?.find((c) => c?.id === workflowApi?.adminCloudId);

    const trigger = triggerCloud
        ? {
            currentApplication: triggerCloud,
            action: "ONBOARD_TO_APPLICATIONS",
        }
        : null;

    const primaryApplications = (workflowApi?.mandatoryApplications || []).map((app) =>
        applicationToWorkflowJSON(app, cloudsList, false, { workFlowId })
    );

    let divisionDetails = workflowApi?.divisionDetails || [];
    if (workflowApi?.departMentWorkFlows?.length > 0) {
        divisionDetails.push({
            divisionName: "Division Not Met",
            conditionalWorkFlows: workflowApi?.departMentWorkFlows,
            workFlowId: workflowApi?.id || null,
        })
    }
    const ifElse = divisionDetails.length > 0;
    const divisionsList = divisionDetails.map((d) => d?.divisionName ? d?.divisionName : "Division Not Met").filter(Boolean);

    const divisionsMap = {};
    divisionDetails.forEach((division) => {
        const divisionName = division?.divisionName ? division?.divisionName : "Division Not Met";
        if (divisionName == null) return;

        const divPrimaryApps = (division?.mandatoryApplications || []).map((app) =>
            applicationToWorkflowJSON(app, cloudsList, false, { divisionName, workFlowId })
        );

        const departMentTemplatesList = (division?.conditionalWorkFlows || []).map((cw) => {
            const templateJSON = transformTemplateResponseToWorkFlowJSON(cw, cloudsList, false, {
                divisionName,
                workFlowId,
            });
            return {
                ...templateJSON,
                workFlowName: cw?.conditionValue || templateJSON?.conditionValue || "Template",
            };
        });

        divisionsMap[divisionName] = {
            primaryApplications: divPrimaryApps,
            departMentTemplatesList,
        };
    });

    return {
        trigger,
        primaryApplications,
        ifElse,
        divisionsList,
        divisionsMap,
    };
}