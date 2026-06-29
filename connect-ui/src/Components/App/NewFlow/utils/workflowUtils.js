import { ACTION_TYPES } from "../constants/workflowConstants.jsx";
import SalesForceLanguages from "../../../helpers/JSON/SalesForceLanguages.json";
import SalesForceRegions from "../../../helpers/JSON/SalesForceRegions.json";
import SalesForceTimeZones from "../../../helpers/JSON/SalesForceTimeZones.json";
import { getSaaSRolesForApplication } from "../../SaaSManagement/SaaSActions/SaaSActions.jsx";

export const makeApplicationsBody = (applications, manualTrigger = false) => {
    return applications?.reduce((acc, res) => {
        let bd = {
            applicationName: res?.currentApplication?.providerName,
            adminCloudId: manualTrigger ? res?.currentApplication?.adminCloudId : res?.currentApplication?.id,
            usubscriptionIds: (res["LICENSES"] || [])?.reduce((acc, license) => {
                acc.push({
                    subscriptionName: license?.planName || license?.planId,
                    subscriptionId: license?.id,
                });
                return acc;
            }, []),
            groupIds: (res["GROUPS"] || [])?.reduce((acc, group) => {
                acc.push({
                    groupName: group?.groupName,
                    groupId: group?.groupId,
                });
                return acc;
            }, []),
            roles: res?.roles || [],
            commonName: res?.commonName || null,
        }
        if (manualTrigger) {
            bd.id = res?.currentApplication?.id;
        }
        acc.push(bd);
        return acc;
    }, []);
};

export const getAvailableActions = (flowActionsList) => {
    if (flowActionsList["IF_ELSE"]) {
        return ["DIVISION_BASED_ACTION",];
    } else if (
        flowActionsList["TRIGGER"] &&
        !flowActionsList["IF_ELSE"] &&
        flowActionsList["PRIMARY_APPLICATION"]?.length > 0
    ) {
        return ["ONBOARD_TO_APPLICATIONS", "IF_ELSE"];
    } else if (flowActionsList["TRIGGER"]) {
        return ["ONBOARD_TO_APPLICATIONS", "IF_ELSE"];
    } else {
        return ["TRIGGER"];
    }
};

export const parseDropData = (dataString) => {
    try {
        return JSON.parse(dataString);
    } catch (error) {
        return null;
    }
};

export const handleDropAction = (jsonData, handleAddToFlow) => {
    if (jsonData?.action === ACTION_TYPES.TRIGGER) {
        handleAddToFlow(jsonData, ACTION_TYPES.TRIGGER);
    } else if (
        jsonData?.action === ACTION_TYPES.ONBOARD_TO_APPLICATIONS &&
        !jsonData?.currentDepartment
    ) {
        handleAddToFlow(jsonData, ACTION_TYPES.PRIMARY_APPLICATION);
    } else if (jsonData?.action === ACTION_TYPES.IF_ELSE) {
        handleAddToFlow({}, ACTION_TYPES.IF_ELSE);
    } else if (jsonData?.action === ACTION_TYPES.SELECT_DEPARTMENT) {
        handleAddToFlow(jsonData, ACTION_TYPES.DEPARTMENT_BASED_ACTION);
    } else if (jsonData?.action === ACTION_TYPES.SELECT_DIVISION) {
        handleAddToFlow(jsonData, ACTION_TYPES.DIVISION_BASED_ACTION);
    } else if (jsonData?.action === ACTION_TYPES.ASSIGN_TEMPLATE) {
        handleAddToFlow(jsonData, ACTION_TYPES.ASSIGN_TEMPLATE);
    } else if (
        jsonData?.action === ACTION_TYPES.ONBOARD_TO_APPLICATIONS &&
        jsonData?.currentDepartment
    ) {
        handleAddToFlow(jsonData, jsonData?.currentDepartment);
    }
};


