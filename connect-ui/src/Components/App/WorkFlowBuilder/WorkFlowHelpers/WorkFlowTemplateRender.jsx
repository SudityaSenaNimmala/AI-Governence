import { Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import RenderWorkFlow from "./RenderWorkFlow";
import WorkFlowRenderAppications from "./WorkFlowRenderAppications";
import WorkFlowRenderRoles from "./WorkFlowRenderRoles";
import WorkFlowRenderLocations from "./WorkFlowRenderLocations";
import WorkFlowAddAction from "./WorkFlowAddAction";
import { transformTemplateResponseToWorkFlowJSON } from "./WorkFlowHelpers";
import { calculateWidth } from "../../NewFlow/utils/workflowUtils";

const getInitialTemplateWorkFlowData = () => ({
    primaryApplications: [],
    departMentsList: [],
    rolesList: [],
    departMentsMap: {},
    templateJSON: [],
});

const WorkFlowTemplateRender = ({
    templateUID = "DEFAULT",
    initialWorkFlowData,
    metaData,
    onWorkFlowDataChange,
    workFlowJSON,
    isWorkflowNameEditable = false,
    onWorkflowNameEditableChange,
    onWorkFlowJSONChange,
    currentDraggableElement = null,
    scale = 1,
    cloudsList = [],
    setCurrentDraggableElement,
    setIsPopupOpen,
    setEditObject,
    setSelectedRoles,
    setSelectedLocations,
    setSelectedApplicationsList,
    setCurrentAvailableOptions,
    isTemplateNameRequired = true,
    setTemplateView = () => { },
    hideWorkFlowDefaultTemplates = false,
}) => {
    const [workFlowData, setWorkFlowData] = useState(() => initialWorkFlowData ?? getInitialTemplateWorkFlowData());
    const isSyncingFromParentRef = useRef(false);
    const [isFlowVisible, setIsFlowVisible] = useState(!hideWorkFlowDefaultTemplates);
    useEffect(() => {
        if (initialWorkFlowData) {
            isSyncingFromParentRef.current = true;
            setWorkFlowData(initialWorkFlowData);
        }
    }, [initialWorkFlowData]);

    useEffect(() => {
        if (isSyncingFromParentRef.current) {
            isSyncingFromParentRef.current = false;
            return;
        }
        onWorkFlowDataChange?.(workFlowData);
    }, [workFlowData]);

    const handleAddApplicationsFromTemplate = (data, currentApplicationsList = [], newObj = null) => {
        const returnApplications = [];
        const transPrimaryAppp = transformTemplateResponseToWorkFlowJSON(data?.templateObject, cloudsList, true, { ...newObj, ...metaData });
        transPrimaryAppp?.primaryApplications?.forEach((app) => {
            if (!currentApplicationsList?.find((primaryApp) => primaryApp?.currentApplication?.id === app?.currentApplication?.id)) {
                returnApplications.push(app);
            }
        });
        return returnApplications;
    };

    const handleDrop = (e, newObj) => {
        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData("json"));

        if (data?.action === "SELECT_DEPARTMENT") {
            const cpyMap = { ...workFlowData };
            cpyMap.departMentsList.push(data?.department);
            cpyMap.departMentsMap[data?.department] = {
                primaryApplications: [],
                rolesList: [],
                rolesMap: {},
            };
            setWorkFlowData(cpyMap);
        } else if (data?.action === "ONBOARD_TO_APPLICATIONS" || data?.action === "ASSIGN_TEMPLATE") {
            const cpyMap = { ...workFlowData };
            if (newObj?.action === "LOCATION_ACTIONS") {
                let currentLocationMap = cpyMap?.departMentsMap?.[newObj?.departMentName]?.rolesMap?.[newObj?.roleName]?.locationsMap?.[newObj?.locationName];
                if (currentLocationMap) {
                    if (data?.action === "ASSIGN_TEMPLATE") {
                        const templateAppsList = handleAddApplicationsFromTemplate(data, currentLocationMap, newObj);
                        currentLocationMap = [...currentLocationMap, ...templateAppsList];
                    } else {
                        currentLocationMap.push({ ...data, locationName: newObj?.locationName, roleName: newObj?.roleName, departMentName: newObj?.departMentName, workFlowId: metaData?.workFlowId || null, divisionName: metaData?.divisionName || null });
                    }
                }
                cpyMap.departMentsMap[newObj?.departMentName].rolesMap[newObj?.roleName].locationsMap[newObj?.locationName] = currentLocationMap;
            } else if (newObj?.action === "ROLE_ACTIONS") {
                const currentRoleMap = cpyMap?.departMentsMap?.[newObj?.departMentName]?.rolesMap?.[newObj?.roleName];
                if (currentRoleMap) {
                    if (data?.action === "ASSIGN_TEMPLATE") {
                        const templateAppsList = handleAddApplicationsFromTemplate(data, currentRoleMap?.primaryApplications, newObj);
                        currentRoleMap.primaryApplications = [...currentRoleMap?.primaryApplications, ...templateAppsList];
                    } else {
                        currentRoleMap.primaryApplications.push({ ...data, roleName: newObj?.roleName, departMentName: newObj?.departMentName, workFlowId: metaData?.workFlowId || null, divisionName: metaData?.divisionName || null });
                    }
                }
                cpyMap.departMentsMap[newObj?.departMentName].rolesMap[newObj?.roleName] = currentRoleMap;
            } else if (newObj?.action === "DEPARTMENT_ACTIONS") {
                const currentDepartMentMap = cpyMap?.departMentsMap?.[newObj?.departMentName];
                if (currentDepartMentMap) {
                    if (data?.action === "ASSIGN_TEMPLATE") {
                        const templateAppsList = handleAddApplicationsFromTemplate(data, currentDepartMentMap?.primaryApplications, newObj);
                        currentDepartMentMap.primaryApplications = [...currentDepartMentMap?.primaryApplications, ...templateAppsList];
                    } else {
                        currentDepartMentMap.primaryApplications.push({ ...data, departMentName: newObj?.departMentName, workFlowId: metaData?.workFlowId || null, divisionName: metaData?.divisionName || null });
                    }
                }
                cpyMap.departMentsMap[newObj?.departMentName] = currentDepartMentMap;
            } else if (workFlowData?.departMentsList?.length === 0) {
                const cpyMap = { ...workFlowData };
                if (data?.action === "ASSIGN_TEMPLATE") {
                    const templateAppsList = handleAddApplicationsFromTemplate(data, cpyMap?.primaryApplications, newObj);
                    cpyMap.primaryApplications = [...(cpyMap?.primaryApplications || []), ...templateAppsList];
                } else {
                    cpyMap.primaryApplications.push({ ...data, workFlowId: metaData?.workFlowId || null, divisionName: metaData?.divisionName || null });
                }
                setWorkFlowData(cpyMap);
            } else {
                setWorkFlowData(cpyMap);
            }
        } else if (data?.action === "SELECT_ROLE") {
            const cpyMap = { ...workFlowData };
            const currentDepartMentMap = cpyMap?.departMentsMap?.[newObj?.departMentName];
            if (currentDepartMentMap) {
                currentDepartMentMap.rolesList.push(data?.role);
                currentDepartMentMap.rolesMap[data?.role] = {
                    primaryApplications: [],
                    locationsList: [],
                    locationsMap: {},
                };
            }
            cpyMap.departMentsMap[newObj?.departMentName] = currentDepartMentMap;
            setWorkFlowData(cpyMap);
        } else if (data?.action === "SELECT_LOCATION") {
            const cpyMap = { ...workFlowData };
            const currentRoleMap = cpyMap?.departMentsMap?.[newObj?.departMentName]?.rolesMap?.[newObj?.roleName];
            if (currentRoleMap) {
                currentRoleMap.locationsList.push(data?.location);
                currentRoleMap.locationsMap[data?.location] = [];
            }
            cpyMap.departMentsMap[newObj?.departMentName].rolesMap[newObj?.roleName] = currentRoleMap;
            setWorkFlowData(cpyMap);
        } else if (data?.action === "LOCATION_ACTIONS") {
            const cpyMap = { ...workFlowData };
            const currentRoleMap = cpyMap?.departMentsMap?.[newObj?.departMentName]?.rolesMap?.[newObj?.roleName];
            if (currentRoleMap) {
                currentRoleMap.locationsMap[newObj?.locationName].push(data);
            }
            cpyMap.departMentsMap[newObj?.departMentName].rolesMap[newObj?.roleName] = currentRoleMap;
            setWorkFlowData(cpyMap);
        }

        setCurrentDraggableElement?.(null);
        setIsPopupOpen?.(false);
    };

    const addActions = (actions) => {
        setEditObject?.(null);
        setTemplateView?.("CUSTOM");
        let selRoles = [];
        let selLocations = [];
        let selectedApps = [];
        if (actions?.roleName && actions?.departMentName && actions?.locationName) {
            selectedApps = workFlowData?.departMentsMap?.[actions?.departMentName]?.rolesMap?.[actions?.roleName]?.locationsMap?.[actions?.locationName]?.map((app) => app?.currentApplication?.id);
        } else if (actions?.roleName && actions?.departMentName) {
            selLocations = workFlowData?.departMentsMap?.[actions?.departMentName]?.rolesMap?.[actions?.roleName]?.locationsList;
            selectedApps = workFlowData?.departMentsMap?.[actions?.departMentName]?.rolesMap?.[actions?.roleName]?.primaryApplications?.map((app) => app?.currentApplication?.id);
        } else if (actions?.departMentName) {
            selRoles = workFlowData?.departMentsMap?.[actions?.departMentName]?.rolesList;
            selectedApps = workFlowData?.departMentsMap?.[actions?.departMentName]?.primaryApplications?.map((app) => app?.currentApplication?.id);
        }
        setSelectedRoles?.(selRoles);
        setSelectedLocations?.(selLocations);
        setSelectedApplicationsList?.(selectedApps);
        if (actions?.interMediatApplication) {
            setCurrentAvailableOptions?.(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
            setCurrentDraggableElement?.(actions?.customDragTitle);
            // return;
        } else if (workFlowData?.departMentsList?.length === 0) {
            if (workFlowData?.primaryApplications?.length !== 0) {
                const selectedAppsList = workFlowData?.primaryApplications?.reduce((acc, item) => {
                    acc.push(`${item?.currentApplication?.id}`);
                    return acc;
                }, []);
                setSelectedApplicationsList?.(selectedAppsList);
                setCurrentAvailableOptions?.(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
            } else {
                setCurrentAvailableOptions?.(["DEPARTMENT_BASED_ACTION", "ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
            }
            setCurrentDraggableElement?.("APPLICATION");
        } else if (actions?.departMentName) {
            if (actions?.locationName) {
                setCurrentAvailableOptions?.(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                setCurrentDraggableElement?.("LOCATION_ACTION_" + actions?.locationName);
            } else if (actions?.roleName) {
                if (workFlowData?.departMentsMap?.[actions?.departMentName]?.rolesMap?.[actions?.roleName]?.locationsList?.length > 0) {
                    setCurrentAvailableOptions?.(["LOCATION_BASED_ACTION"]);
                } else {
                    setCurrentAvailableOptions?.(["LOCATION_BASED_ACTION", "ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                }
                setCurrentDraggableElement?.("ROLE_ACTION_" + actions?.roleName);
            } else {
                if (workFlowData?.departMentsMap?.[actions?.departMentName]?.rolesList?.length > 0) {
                    setCurrentAvailableOptions?.(["ROLE_BASED_ACTION"]);
                } else {
                    setCurrentAvailableOptions?.(["ROLE_BASED_ACTION", "ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                }
                setCurrentDraggableElement?.("DEPARTMENT_ACTION_" + actions?.departMentName);
            }
        }
        setIsPopupOpen?.(true);
    };

    const handleEditObject = (res, actionType, primaryAction = "EDIT") => {
        setCurrentDraggableElement?.(null);
        if (primaryAction === "DELETE") {
            setEditObject?.(null);
        }
        if (actionType?.type === "APPLICATION") {
            if (primaryAction === "EDIT") {
                setEditObject?.({
                    res: { ...res, currentApplication: { ...res?.currentApplication, adminCloudId: res?.currentApplication?.id } },
                    actionType: actionType,
                    __templateSaveHandler: handleEditObject,
                });
                setIsPopupOpen?.(true);
                return;
            }
            const cpyMap = { ...workFlowData };
            if (actionType?.departMentName && actionType?.roleName && actionType?.locationName) {
                let appsList = cpyMap.departMentsMap[actionType?.departMentName]?.rolesMap[actionType?.roleName]?.locationsMap[actionType?.locationName];
                if (primaryAction === "SAVE") {
                    appsList?.forEach((app, index) => {
                        if (app?.currentApplication?.id === res?.currentApplication?.id) {
                            appsList[index] = res;
                        }
                    });
                } else if (primaryAction === "DELETE") {
                    appsList = appsList?.filter((app) => app?.currentApplication?.id !== res?.currentApplication?.id);
                }
                cpyMap.departMentsMap[actionType?.departMentName].rolesMap[actionType?.roleName].locationsMap[actionType?.locationName] = appsList;
            } else if (actionType?.departMentName && actionType?.roleName) {
                let appsList = cpyMap.departMentsMap[actionType?.departMentName]?.rolesMap[actionType?.roleName]?.primaryApplications;
                if (primaryAction === "SAVE") {
                    appsList?.forEach((app, index) => {
                        if (app?.currentApplication?.id === res?.currentApplication?.id) {
                            appsList[index] = res;
                        }
                    });
                } else if (primaryAction === "DELETE") {
                    appsList = appsList?.filter((app) => app?.currentApplication?.id !== res?.currentApplication?.id);
                }
                cpyMap.departMentsMap[actionType?.departMentName].rolesMap[actionType?.roleName].primaryApplications = appsList;
            } else if (actionType?.departMentName) {
                let appsList = cpyMap.departMentsMap[actionType?.departMentName]?.primaryApplications;
                if (primaryAction === "SAVE") {
                    appsList?.forEach((app, index) => {
                        if (app?.currentApplication?.id === res?.currentApplication?.id) {
                            appsList[index] = res;
                        }
                    });
                } else if (primaryAction === "DELETE") {
                    appsList = appsList?.filter((app) => app?.currentApplication?.id !== res?.currentApplication?.id);
                }
                cpyMap.departMentsMap[actionType?.departMentName].primaryApplications = appsList;
            } else {
                let appsList = cpyMap.primaryApplications;
                if (primaryAction === "SAVE") {
                    appsList?.forEach((app, index) => {
                        if (app?.currentApplication?.id === res?.currentApplication?.id) {
                            appsList[index] = res;
                        }
                    });
                } else if (primaryAction === "DELETE") {
                    appsList = appsList?.filter((app) => app?.currentApplication?.id !== res?.currentApplication?.id);
                }
                cpyMap.primaryApplications = appsList;
            }
            setWorkFlowData(cpyMap);
        } else if (actionType?.type === "LOCATION") {
            const cpyMap = { ...workFlowData };
            const currentRoleMap = cpyMap?.departMentsMap?.[actionType?.departMentName]?.rolesMap?.[actionType?.roleName];
            if (currentRoleMap) {
                currentRoleMap.locationsList = currentRoleMap.locationsList?.filter((location) => location !== actionType?.locationName);
                delete currentRoleMap.locationsMap[actionType?.locationName];
            }
            cpyMap.departMentsMap[actionType?.departMentName].rolesMap[actionType?.roleName] = currentRoleMap;
            setWorkFlowData(cpyMap);
        } else if (actionType?.type === "ROLE") {
            const cpyMap = { ...workFlowData };
            const currentDepartMentMap = cpyMap?.departMentsMap?.[actionType?.departMentName];
            if (currentDepartMentMap) {
                currentDepartMentMap.rolesList = currentDepartMentMap.rolesList?.filter((role) => role !== actionType?.roleName);
                delete currentDepartMentMap.rolesMap[actionType?.roleName];
            }
            cpyMap.departMentsMap[actionType?.departMentName] = currentDepartMentMap;
            setWorkFlowData(cpyMap);
        } else if (actionType?.type === "DEPARTMENT") {
            const cpyMap = { ...workFlowData };
            cpyMap.departMentsList = cpyMap.departMentsList?.filter((departMent) => departMent !== actionType?.departMentName);
            delete cpyMap.departMentsMap[actionType?.departMentName];
            setWorkFlowData(cpyMap);
        }
        setIsPopupOpen?.(false);
    };

    return (
        <>
            {
                isTemplateNameRequired && (
                    <div className="cf_newFlow_trigger_pannel">
                        <div className="cf_newFlow_trigger_pannel_header">
                            <div className="cf_newFlow_trigger_pannel_header_icon">
                                <Workflow size={18} />
                            </div>
                            {isWorkflowNameEditable ? (
                                <div style={{ width: "calc(100% - 100px)" }}>
                                    <TextInputUpdate
                                        defaultVal={workFlowJSON?.workFlowName}
                                        inputWidth="220px"
                                        inputHeight="40px"
                                        customActionStyles={{ top: "45px" }}
                                        closeAction={() => onWorkflowNameEditableChange?.(false)}
                                        saveAction={(value) => {
                                            onWorkFlowJSONChange?.({ ...workFlowJSON, workFlowName: value });
                                            onWorkflowNameEditableChange?.(false);
                                        }}
                                    />
                                </div>
                            ) : (
                                <p
                                    className="cf_newFlow_trigger_pannel_header_name"
                                    onClick={() => onWorkflowNameEditableChange?.(true)}
                                    style={{ cursor: "pointer", fontSize: "14px" }}
                                >
                                    {workFlowJSON?.workFlowName || "Template Name"}
                                </p>
                            )}
                        </div>
                    </div>)
            }
            {workFlowData?.primaryApplications?.map((app, index) => (
                <WorkFlowRenderAppications
                    key={`primary-app-${index}`}
                    appData={app}
                    handleEditObject={(e) =>
                        handleEditObject(e, {
                            type: "APPLICATION",
                            departMentName: null,
                            roleName: null,
                            locationName: null,
                        })
                    }
                    handleDeleteObject={(e) =>
                        handleEditObject(e, {
                            type: "APPLICATION",
                            departMentName: null,
                            roleName: null,
                            locationName: null,
                        }, "DELETE")
                    }
                    workFlowData={workFlowData}
                    setWorkFlowData={setWorkFlowData}
                />
            ))}
            {workFlowData?.departMentsList?.map((departMent, ind) => (
                <div key={`${departMent}_level`}
                    className={`CF_d-flex current_departMent_${ind + 1}`}
                    id="cf_roleLevel_container"
                    style={{
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        position: "relative",
                    }}>
                    <RenderWorkFlow
                        id={`cf_roleLevel_container_DEPARTMENT_${ind}_${templateUID}`}
                        action={departMent}
                        handleDrop={handleDrop}
                        addActions={addActions}
                        handleDelete={(e) =>
                            handleEditObject(e, {
                                type: "DEPARTMENT",
                                departMentName: departMent,
                            }, "DELETE")
                        }
                        flowVisibleActions={() => setIsFlowVisible(!isFlowVisible)}
                        isVisible={isFlowVisible}
                        type="DEPARTMENT"
                    />
                    {isFlowVisible && <>
                        {workFlowData?.departMentsMap?.[departMent]?.primaryApplications?.map((app, index) => (
                            <WorkFlowRenderAppications
                                key={`dept-${departMent}-app-${index}`}
                                appData={app}
                                handleEditObject={(e) =>
                                    handleEditObject(e, {
                                        type: "APPLICATION",
                                        departMentName: departMent,
                                    })
                                }
                                handleDeleteObject={(e) =>
                                    handleEditObject(e, {
                                        type: "APPLICATION",
                                        departMentName: departMent,
                                    }, "DELETE")
                                }
                                workFlowData={workFlowData}
                                setWorkFlowData={setWorkFlowData}
                            />
                        ))}

                        {
                            workFlowData?.departMentsMap?.[departMent]?.rolesList?.length > 0 ? <>
                                <>
                                    <WorkFlowAddAction
                                        handleDrop={(e) =>
                                            handleDrop(e, {
                                                action: "DEPARTMENT_ACTIONS",
                                                departMentName: departMent,
                                            })
                                        }
                                        addAction={() => addActions({
                                            interMediatApplication: true,
                                            departMentName: departMent,
                                            customDragTitle: "INTERMEDIATE_APPLICATION_ADD_" + departMent,
                                        })}
                                        isWaitingForDragging={currentDraggableElement === "INTERMEDIATE_APPLICATION_ADD_" + departMent}
                                    />
                                </>
                            </> : ""
                        }
                        <div
                            className={
                                workFlowData?.departMentsMap?.[departMent]?.rolesList?.length > 0
                                    ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                                    : ""
                            }
                        >
                            {workFlowData?.departMentsMap?.[departMent]?.rolesList?.length > 0 ? (
                                <div
                                    className="cf_department_based_action_container_dottedLine_role"
                                    style={{
                                        width: `calc(100% - ${calculateWidth("ROLES", scale)}px)`,
                                    }}
                                />
                            ) : null}
                            {workFlowData?.departMentsMap?.[departMent]?.rolesList?.map((role, index) => (
                                <div
                                    key={`${departMent}-${role}-${index}`}
                                    className={`CF_d-flex current_role_${index + 1}`}
                                    id="cf_roleLevel_container"
                                    style={{
                                        flexDirection: "column",
                                        justifyContent: "center",
                                        alignItems: "center",
                                        position: "relative",
                                    }}
                                >
                                    <WorkFlowRenderRoles
                                        roleData={role}
                                        handleEditObject={handleEditObject}
                                        handleDeleteObject={(e) =>
                                            handleEditObject(e, {
                                                type: "ROLE",
                                                departMentName: departMent,
                                                roleName: role,
                                            }, "DELETE")
                                        }
                                        workFlowData={workFlowData}
                                        setWorkFlowData={setWorkFlowData}
                                    />
                                    {workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.primaryApplications?.map((app, appIndex) => (
                                        <WorkFlowRenderAppications
                                            key={`role-${departMent}-${role}-app-${appIndex}`}
                                            appData={app}
                                            handleEditObject={(e) =>
                                                handleEditObject(e, {
                                                    type: "APPLICATION",
                                                    departMentName: departMent,
                                                    roleName: role,
                                                })
                                            }
                                            handleDeleteObject={(e) =>
                                                handleEditObject(e, {
                                                    type: "APPLICATION",
                                                    departMentName: departMent,
                                                    roleName: role,
                                                }, "DELETE")
                                            }
                                            workFlowData={workFlowData}
                                            setWorkFlowData={setWorkFlowData}
                                        />
                                    ))}
                                    {
                                        workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsList?.length > 0 ? <>
                                            <>
                                                <WorkFlowAddAction
                                                    handleDrop={(e) =>
                                                        handleDrop(e, {
                                                            action: "ROLE_ACTIONS",
                                                            departMentName: departMent,
                                                            roleName: role,
                                                        })
                                                    }
                                                    addAction={() => addActions({
                                                        interMediatApplication: true,
                                                        departMentName: departMent,
                                                        roleName: role,
                                                        customDragTitle: "INTERMEDIATE_APPLICATION_ADD_" + departMent + "_" + role,
                                                    })}
                                                    isWaitingForDragging={currentDraggableElement === "INTERMEDIATE_APPLICATION_ADD_" + departMent + "_" + role}
                                                />
                                            </>
                                        </> : ""
                                    }
                                    <div
                                        className={
                                            workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsList?.length > 0
                                                ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                                                : ""
                                        }
                                    >
                                        {workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsList?.length > 0 ? (
                                            <div className="cf_department_based_action_container_dottedLine_role" />
                                        ) : null}
                                        {workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsList?.map((location, ind) => (
                                            <div
                                                key={`${departMent}-${role}-${location}-${ind}`}
                                                className={`CF_d-flex current_role_${ind}`}
                                                id="cf_roleLevel_container"
                                                style={{
                                                    flexDirection: "column",
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    position: "relative",
                                                }}
                                            >
                                                <WorkFlowRenderLocations
                                                    locationData={location}
                                                    handleEditObject={handleEditObject}
                                                    handleDeleteObject={(e) =>
                                                        handleEditObject(e, {
                                                            type: "LOCATION",
                                                            departMentName: departMent,
                                                            roleName: role,
                                                            locationName: location,
                                                        }, "DELETE")
                                                    }
                                                    workFlowData={workFlowData}
                                                    setWorkFlowData={setWorkFlowData}
                                                />
                                                {workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsMap?.[location]?.length > 0
                                                    ? workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsMap?.[location]?.map((appLoca, locAppIndex) => (
                                                        <WorkFlowRenderAppications
                                                            key={`loc-${departMent}-${role}-${location}-app-${locAppIndex}`}
                                                            appData={appLoca}
                                                            handleEditObject={(e) =>
                                                                handleEditObject(e, {
                                                                    type: "APPLICATION",
                                                                    departMentName: departMent,
                                                                    roleName: role,
                                                                    locationName: location,
                                                                })
                                                            }
                                                            handleDeleteObject={(e) =>
                                                                handleEditObject(e, {
                                                                    type: "APPLICATION",
                                                                    departMentName: departMent,
                                                                    roleName: role,
                                                                    locationName: location,
                                                                }, "DELETE")
                                                            }
                                                            workFlowData={workFlowData}
                                                            setWorkFlowData={setWorkFlowData}
                                                        />
                                                    ))
                                                    : null}
                                                <WorkFlowAddAction
                                                    handleDrop={(e) =>
                                                        handleDrop(e, {
                                                            action: "LOCATION_ACTIONS",
                                                            departMentName: departMent,
                                                            roleName: role,
                                                            locationName: location,
                                                        })
                                                    }
                                                    addAction={() =>
                                                        addActions({
                                                            departMentName: departMent,
                                                            roleName: role,
                                                            locationName: location,
                                                        })
                                                    }
                                                    isWaitingForDragging={currentDraggableElement === "LOCATION_ACTION_" + location}
                                                />
                                            </div>
                                        ))}
                                        {workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsList?.length > 0 ? (
                                            <WorkFlowAddAction
                                                handleDrop={(e) =>
                                                    handleDrop(e, {
                                                        action: "ROLE_ACTIONS",
                                                        departMentName: departMent,
                                                        roleName: role,
                                                    })
                                                }
                                                addAction={() =>
                                                    addActions({
                                                        departMentName: departMent,
                                                        roleName: role,
                                                    })
                                                }
                                                isWaitingForDragging={currentDraggableElement === "ROLE_ACTION_" + role}
                                                customClass="cf_action_trigger_for_department"
                                            />
                                        ) : null}
                                    </div>
                                    {workFlowData?.departMentsMap?.[departMent]?.rolesMap?.[role]?.locationsList?.length === 0 ? (
                                        <WorkFlowAddAction
                                            handleDrop={(e) =>
                                                handleDrop(e, {
                                                    action: "ROLE_ACTIONS",
                                                    departMentName: departMent,
                                                    roleName: role,
                                                })
                                            }
                                            addAction={() =>
                                                addActions({
                                                    departMentName: departMent,
                                                    roleName: role,
                                                })
                                            }
                                            isWaitingForDragging={currentDraggableElement === "ROLE_ACTION_" + role}
                                        />
                                    ) : null}
                                </div>
                            ))}
                            {workFlowData?.departMentsMap?.[departMent]?.rolesList?.length > 0 ? (
                                <WorkFlowAddAction
                                    handleDrop={(e) =>
                                        handleDrop(e, {
                                            action: "DEPARTMENT_ACTIONS",
                                            departMentName: departMent,
                                        })
                                    }
                                    addAction={() => addActions({ departMentName: departMent })}
                                    isWaitingForDragging={currentDraggableElement === "DEPARTMENT_ACTION_" + departMent}
                                    customClass="cf_action_trigger_for_department"
                                />
                            ) : null}
                        </div>
                        {workFlowData?.departMentsMap?.[departMent]?.rolesList?.length === 0 ? (
                            <WorkFlowAddAction
                                handleDrop={(e) =>
                                    handleDrop(e, {
                                        action: "DEPARTMENT_ACTIONS",
                                        departMentName: departMent,
                                    })
                                }
                                addAction={() => addActions({ departMentName: departMent })}
                                isWaitingForDragging={currentDraggableElement === "DEPARTMENT_ACTION_" + departMent}
                            />
                        ) : null}
                    </>}
                </div>
            ))}
            {(workFlowData?.departMentsList?.length === 0 && !metaData?.workFlowId) && (
                <>
                    <WorkFlowAddAction
                        handleDrop={handleDrop}
                        addAction={addActions}
                        isWaitingForDragging={currentDraggableElement === "APPLICATION"}
                    />
                </>
            )}
        </>
    );
};

export default WorkFlowTemplateRender;
