import { ChevronUp, GitFork, Maximize, Minus, Plus, Workflow } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { notifyToast, zoomToFit } from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import { getSaaSRolesForApplication } from "../SaaSManagement/SaaSActions/SaaSActions";
import WorkFlowActionPannel from "./WorkFlowHelpers/WorkFlowActionPannel";
import WorkFlowTemplateRender from "./WorkFlowHelpers/WorkFlowTemplateRender";
import { getTemplatesList, getWorkFlows, saveNewWorkFlow, saveTemplateWorkFlow } from "../UserManagement/UserManagementActions/UserManagementActions";
import { transformApplicationToJSON, transformApiWorkFlowToMasterWorkFlowData, transformTemplateResponseToWorkFlowJSON, transformWorkFlowToJSON } from "./WorkFlowHelpers/WorkFlowHelpers";
import WorkFlowRenderAppications from "./WorkFlowHelpers/WorkFlowRenderAppications";
import ActionPanel from "../NewFlow/components/ActionPanel";
import WorkFlowAddAction from "./WorkFlowHelpers/WorkFlowAddAction";
import WorkFlowRenderDivisions from "./WorkFlowHelpers/WorkFlowRenderDivisions";
import { calculateWidth } from "../NewFlow/utils/workflowUtils";
const WorkFlowBuilder = ({
}) => {
    const [workFlowJSON, setWorkFlowJSON] = useState({
        workFlowName: "Custom Template",
        actions: [],
        rolesList: [],
    });
    const navigate = useNavigate();
    const [queryParams] = useSearchParams();
    const templateId = queryParams.get("templateId");
    const { globalContext } = useContext(GlobalContext);
    const action = queryParams.get("action");
    const workFlowId = queryParams.get("workFlowId")
    const { cloudsList } = globalContext;
    const [templateView, setTemplateView] = useState("ALL");
    const [isWorkFlowBuilding, setIsWorkFlowBuilding] = useState(false);
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [currentDraggableElement, setCurrentDraggableElement] = useState(null);
    const [currentAvailableOptions, setCurrentAvailableOptions] = useState([]);
    const [isWorkflowNameEditable, setIsWorkflowNameEditable] = useState(false);
    const [selectedApplicationsList, setSelectedApplicationsList] = useState([]);
    const [editObject, setEditObject] = useState(null);
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [selectedRoles, setSelectedRoles] = useState([]);
    const [templatesList, setTemplatesList] = useState([]);
    const [selectedDivisionsList, setSelectedDivisionsList] = useState([]);
    const [selectedDeptList, setSelectedDeptList] = useState([]);
    const [createdWorkFlow, setCreatedWorkFlow] = useState(null);
    const [selectedTemplatesList, setSelectedTemplatesList] = useState([]);
    const [actionsList, setActionsList] = useState({
        titles: [],
        locations: [],
        divisions: [],
        departMents: [],
    });
    const containerRef = useRef(null);
    const [scale, setScale] = useState(1);
    const innerRef = useRef(null);
    const position = useRef({ x: 0, y: 0 });
    const dragStart = useRef({ x: 0, y: 0 });
    const isDragging = useRef(false);

    const [masterWorkFlowData, setMasterWorkFlowData] = useState({
        trigger: null,
        primaryApplications: [],
        ifElse: false,
        divisionsList: [],
        divisionsMap: {}
    });

    const templateWorkFlowDataRef = useRef({
        primaryApplications: [],
        departMentsList: [],
        rolesList: [],
        departMentsMap: {},
        templateJSON: [],
    });
    const [initialTemplateData, setInitialTemplateData] = useState(null);

    const getConfigurations = async (applicationName, adminCloudId) => {
        let res = await getSaaSRolesForApplication(applicationName, null, adminCloudId);
        if (res?.status === "OK") {
            let list = res?.res[0]?.departMents || {};
            list = Object.keys(list);
            setActionsList({
                titles: [...(res?.res[0]?.titles || []), "Title Not Met"],
                locations: [...(res?.res[0]?.locations || []), "Location Not Met"],
                divisions: [...(res?.res[0]?.divisions || []), "Division Not Met"],
                departMents: [...(list || []), "Department Not Met"],
            });
        }
    };

    useEffect(() => {
        const handleEscapeKey = (event) => {
            if (event.key === "Escape" && isPopupOpen) {
                event.preventDefault();
                event.stopPropagation();
                setEditObject(null);
                setIsPopupOpen(false);
                setCurrentDraggableElement(null);
            }
        };

        if (isPopupOpen) {
            window.addEventListener("keydown", handleEscapeKey);
        }

        return () => {
            window.removeEventListener("keydown", handleEscapeKey);
        };
    }, [isPopupOpen]);

    useEffect(() => {
        if (cloudsList?.length > 0) {
            setIsWorkFlowBuilding(action === "workflow");
            if (action === "workflow" && workFlowId) {
                fetchEditWorkFlow();
            }
            let app = cloudsList?.find((cloud) => cloud?.primaryApp);
            if (app) {
                if (action === "workflow") {
                    setMasterWorkFlowData((prev) => ({
                        ...prev,
                        trigger: {
                            currentApplication: app,
                            action: "ONBOARD_TO_APPLICATIONS",
                        },
                    }));
                }
                getConfigurations(app?.providerName, app?.id);
            } else {
                setActionsList({
                    titles: [],
                    locations: [],
                    divisions: [],
                });
            }
            fetchTemplates();
        }
    }, [cloudsList]);


    const fetchEditWorkFlow = async () => {
        setIsPageLoading(true);
        let res = await getWorkFlows();
        if (res?.status === "OK") {
            const workflow = res?.res?.onBoardWorkFlowList?.find((data) => data?.id === workFlowId);
            if (workflow && cloudsList?.length > 0) {
                setCreatedWorkFlow(workflow);
                setMasterWorkFlowData(transformApiWorkFlowToMasterWorkFlowData(workflow, cloudsList));
            }
            setIsPageLoading(false);
        } else {
            setIsPageLoading(false);
        }
    };


    const onWheelZoom = (e) => {
        const zoomIntensity = 0.001;
        const next = Math.min(Math.max(scale - e.deltaY * zoomIntensity, 0.3), 2);
        setScale(next);
        innerRef.current.style.transform = `translate(${position.current.x}px, ${position.current.y}px) scale(${next})`;
    };

    const onMouseDown = (e) => {
        isDragging.current = true;
        dragStart.current = {
            x: e.clientX - position.current.x,
            y: e.clientY - position.current.y,
        };
    };

    const onMouseMove = (e) => {
        if (!isDragging.current) return;

        position.current = {
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y,
        };

        requestAnimationFrame(() => {
            innerRef.current.style.transform = `translate(${position.current.x}px, ${position.current.y}px) scale(${scale})`;
        });
    };

    const stopDrag = () => {
        isDragging.current = false;
    };

    const resetZoom = () => {
        const { x, y, scale } = zoomToFit(containerRef, innerRef);
        position.current = { x: x, y: y };
        setScale(scale);
        innerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        setScale(scale);
    };

    const handleDrop = (e, newObj) => {
        e.preventDefault();
        const data = JSON.parse(e.dataTransfer.getData("json"));
        if (newObj?.for === "WORKFLOW") {
            const cpyMap = { ...masterWorkFlowData };
            if (newObj?.action === "DIVISION_ACTIONS") {
                if (data?.action === "ONBOARD_TO_APPLICATIONS") {
                    cpyMap.divisionsMap[newObj?.divisionName]?.primaryApplications?.push(data);
                } else if (data?.action === "ASSIGN_TEMPLATE") {
                    if (data?.templateObject?.conditionValue) {
                        const wflJSON = transformTemplateResponseToWorkFlowJSON(data?.templateObject, cloudsList, true, { divisionName: newObj?.divisionName, workFlowId: createdWorkFlow?.id || null });
                        const templateWithName = {
                            ...wflJSON,
                            workFlowName: wflJSON?.conditionValue || "Template",
                        };
                        cpyMap.divisionsMap = { ...cpyMap.divisionsMap };
                        cpyMap.divisionsMap[newObj?.divisionName] = {
                            ...cpyMap.divisionsMap[newObj?.divisionName],
                            departMentTemplatesList: [
                                ...(cpyMap.divisionsMap[newObj?.divisionName]?.departMentTemplatesList || []),
                                templateWithName,
                            ],
                        };
                    } else {
                        const templateAppsList = handleAddApplicationsFromTemplate(data, cpyMap?.divisionsMap?.[newObj?.divisionName]?.primaryApplications, newObj);
                        cpyMap.divisionsMap[newObj?.divisionName].primaryApplications = [...(cpyMap?.divisionsMap?.[newObj?.divisionName]?.primaryApplications || []), ...templateAppsList];
                    }
                }
            } else if (!masterWorkFlowData?.trigger) {
                cpyMap.trigger = data;
            } else if (data?.action === "IF_ELSE") {
                cpyMap.ifElse = true;
            } else if (masterWorkFlowData?.trigger && (!masterWorkFlowData?.ifElse || newObj?.isInterMediateApplication)) {
                if (data?.action === "ASSIGN_TEMPLATE") {
                    const templateAppsList = handleAddApplicationsFromTemplate(data, cpyMap?.primaryApplications, newObj);
                    cpyMap.primaryApplications = [...(cpyMap?.primaryApplications || []), ...templateAppsList];
                } else {
                    cpyMap.primaryApplications.push(data);
                }
            } else if (data?.action === "SELECT_DIVISION") {
                cpyMap.divisionsList.push(data?.division);
                cpyMap.divisionsMap[data?.division] = {
                    primaryApplications: [],
                    departMentTemplatesList: []
                };
            }
            setMasterWorkFlowData(cpyMap);
        }
        setCurrentDraggableElement(null);
        setIsPopupOpen(false);
    };

    const handleAddApplicationsFromTemplate = (data, currentApplicationsList = [], newObj = null) => {
        const returnApplications = [];
        const transPrimaryAppp = transformTemplateResponseToWorkFlowJSON(data?.templateObject, cloudsList, true, newObj);
        transPrimaryAppp?.primaryApplications?.forEach((app) => {
            if (!currentApplicationsList?.find((primaryApp) => primaryApp?.currentApplication?.id === app?.currentApplication?.id)) {
                returnApplications.push(app);
            }
        });
        return returnApplications;
    };

    const hasValidWorkFlowData = () => {
        if (masterWorkFlowData?.primaryApplications?.length > 0) return true;
        if (isWorkFlowBuilding) {
            if (masterWorkFlowData?.divisionsList?.length > 0) return true;
            return false;
        } else {
            let workFlowData = templateWorkFlowDataRef.current;
            if (templateId) {
                workFlowData = initialTemplateData;
            }
            if (workFlowData?.primaryApplications?.length > 0) return true;
            if (workFlowData?.departMentsList?.length > 0) return true;
            return false;
        }
    };

    const saveTemplate = async () => {
        let conditionalVaues = [];
        let conditionalMap = {};
        let departMentWorkFlows = []
        if (isWorkFlowBuilding) {
            setIsPageLoading(true);
            let listOfDivisions = masterWorkFlowData?.divisionsList;
            listOfDivisions?.map((division) => {
                conditionalMap[division] = {
                    divisionName: division === "Division Not Met" ? null : division,
                    conditionalWorkFlows: [],
                    workFlowId: createdWorkFlow?.id || null,
                    mandatoryApplications: [],
                };
                let pmApp = [];
                masterWorkFlowData?.divisionsMap?.[division]?.primaryApplications?.map((app) => {
                    pmApp.push(transformApplicationToJSON({ ...app, mandatory: false, workFlowId: createdWorkFlow?.id || null }));
                })
                conditionalMap[division].mandatoryApplications = pmApp;
                masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.map((template) => {
                    let temp = transformWorkFlowToJSON(template);
                    console.log(temp);
                    if (conditionalMap[division]) {
                        if (conditionalMap[division]) {
                            conditionalMap[division].conditionalWorkFlows.push(temp);
                        }
                    }
                    conditionalVaues.push({ ...temp, divisionName: division === "Division Not Met" ? null : division, workflowId: createdWorkFlow?.id || null });
                })
            })

            let cpyCreatedWorkFlow = { ...createdWorkFlow };
            let primApps = [];

            masterWorkFlowData?.primaryApplications?.map((app) => {
                primApps.push(transformApplicationToJSON({ ...app, workFlowId: createdWorkFlow?.id || null }));
            })

            if (conditionalMap["Division Not Met"]) {
                departMentWorkFlows = conditionalMap["Division Not Met"].conditionalWorkFlows;
                delete conditionalMap["Division Not Met"];
            }

            cpyCreatedWorkFlow.divisionDetails = Object.values(conditionalMap);
            cpyCreatedWorkFlow.departMentWorkFlows = departMentWorkFlows;
            cpyCreatedWorkFlow.mandatoryApplications = primApps;
            cpyCreatedWorkFlow.delete = false;
            cpyCreatedWorkFlow.active = true;
            cpyCreatedWorkFlow.enable = true;
            cpyCreatedWorkFlow.manual = false;
            cpyCreatedWorkFlow.recurring = true;

            let res = await saveNewWorkFlow(cpyCreatedWorkFlow);
            if (res?.status === "OK") {
                notifyToast("success", "Workflow saved successfully");
                navigate("/Workflow/Template");
            } else {
                notifyToast("error", res?.res);
            }
        } else {
            setIsPageLoading(true);
            let workFlowData = templateWorkFlowDataRef.current;
            if (workFlowData?.departMentsList?.length === 0) {
                if (templateId && (workFlowData?.primaryApplications?.length === 0)) {
                    workFlowData = initialTemplateData;
                }
            }
            let workFlowJSONBody = transformWorkFlowToJSON(workFlowData);
            if (workFlowJSONBody?.mandatoryApplications?.length > 0 && workFlowJSONBody?.workFlowApplications?.length === 0) {
                workFlowJSONBody.divisionName = null;
                workFlowJSONBody.templetName = workFlowJSON?.workFlowName;
                workFlowJSONBody.workflowId = null;
                if (workFlowJSON?.templetName) {
                    setIsWorkflowNameEditable(true);
                    notifyToast("warn", "Please provide name for the template")
                    return;
                }
            }
            workFlowJSONBody.deleted = false;
            if (templateId) {
                workFlowJSONBody.id = templateId;
            }
            if (workFlowJSONBody?.conditionValue) {
                workFlowJSONBody.templetName = null;
            }
            let res = await saveTemplateWorkFlow(workFlowJSONBody);
            if (res?.status === "OK") {
                if (templateId) {
                    notifyToast("success", "Template updated successfully");
                } else {
                    notifyToast("success", "Template saved successfully");
                }
                navigate("/Workflow/Template#Templates");
            } else {
                notifyToast("error", res?.res);
            }
        }
        setIsPageLoading(false);
    };

    const addActions = (actions) => {
        setEditObject(null);
        setSelectedDivisionsList(masterWorkFlowData?.divisionsList);

        let selectedApps = [];
        let selectedTemplates = [];
        if (actions?.divisionName) {
            selectedApps = masterWorkFlowData?.divisionsMap?.[actions?.divisionName]?.primaryApplications?.map((app) => app?.currentApplication?.id);
        } else {
            selectedApps = masterWorkFlowData?.primaryApplications?.map((app) => app?.currentApplication?.id);
        }

        if (actions?.divisionName) {
            selectedTemplates = masterWorkFlowData?.divisionsMap?.[actions?.divisionName]?.departMentTemplatesList?.reduce((acc, res) => {
                acc.push(res?.departMentsList[0]);
                return acc;
            }, []);
        }

        setSelectedTemplatesList(selectedTemplates);
        setSelectedApplicationsList(selectedApps);

        if (isWorkFlowBuilding && actions?.for === "WORKFLOW") {
            if (actions?.isInterMediateApplication) {
                setCurrentAvailableOptions(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                if (actions?.divisionName) {
                    setCurrentDraggableElement("APPLICATION_" + actions?.divisionName);
                } else {
                    setCurrentDraggableElement("APPLICATION_INTERMEDIAT");
                }
                setTemplateView("CUSTOM");
            } else if (actions?.action === "DIVISION_ACTIONS") {
                if (actions?.divisionName === "Division Not Met") {
                    setCurrentAvailableOptions(["EXISTING_TEMPLATE"]);
                    setCurrentDraggableElement("DIVISION_ACTION_" + actions?.divisionName);
                    setTemplateView("ONLY_TEMPLATE");
                } else if (actions?.divisionName) {
                    if (masterWorkFlowData?.divisionsMap?.[actions?.divisionName]?.departMentTemplatesList?.length) {
                        setCurrentAvailableOptions(["EXISTING_TEMPLATE"]);
                        setCurrentDraggableElement("DIVISION_ACTION_" + actions?.divisionName);
                        setTemplateView("ONLY_TEMPLATE");
                    } else {
                        setCurrentAvailableOptions(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                        setCurrentDraggableElement("DIVISION_ACTION_" + actions?.divisionName);
                        setTemplateView("ALL");
                    }
                } else {
                    setCurrentAvailableOptions(["DIVISION_BASED_ACTION"]);
                    setCurrentDraggableElement("DIVISION_ACTION_" + actions?.divisionName);
                }
            } else if (masterWorkFlowData?.ifElse && masterWorkFlowData?.trigger) {
                setCurrentAvailableOptions(["DIVISION_BASED_ACTION"]);
                setCurrentDraggableElement("APPLICATION");
            } else if (masterWorkFlowData?.trigger) {
                setCurrentAvailableOptions(["ONBOARD_TO_APPLICATIONS", "IF_ELSE", "EXISTING_TEMPLATE"]);
                setTemplateView("CUSTOM");
                setCurrentDraggableElement("APPLICATION");
            } else if (!masterWorkFlowData?.trigger) {
                setCurrentAvailableOptions(["TRIGGER"]);
                setCurrentDraggableElement("APPLICATION");
            }
            setIsPopupOpen(true);
        }
    }

    const handleEditObject = (res, actionType, primaryAction = "EDIT") => {
        setCurrentDraggableElement(null);
        if (primaryAction === "DELETE") {
            setEditObject(null);
        }
        if (actionType?.for === "WORKFLOW" && actionType?.type !== "APPLICATION") {
            if (actionType?.type === "DIVISION") {
                const cpyMap = { ...masterWorkFlowData };
                cpyMap.divisionsList = cpyMap.divisionsList?.filter((division) => division !== actionType?.divisionName);
                delete cpyMap.divisionsMap[actionType?.divisionName];
                setMasterWorkFlowData(cpyMap);
            }
        } else if (actionType?.type === "APPLICATION" && actionType?.workFlowAction) {
            if (primaryAction === "EDIT") {
                setSelectedApplicationsList([]);
                setIsPopupOpen(true);
                setEditObject({
                    res: { ...res, currentApplication: { ...res?.currentApplication, adminCloudId: res?.currentApplication?.id } },
                    actionType: actionType
                });
                return;
            }
            const cpyMap = { ...masterWorkFlowData };
            if (primaryAction === "SAVE") {
                if (actionType?.divisionName) {
                    cpyMap.divisionsMap[actionType?.divisionName].primaryApplications = cpyMap.divisionsMap[actionType?.divisionName]?.primaryApplications?.map((app) =>
                        app?.currentApplication?.id === res?.currentApplication?.id ? res : app
                    );
                } else {
                    cpyMap.primaryApplications = cpyMap.primaryApplications?.map((app) =>
                        app?.currentApplication?.id === res?.currentApplication?.id ? res : app
                    );
                }
            } else if (primaryAction === "DELETE") {
                if (actionType?.divisionName) {
                    cpyMap.divisionsMap[actionType?.divisionName].primaryApplications = cpyMap.divisionsMap[actionType?.divisionName]?.primaryApplications?.filter((app) => app?.currentApplication?.id !== res?.currentApplication?.id);
                } else {
                    cpyMap.primaryApplications = cpyMap.primaryApplications?.filter((app) => app?.currentApplication?.id !== res?.currentApplication?.id);
                }
            }
            setMasterWorkFlowData(cpyMap);
        }
        setIsPopupOpen(false);
    }

    const handleDeleteObject = (res) => {
        console.log(res);
    }

    useEffect(() => {
        if (masterWorkFlowData?.ifElse) {
            shadowSaveWorkFlow();
        }
    }, [masterWorkFlowData])

    const shadowSaveWorkFlow = async () => {
        if (createdWorkFlow?.id) {
            return;
        }
        let apiBody = {
            adminCloudId: masterWorkFlowData?.trigger?.currentApplication?.id,
            providerName: masterWorkFlowData?.trigger?.currentApplication?.providerName,
            delete: true,
            active: false,
            manual: false,
            recurring: true,
            workFlowName: "ONBOARD",
        }
        setIsPageLoading(true);
        let res = await saveNewWorkFlow(apiBody);
        if (res?.status === "OK") {
            setCreatedWorkFlow(res?.res);
            setIsPageLoading(false);
        } else {
            setIsPageLoading(false);
        }
    }

    const fetchTemplates = async () => {
        setIsPageLoading(true);
        const res = await getTemplatesList();
        if (res?.status === "OK") {
            setTemplatesList(res?.res || []);
            let deptList = [];
            res?.res?.map(template => {
                if (template?.conditionValue) {
                    deptList.push(template?.conditionValue);
                }
                if (template?.id === templateId) {
                    const wflJSON = transformTemplateResponseToWorkFlowJSON(template, cloudsList);
                    setInitialTemplateData(wflJSON);
                    setWorkFlowJSON({
                        ...wflJSON,
                        workFlowName: template?.templetName,
                    });
                }
            })
            setSelectedDeptList(deptList);
            setIsPageLoading(false);
        } else {
            setIsPageLoading(false);
        }
    };


    const renderCanvas = () => {
        return (
            <div
                className={"cf_main_content_place_main CF_d-flex"}
                style={{
                    padding: "10px 0",
                    gap: "15px",
                    position: "relative",
                }}
            >
                <div
                    className="cf_newFlow_canvas_newFlowV3"
                    onWheel={onWheelZoom}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={stopDrag}
                    onMouseLeave={stopDrag}
                    style={{
                        width: isPopupOpen ? "calc(100% - 30%)" : "100%",
                        cursor: isDragging.current ? "grabbing" : "grab",
                    }}
                >
                    <div
                        className="CF_d-flex cf_newFlow_canvas_action"
                        ref={innerRef}
                        style={{
                            willChange: "transform",
                            justifyContent: "center",
                            flexDirection: "column",
                            alignItems: "center",
                            marginTop: "30px",
                            transform: `translate(${position.current.x}px, ${position.current.y}px) scale(${scale})`,
                            transformOrigin: "0 0",
                            transition: isDragging.current ? "none" : "transform 0.1s",
                            userSelect: "none",
                        }}
                    >
                        {
                            isWorkFlowBuilding ?
                                <>
                                    <div className="cf_newFlow_trigger_pannel">
                                        <div className="cf_newFlow_trigger_pannel_header">
                                            <div className="cf_newFlow_trigger_pannel_header_icon">
                                                <Workflow size={18} />
                                            </div>
                                            <p
                                                className="cf_newFlow_trigger_pannel_header_name"
                                                style={{ cursor: "pointer", fontSize: "14px" }}
                                            >
                                                Automate Onboarding Workflow
                                            </p>
                                        </div>
                                    </div>
                                    {
                                        masterWorkFlowData?.trigger && (<WorkFlowRenderAppications appData={masterWorkFlowData?.trigger}
                                            appType="TRIGGER"
                                        />)
                                    }
                                    {
                                        masterWorkFlowData?.primaryApplications?.map((app) => {
                                            return (<WorkFlowRenderAppications appData={app} handleEditObject={(e) => handleEditObject(e, {
                                                type: "APPLICATION",
                                                workFlowAction: true
                                            })} handleDeleteObject={(e) => handleEditObject(e, {
                                                type: "APPLICATION",
                                                workFlowAction: true
                                            }, "DELETE")} />)
                                        })
                                    }
                                    {masterWorkFlowData?.ifElse && (<>
                                        <WorkFlowAddAction handleDrop={(e) => handleDrop(e, {
                                            for: "WORKFLOW",
                                            isInterMediateApplication: true,
                                        })} addAction={(e) => addActions({ ...e, for: "WORKFLOW", isInterMediateApplication: true })} isWaitingForDragging={currentDraggableElement === "APPLICATION_INTERMEDIAT"} marginTop={"60px"} />
                                    </>)}
                                    {masterWorkFlowData?.ifElse && (
                                        <ActionPanel
                                            action={"IF_ELSE"}
                                            onDelete={() => setMasterWorkFlowData({
                                                ...masterWorkFlowData,
                                                ifElse: false,
                                                workFlowAction: true,
                                                divisionsList: [],
                                                divisionsMap: {}
                                            })}
                                            borderColor="rgb(255 0 0)"
                                            backgroundColor="rgb(255 231 231 / 43%)"
                                            icon={
                                                <GitFork
                                                    size={22}
                                                    style={{ transform: "rotate(180deg)" }}
                                                />
                                            }
                                            title="If Else Conditions"
                                            subtitle="Route based on division"
                                            isRhombus={true}
                                        />
                                    )}

                                    {(
                                        <div
                                            className={
                                                masterWorkFlowData?.divisionsList?.length > 0
                                                    ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                                                    : ""
                                            }
                                            style={{
                                                marginTop: masterWorkFlowData?.divisionsList?.length > 0 ? "85px" : "0px",
                                            }}
                                        >
                                            {
                                                masterWorkFlowData?.divisionsList?.length > 0 ? (<div
                                                    className="cf_department_based_action_container_dottedLine_role"
                                                    style={{
                                                        width: `calc(100% - ${calculateWidth("DIVISION", scale)}px)`,
                                                    }}
                                                />) : ""
                                            }
                                            {masterWorkFlowData?.divisionsList?.map((division, ind) => {
                                                return (
                                                    <div
                                                        key={`${division}_level`}
                                                        className={`CF_d-flex current_division_${ind + 1}`}
                                                        id={`cf_roleLevel_container_DIVISION_${ind}`}
                                                        style={{
                                                            flexDirection: "column",
                                                            justifyContent: "center",
                                                            alignItems: "center",
                                                            position: "relative",
                                                        }}
                                                    >
                                                        <WorkFlowRenderDivisions divisionData={division}
                                                            handleDeleteObject={(e) => handleEditObject(e, {
                                                                type: "DIVISION",
                                                                for: "WORKFLOW",
                                                                divisionName: division,
                                                            }, "DELETE")}
                                                        />
                                                        {
                                                            masterWorkFlowData?.divisionsMap?.[division]?.primaryApplications?.length > 0 ?
                                                                masterWorkFlowData?.divisionsMap?.[division]?.primaryApplications?.map((app) => {
                                                                    return (<WorkFlowRenderAppications appData={app} handleEditObject={(e) => handleEditObject(e, {
                                                                        type: "APPLICATION",
                                                                        for: "WORKFLOW",
                                                                        divisionName: division,
                                                                        workFlowAction: true,
                                                                    })} handleDeleteObject={(e) => handleEditObject(e, {
                                                                        type: "APPLICATION",
                                                                        for: "WORKFLOW",
                                                                        divisionName: division,
                                                                        workFlowAction: true,
                                                                    }, "DELETE")} />)
                                                                })


                                                                : ""
                                                        }
                                                        {(masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.length > 0 && division !== "Division Not Met") &&
                                                            <WorkFlowAddAction handleDrop={(e) => handleDrop(e, {
                                                                for: "WORKFLOW",
                                                                divisionName: division,
                                                                action: "DIVISION_ACTIONS",
                                                                isInterMediateApplication: true,
                                                            })} addAction={(e) => addActions({ ...e, for: "WORKFLOW", divisionName: division, action: "DIVISION_ACTIONS", isInterMediateApplication: true, })} isWaitingForDragging={currentDraggableElement === "APPLICATION_" + division} marginTop={"60px"} />
                                                        }
                                                        {
                                                            <div
                                                                className={
                                                                    masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.length > 0
                                                                        ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                                                                        : ""
                                                                }

                                                            >
                                                                {
                                                                    masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.length > 0 ? (
                                                                        <>
                                                                            <div
                                                                                className="cf_department_based_action_container_dottedLine_role divtemp"
                                                                                style={{
                                                                                    width: `calc(100% - ${calculateWidth("DIVISION_TEMPLATES", scale, division?.replaceAll(" ", "_"))}px)`,
                                                                                }}
                                                                            />
                                                                        </>
                                                                    ) : ""
                                                                }
                                                                {masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.length > 0 ?
                                                                    masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.map((template, templateIndex) => (
                                                                        <WorkFlowTemplateRender
                                                                            templateUID={division?.replaceAll(" ", "_")}
                                                                            key={`${division}-template-${templateIndex}`}
                                                                            initialWorkFlowData={template}
                                                                            hideWorkFlowDefaultTemplates={true}
                                                                            onWorkFlowDataChange={(data) => {
                                                                                if (data?.departMentsList?.length === 0) {
                                                                                    let currentAvailableTemplates = [...masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList];
                                                                                    currentAvailableTemplates.splice(templateIndex, 1);
                                                                                    setMasterWorkFlowData((prev) => {
                                                                                        const next = { ...prev };
                                                                                        next.divisionsMap = { ...next.divisionsMap };
                                                                                        next.divisionsMap[division] = {
                                                                                            ...next.divisionsMap[division],
                                                                                            departMentTemplatesList: currentAvailableTemplates,
                                                                                        };
                                                                                        return next;
                                                                                    });
                                                                                } else {
                                                                                    setMasterWorkFlowData((prev) => {
                                                                                        const next = { ...prev };
                                                                                        next.divisionsMap = { ...next.divisionsMap };
                                                                                        next.divisionsMap[division] = {
                                                                                            ...next.divisionsMap[division],
                                                                                            departMentTemplatesList: [...(next.divisionsMap[division]?.departMentTemplatesList || [])],
                                                                                        };
                                                                                        next.divisionsMap[division].departMentTemplatesList[templateIndex] = { ...data, workFlowName: next.divisionsMap[division].departMentTemplatesList[templateIndex]?.workFlowName || data?.workFlowName || "Template" };
                                                                                        return next;
                                                                                    });
                                                                                }
                                                                            }}
                                                                            metaData={{
                                                                                divisionName: division,
                                                                                workFlowId: createdWorkFlow?.id || null,
                                                                            }}
                                                                            workFlowJSON={template}
                                                                            isWorkflowNameEditable={false}
                                                                            onWorkflowNameEditableChange={setIsWorkflowNameEditable}
                                                                            onWorkFlowJSONChange={() => { }}
                                                                            currentDraggableElement={currentDraggableElement}
                                                                            scale={scale}
                                                                            cloudsList={cloudsList}
                                                                            setCurrentDraggableElement={setCurrentDraggableElement}
                                                                            setIsPopupOpen={setIsPopupOpen}
                                                                            setEditObject={setEditObject}
                                                                            setSelectedRoles={setSelectedRoles}
                                                                            setSelectedLocations={setSelectedLocations}
                                                                            setSelectedApplicationsList={setSelectedApplicationsList}
                                                                            setCurrentAvailableOptions={setCurrentAvailableOptions}
                                                                            isTemplateNameRequired={false}
                                                                            setTemplateView={setTemplateView}
                                                                        />
                                                                    ))
                                                                    : ""}
                                                                {
                                                                    masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.length > 0 ?
                                                                        <>
                                                                            <WorkFlowAddAction
                                                                                handleDrop={(e) =>
                                                                                    handleDrop(e, {
                                                                                        action: "DIVISION_ACTIONS",
                                                                                        divisionName: division,
                                                                                        for: "WORKFLOW",
                                                                                    })
                                                                                }
                                                                                addAction={() =>
                                                                                    addActions({
                                                                                        action: "DIVISION_ACTIONS",
                                                                                        divisionName: division,
                                                                                        for: "WORKFLOW",
                                                                                    })
                                                                                }
                                                                                isWaitingForDragging={currentDraggableElement === "DIVISION_ACTION_" + division}
                                                                                customClass="cf_action_trigger_for_department"
                                                                            />
                                                                        </>
                                                                        : ""
                                                                }
                                                            </div>
                                                        }
                                                        {
                                                            masterWorkFlowData?.divisionsMap?.[division]?.departMentTemplatesList?.length === 0 ?
                                                                <>
                                                                    <WorkFlowAddAction
                                                                        handleDrop={(e) =>
                                                                            handleDrop(e, {
                                                                                action: "DIVISION_ACTIONS",
                                                                                divisionName: division,
                                                                                for: "WORKFLOW",
                                                                            })
                                                                        }
                                                                        addAction={() =>
                                                                            addActions({
                                                                                action: "DIVISION_ACTIONS",
                                                                                divisionName: division,
                                                                                for: "WORKFLOW",
                                                                            })
                                                                        }
                                                                        isWaitingForDragging={currentDraggableElement === "DIVISION_ACTION_" + division}
                                                                    />
                                                                </>
                                                                : ""
                                                        }
                                                    </div>
                                                )
                                            })}
                                            {
                                                masterWorkFlowData?.divisionsList?.length > 0 ? (
                                                    <>
                                                        <WorkFlowAddAction
                                                            handleDrop={(e) =>
                                                                handleDrop(e, {
                                                                    action: "ADD_DIVISION_ACTION",
                                                                    for: "WORKFLOW",
                                                                })
                                                            }
                                                            addAction={() =>
                                                                addActions({
                                                                    action: "ADD_DIVISION_ACTION",
                                                                    for: "WORKFLOW",
                                                                })
                                                            }
                                                            isWaitingForDragging={currentDraggableElement === "APPLICATION"}
                                                            customClass="cf_action_trigger_for_department"
                                                        />
                                                    </>
                                                ) : ""
                                            }
                                        </div>
                                    )
                                    }
                                    {
                                        (templateWorkFlowDataRef.current?.departMentsList?.length === 0 && masterWorkFlowData?.divisionsList?.length === 0) &&
                                        <WorkFlowAddAction handleDrop={(e) => handleDrop(e, {
                                            for: "WORKFLOW",
                                        })} addAction={(e) => addActions({ ...e, for: "WORKFLOW" })} isWaitingForDragging={currentDraggableElement === "APPLICATION"} marginTop={masterWorkFlowData?.ifElse ? "85px" : "60px"} />
                                    }
                                </>

                                :
                                <WorkFlowTemplateRender
                                    initialWorkFlowData={initialTemplateData}
                                    onWorkFlowDataChange={(data) => { templateWorkFlowDataRef.current = data; }}
                                    workFlowJSON={workFlowJSON}
                                    isWorkflowNameEditable={isWorkflowNameEditable}
                                    onWorkflowNameEditableChange={setIsWorkflowNameEditable}
                                    onWorkFlowJSONChange={setWorkFlowJSON}
                                    currentDraggableElement={currentDraggableElement}
                                    scale={scale}
                                    cloudsList={cloudsList}
                                    setCurrentDraggableElement={setCurrentDraggableElement}
                                    setIsPopupOpen={setIsPopupOpen}
                                    setEditObject={setEditObject}
                                    setSelectedRoles={setSelectedRoles}
                                    setSelectedLocations={setSelectedLocations}
                                    setSelectedApplicationsList={setSelectedApplicationsList}
                                    setCurrentAvailableOptions={setCurrentAvailableOptions}
                                    setTemplateView={setTemplateView}
                                />
                        }
                    </div>
                    {hasValidWorkFlowData() && (
                        <div
                            className="cf_zoom_percentage_container"
                            style={{
                                top: "20px",
                                right: isPopupOpen ? "calc( 30% + 20px )" : "10px",
                            }}
                        >
                            <ActionButton
                                buttonType="button"
                                customClass={`changeButtonColorOnHover cf_newBox_Shadow`}
                                customStyles={{
                                    backgroundColor: "#fff",
                                    height: "35px",
                                    width: "80px",
                                    right: isPopupOpen ? "calc( 30% + 20px )" : "10px",
                                }}
                                buttonClickAction={() => {
                                    saveTemplate();
                                }}
                            >
                                <p>Save</p>
                            </ActionButton>
                        </div>
                    )}
                    <div
                        className="cf_newBox_Shadow cf_zoom_percentage_container"
                        style={{ right: isPopupOpen ? "calc( 30% + 20px )" : "10px" }}
                    >
                        <div className="cf_zoom_percentage_container_inner">
                            <div className="cf_newBox_Shadow cf_canvas_zoom_options">
                                <div
                                    className="cf_canvas_zoom_options_icon_container"
                                    onClick={() => {
                                        resetZoom();
                                    }}
                                >
                                    <p>Fit To Canvas</p>
                                    <div className="cf_canvas_zoom_options_icon">
                                        <Maximize strokeWidth={3} size={12} />
                                    </div>
                                </div>
                                <div
                                    className="cf_canvas_zoom_options_icon_container"
                                    onClick={() => {
                                        setScale(scale - 0.1);
                                        innerRef.current.style.transform = `translate(${position.current.x
                                            }px, ${position.current.y}px) scale(${scale - 0.1})`;
                                    }}
                                >
                                    <p>Zoom Out</p>
                                    <div className="cf_canvas_zoom_options_icon">
                                        <Minus strokeWidth={3} size={12} />
                                    </div>
                                </div>
                                <div
                                    className="cf_canvas_zoom_options_icon_container"
                                    onClick={() => {
                                        setScale(scale + 0.1);
                                        innerRef.current.style.transform = `translate(${position.current.x
                                            }px, ${position.current.y}px) scale(${scale + 0.1})`;
                                    }}
                                >
                                    <p>Zoom In</p>
                                    <div className="cf_canvas_zoom_options_icon">
                                        <Plus strokeWidth={3} size={12} />
                                    </div>
                                </div>
                            </div>
                            <p style={{ fontSize: "12px", fontWeight: "500" }}>
                                {Math.abs((scale / 1) * 100).toFixed(0)}%
                            </p>
                            <span style={{ marginLeft: "auto" }}></span>
                            <ChevronUp size={12} />
                        </div>
                    </div>
                </div>
                {
                    isPopupOpen && (
                        <WorkFlowActionPannel
                            selectedRoles={selectedRoles}
                            selectedDepartments={selectedDeptList}
                            selectedLocations={selectedLocations}
                            currentAvailableOptions={currentAvailableOptions} actionsList={actionsList}
                            selectedApplicationsList={selectedApplicationsList}
                            templatesList={templatesList}
                            editObject={editObject}
                            handleEditObject={(res, actionType, primaryAction) => {
                                if (editObject?.__templateSaveHandler) {
                                    editObject.__templateSaveHandler(res, actionType, primaryAction);
                                    setEditObject(null);
                                } else {
                                    handleEditObject(res, actionType, primaryAction);
                                }
                            }}
                            templateView={isWorkFlowBuilding ? templateView : "CUSTOM"}
                            selectedDivisionsList={selectedDivisionsList}
                            selectedTemplatesList={selectedTemplatesList}
                            setIsLoading={setIsPageLoading}
                        />
                    )
                }
            </div>
        );
    };

    const handleSaveApplicationEditObject = (e) => {

    };

    return (
        <>
            <div className="cf_main_container">
                <SideNav activeTab="Workflow" />
                <div className="cf_main_content_place">
                    <TopNav pageName={isWorkFlowBuilding ? "Create Workflow" : "Create Template"} backLink={!isWorkFlowBuilding ? "/Workflow/Template#Templates" : "/Workflow/Template"} />
                    {renderCanvas()}
                </div>
            </div>

            {isPageLoading ? getCFLoader() : ""}
        </>
    );
};

export default WorkFlowBuilder;