export const calculateWidth = (action, scale = 1, template = null) => {
    if (action === "DIVISION") {
        const roleElement = document.getElementById("cf_roleLevel_container_DIVISION_0");
        if (roleElement) {
            const logicalWidth = roleElement.offsetWidth;

            if (logicalWidth > 300) {
                return logicalWidth / 2;
            }
        }
        return 150;
    } else if (action === "DIVISION_TEMPLATES") {
        const templateElement = document.getElementById(`cf_roleLevel_container_DEPARTMENT_0_${template}`)?.parentElement;
        if (templateElement) {
            return templateElement.offsetWidth / 2;
        }
        return 150;
    } else if (action === "ROLES") {
        const roleElement = document.getElementsByClassName("current_role_1")[0];
        if (roleElement) {
            const logicalWidth = roleElement.offsetWidth;

            if (logicalWidth > 300) {
                return logicalWidth / 2;
            }
        }
        return 150;
    } else {
        const containers = document.querySelectorAll("#cf_roleLevel_container");
        const totalContainers = containers.length;

        if (totalContainers > 1) {
            let totalWidth = 0;
            for (let i = 0; i < totalContainers; i++) {
                totalWidth += containers[i].offsetWidth;
            }
            return totalWidth / 2;
        }
        return 150;
    }
};

export const getDistanceBetweenFirstLevel3AndAddIcon = (containerSelector = null) => {
    try {
        const container = containerSelector
            ? document.querySelector(containerSelector)
            : document;

        if (!container) {
            console.warn('Container not found:', containerSelector);
            return null;
        }

        const level3Elements = container.querySelectorAll('[id^="cf_roleLevel_container_APPLICATION_"]');

        if (level3Elements.length === 0) {
            console.warn('No level 3 elements found');
            return null;
        }

        const firstLevel3Element = level3Elements[0];

        let columnContainer = firstLevel3Element.parentElement;

        while (columnContainer && columnContainer !== document.body) {
            const styles = window.getComputedStyle(columnContainer);
            if (styles.flexDirection === 'column') {
                break;
            }
            columnContainer = columnContainer.parentElement;
        }

        if (!columnContainer || columnContainer === document.body) {
            columnContainer = firstLevel3Element.parentElement;
        }

        const addIcons = columnContainer.querySelectorAll('.cf_action_trigger, .cf_action_triggerV3');

        if (addIcons.length === 0) {
            console.warn('No add icon found in the container');
            return null;
        }

        const addIcon = addIcons[addIcons.length - 1];

        const firstElementRect = firstLevel3Element.getBoundingClientRect();
        const addIconRect = addIcon.getBoundingClientRect();

        const verticalDistance = Math.abs(addIconRect.top - firstElementRect.bottom);
        const horizontalDistance = Math.abs(addIconRect.left - firstElementRect.left);
        const euclideanDistance = Math.sqrt(
            Math.pow(addIconRect.left - firstElementRect.left, 2) +
            Math.pow(addIconRect.top - firstElementRect.bottom, 2)
        );

        return {
            verticalDistance,
            horizontalDistance,
            euclideanDistance,
            firstElement: firstLevel3Element,
            addIcon: addIcon,
            firstElementBottom: firstElementRect.bottom,
            addIconTop: addIconRect.top,
            firstElementHeight: firstElementRect.height,
            addIconHeight: addIconRect.height
        };
    } catch (error) {
        console.error('Error calculating distance:', error);
        return null;
    }
};

export const getRolesInternal = async (actionsList, cloudInfo = {}, customKey = null) => {
    let userInfoMap = new Map();

    await Promise.all(actionsList.map(async (action) => {
        const cloudKey = customKey || `${cloudInfo?.providerName}|${cloudInfo?.id}`;

        let salesForceActionResponse = null;

        if (cloudInfo?.providerName === "SALESFORCE") {
            if (action === "TIMEZONE") {
                salesForceActionResponse = SalesForceTimeZones;
            } else if (action === "LANGUAGE") {
                salesForceActionResponse = SalesForceLanguages;
            } else if (action === "REGION") {
                salesForceActionResponse = SalesForceRegions;
            }
        }

        if (cloudInfo?.providerName === "TRELLO") {
            salesForceActionResponse = cloudInfo?.organizationNames?.map(res => ({
                id: res,
                roleName: res,
                roleFor: "CUSTOM_ACTION",
                customName: true,
            }));
        }

        if (salesForceActionResponse) {
            const currentData = userInfoMap.get(cloudKey) || {};
            userInfoMap.set(cloudKey, {
                ...currentData,
                [action]: salesForceActionResponse,
            });
        }

        if (action !== "CUSTOM_ACTION") {
            const res = await getSaaSRolesForApplication(cloudInfo?.providerName, action, cloudInfo?.id);
            if (res?.status === "OK") {
                const currentData = userInfoMap.get(cloudKey) || {};
                userInfoMap.set(cloudKey, {
                    ...currentData,
                    [action]: res?.res,
                });
            }
        }
    }));

    return Object.fromEntries(userInfoMap);
};
