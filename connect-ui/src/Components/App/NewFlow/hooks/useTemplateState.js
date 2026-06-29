import { useState, useCallback } from "react";

export const useTemplateState = () => {
    const [templateState, setTemplateState] = useState({
        dataMap: {},
        workFlowJSONMap: {},
        currentRole: {},
        currentLocation: {},
        waitingForDragging: {},
        enableOptionsList: {},
        selectedApplicationList: {},
    });

    const getTemplateKey = useCallback((templateId, divisionName = null) => {
        return divisionName ? `${divisionName}_${templateId}` : templateId;
    }, []);

    const deleteTemplateKey = useCallback((key) => {
        let cptWorkFlowJSONMap = { ...templateState.workFlowJSONMap };
        delete cptWorkFlowJSONMap[key];
        setTemplateState((prev) => ({
            ...prev,
            workFlowJSONMap: cptWorkFlowJSONMap,
        }));
    }, []);

    const getWorkFlowJSON = useCallback((key) => {
        return templateState.workFlowJSONMap[key];
    }, [templateState.workFlowJSONMap]);

    const setWorkFlowJSON = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            workFlowJSONMap: {
                ...prev.workFlowJSONMap,
                [key]: value,
            },
        }));
    }, []);

    const updateWorkFlowJSON = useCallback((key, updater) => {
        setTemplateState((prev) => ({
            ...prev,
            workFlowJSONMap: {
                ...prev.workFlowJSONMap,
                [key]: typeof updater === "function"
                    ? updater(prev.workFlowJSONMap[key])
                    : updater,
            },
        }));
    }, []);

    const getCurrentRole = useCallback((key) => {
        return templateState.currentRole[key];
    }, [templateState.currentRole]);

    const setCurrentRole = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            currentRole: {
                ...prev.currentRole,
                [key]: value,
            },
        }));
    }, []);

    const getCurrentLocation = useCallback((key) => {
        return templateState.currentLocation[key];
    }, [templateState.currentLocation]);

    const setCurrentLocation = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            currentLocation: {
                ...prev.currentLocation,
                [key]: value,
            },
        }));
    }, []);

    const getWaitingForDragging = useCallback((key) => {
        return templateState.waitingForDragging[key];
    }, [templateState.waitingForDragging]);

    const setWaitingForDragging = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            waitingForDragging: {
                ...prev.waitingForDragging,
                [key]: value,
            },
        }));
    }, []);

    const getEnableOptionsList = useCallback((key) => {
        return templateState.enableOptionsList[key] || [];
    }, [templateState.enableOptionsList]);

    const setEnableOptionsList = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            enableOptionsList: {
                ...prev.enableOptionsList,
                [key]: value,
            },
        }));
    }, []);

    const getSelectedApplicationList = useCallback((key) => {
        return templateState.selectedApplicationList[key] || [];
    }, [templateState.selectedApplicationList]);

    const setSelectedApplicationList = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            selectedApplicationList: {
                ...prev.selectedApplicationList,
                [key]: value,
            },
        }));
    }, []);

    const getDataMap = useCallback((key) => {
        return templateState.dataMap[key];
    }, [templateState.dataMap]);

    const setDataMap = useCallback((key, value) => {
        setTemplateState((prev) => ({
            ...prev,
            dataMap: {
                ...prev.dataMap,
                [key]: value,
            },
        }));
    }, []);

    const deleteTemplate = useCallback((key) => {
        setTemplateState((prev) => {
            const newState = { ...prev };
            Object.keys(newState).forEach((stateKey) => {
                if (newState[stateKey][key] !== undefined) {
                    const { [key]: deleted, ...rest } = newState[stateKey];
                    newState[stateKey] = rest;
                }
            });
            return newState;
        });
    }, []);

    const clearAll = useCallback(() => {
        setTemplateState({
            dataMap: {},
            workFlowJSONMap: {},
            currentRole: {},
            currentLocation: {},
            waitingForDragging: {},
            enableOptionsList: {},
            selectedApplicationList: {},
        });
    }, []);

    return {
        templateState,
        getTemplateKey,
        getWorkFlowJSON,
        setWorkFlowJSON,
        updateWorkFlowJSON,
        getCurrentRole,
        setCurrentRole,
        getCurrentLocation,
        setCurrentLocation,
        getWaitingForDragging,
        setWaitingForDragging,
        getEnableOptionsList,
        setEnableOptionsList,
        getSelectedApplicationList,
        setSelectedApplicationList,
        getDataMap,
        setDataMap,
        deleteTemplate,
        clearAll,
        deleteTemplateKey,
    };
};

