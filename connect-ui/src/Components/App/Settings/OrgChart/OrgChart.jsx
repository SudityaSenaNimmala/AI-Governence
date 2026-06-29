import { BriefcaseBusiness, Building, ChevronUp, GitFork, GripVertical, Maximize, Minus, Plus, X } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { notifyToast, zoomToFit } from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getDepartMentCategoryList, getOrgChart, saveOrgChartTemplate } from "../../UserManagement/UserManagementActions/UserManagementActions";
import WorkFlowAddAction from "../../WorkFlowBuilder/WorkFlowHelpers/WorkFlowAddAction";
import RenderWorkFlow from "../../WorkFlowBuilder/WorkFlowHelpers/RenderWorkFlow";
import { calculateWidth } from "../../NewFlow/utils/workflowUtils";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";

const OrgChart = () => {

    const { globalContext } = useContext(GlobalContext);
    const { cloudsList } = globalContext;
    const containerRef = useRef(null);
    const [scale, setScale] = useState(1);
    const innerRef = useRef(null);
    const position = useRef({ x: 0, y: 0 });
    const dragStart = useRef({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [orgList, setOrgList] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [departmentData, setDepartmentData] = useState([]);
    const [waitingForDragging, setWaitingForDragging] = useState(null);
    const [searchValues, setSearchValues] = useState("");
    const [listOfSelectedDepartments, setListOfSelectedDepartments] = useState([]);
    const [existingOrgChart, setExistingOrgChart] = useState(null);
    const [orgChartJSON, setOrgChartJSON] = useState({
        listOfParents: [],
        parentsMap: {}
    });

    useEffect(() => {
        if (cloudsList?.length > 0) {
            let primaryApplication = cloudsList?.find((cloud) => cloud?.primaryApp);
            getDepartMentDate(primaryApplication);
        }
    }, []);


    useEffect(() => {
        const handleEscapeKey = (event) => {
            if (event.key === "Escape" && isPopupOpen) {
                setIsPopupOpen(false);
                setWaitingForDragging(null);
            }

        };

        if (isPopupOpen) {
            window.addEventListener("keydown", handleEscapeKey);
        }

        return () => {
            window.removeEventListener("keydown", handleEscapeKey);
        };
    }, [isPopupOpen]);

    const getDepartMentDate = async (primaryApplication) => {
        let res = await getDepartMentCategoryList(primaryApplication?.id);
        if (res?.status === "OK") {
            if (res?.res?.departMents) {
                let lister = Object.keys(res?.res?.departMents).map((data) => {
                    if (data) {
                        return {
                            name: `${data}`,
                            y: res?.res?.departMents[data],
                            originalName: data,
                        }
                    } else {
                        return "";
                    }
                });
                setDepartmentData(lister);
                localStorage.setItem("departmentData", JSON.stringify(lister));
                setIsLoading(false);
            } else {
                setDepartmentData([]);
                setIsLoading(false);
            }
        }
    }


    const hasValidWorkFlowData = () => {
        return orgChartJSON?.listOfParents?.length > 0;
    }

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

    const handleAddAction = (action, subTree) => {
        setIsPopupOpen(true);
        if (subTree === "SUBTREE") {
            setWaitingForDragging("GLOBAL_" + action);
        } else {

            setWaitingForDragging(subTree);
        }
    }

    const handleDragStart = (e, data) => {
        e.dataTransfer.setData("json", JSON.stringify(data));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDrop = (e, parentDepartment) => {
        e.preventDefault();
        let data = JSON.parse(e.dataTransfer.getData("json"));
        setListOfSelectedDepartments([...listOfSelectedDepartments, data?.role]);
        let cpyOrgChartJSON = { ...orgChartJSON };
        if (!parentDepartment) {
            cpyOrgChartJSON.listOfParents.push(data?.role);
            cpyOrgChartJSON.parentsMap[data?.role] = [...(cpyOrgChartJSON.parentsMap[data?.role] || [])];
        }
        if (parentDepartment) {
            cpyOrgChartJSON.parentsMap[parentDepartment] = [...(cpyOrgChartJSON.parentsMap[parentDepartment] || []), data?.role];
        }
        setOrgChartJSON(cpyOrgChartJSON);
        setWaitingForDragging(null);
        setIsPopupOpen(false);
    }

    const saveTemplate = async () => {
        setIsLoading(true);
        let body = []
        orgChartJSON?.listOfParents?.forEach((res) => {
            body.push({
                parentDepartment: res,
                subDepartments: orgChartJSON?.parentsMap?.[res] || [],
            });
        });
        let bdy = {
            orgData: body,
        }
        if (existingOrgChart?.id) {
            bdy.id = existingOrgChart?.id;
        }
        let res = await saveOrgChartTemplate(bdy);
        if (res?.status === "OK") {
            localStorage.setItem("orgChartData", JSON.stringify(res?.res));
            notifyToast("success", "Template saved successfully");
            setIsLoading(false);
        } else {
            notifyToast("error", res?.res);
            setIsLoading(false);
        }
        return;
    }

    useEffect(() => {
        getExistingOrgChart();
    }, []);

    const getExistingOrgChart = async () => {
        setIsLoading(true);
        let res = await getOrgChart();
        if (res?.status === "OK") {
            if (res?.res) {
                setExistingOrgChart(res?.res);
                let fullDepts = []
                let deptmnts = res?.res?.orgData?.reduce((acc, org) => {
                    acc.push(org?.parentDepartment);
                    fullDepts.push(org?.parentDepartment);
                    fullDepts.push(...org?.subDepartments);
                    return acc;
                }, []);
                let existDeptMap = res?.res?.orgData?.reduce((acc, org) => {
                    acc[org?.parentDepartment] = org?.subDepartments;
                    return acc;
                }, {});
                setListOfSelectedDepartments(fullDepts);
                setOrgChartJSON({
                    listOfParents: deptmnts,
                    parentsMap: existDeptMap,
                });
            }
            setIsLoading(false);
        } else {
            setIsLoading(false);
        }
    }

    const handleDelete = (action, type, parentDepartment = null) => {

        let cpyOrgChartJSON = { ...orgChartJSON };
        let cpyListOfSelectedDepartments = [...listOfSelectedDepartments];
        if (type === "DEPARTMENT") {
            cpyOrgChartJSON.listOfParents = cpyOrgChartJSON.listOfParents.filter((res) => res !== action);
            delete cpyOrgChartJSON.parentsMap[action];
            cpyListOfSelectedDepartments = cpyListOfSelectedDepartments.filter((res) => res !== action);
        } else {
            cpyOrgChartJSON.parentsMap[parentDepartment] = cpyOrgChartJSON.parentsMap[parentDepartment].filter((res) => res !== action);
            cpyListOfSelectedDepartments = cpyListOfSelectedDepartments.filter((res) => res !== action);
        }
        setListOfSelectedDepartments(cpyListOfSelectedDepartments);
        setOrgChartJSON(cpyOrgChartJSON);
    }


    const renderCanvas = () => {
        return (
            <div
                className={
                    "cf_main_content_place_main CF_d-flex"
                }
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
                        width: "100%",
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
                        <div className="cf_newFlow_trigger_pannel">
                            <div className="cf_newFlow_trigger_pannel_header">
                                <div className="cf_newFlow_trigger_pannel_header_icon">
                                    <GitFork size={18} style={{ transform: "rotate(180deg)" }} />
                                </div>
                                <p
                                    className="cf_newFlow_trigger_pannel_header_name"
                                    style={{ fontSize: "14px" }}
                                >
                                    Org Chart
                                </p>
                            </div>
                        </div>

                        {
                            <div className={orgChartJSON?.listOfParents?.length > 0 ? "cf_department_based_action_container cf_action_trigger_dottedParent" : "cf_action_trigger_dottedParent"}
                            >
                                {
                                    orgChartJSON?.listOfParents?.length > 0 ?
                                        <div
                                            className="cf_department_based_action_container_dottedLine_role"
                                            style={{
                                                width: `calc(100% - ${calculateWidth("ROLES", scale)}px)`,
                                            }}
                                        /> : ""
                                }
                                {orgChartJSON?.listOfParents.map((res, index) => {
                                    return (
                                        <div className={`CF_d-flex current_role_${index + 1}`}
                                            id="cf_roleLevel_container"
                                            style={{
                                                flexDirection: "column",
                                                justifyContent: "center",
                                                alignItems: "center",
                                                position: "relative",
                                            }}>
                                            <RenderWorkFlow
                                                action={res}
                                                handleDelete={() => {
                                                    handleDelete(res, "DEPARTMENT");
                                                }}
                                            />
                                            {
                                                <div className={orgChartJSON?.parentsMap?.[res]?.length > 0 ? "cf_department_based_action_container cf_action_trigger_dottedParent" : "cf_action_trigger_dottedParent"}
                                                >
                                                    {
                                                        orgChartJSON?.parentsMap?.[res]?.length > 0 ?
                                                            <div
                                                                className="cf_department_based_action_container_dottedLine_role"
                                                                style={{
                                                                    // width: `calc(100% - ${calculateWidth("ROLES", scale)}px)`,
                                                                }}
                                                            /> : ""
                                                    }
                                                    {/* <div className="CF_d-flex current_role_${index}" > */}
                                                    {
                                                        orgChartJSON?.parentsMap?.[res]?.map((ass) => {
                                                            return (
                                                                <RenderWorkFlow
                                                                    action={ass}
                                                                    dull="#FFD6E7"
                                                                    dark="#9E2A5C"
                                                                    handleDelete={() => {
                                                                        handleDelete(ass, "SUB_DEPARTMENT", res);
                                                                    }}
                                                                />
                                                            )
                                                        })
                                                    }
                                                    {
                                                        orgChartJSON?.parentsMap?.[res]?.length > 0 &&
                                                        <WorkFlowAddAction
                                                            isWaitingForDragging={waitingForDragging === "GLOBAL_" + res}
                                                            handleDrop={(e) => handleDrop(e, res)}
                                                            addAction={() => {
                                                                handleAddAction(res, "SUBTREE");
                                                            }}
                                                            customClass="cf_action_trigger_for_department"
                                                        />
                                                    }
                                                    {/* </div> */}
                                                </div>
                                            }
                                            {
                                                orgChartJSON?.parentsMap?.[res]?.length === 0 &&
                                                <WorkFlowAddAction
                                                    isWaitingForDragging={waitingForDragging === "GLOBAL_" + res}
                                                    handleDrop={(e) => handleDrop(e, res)}
                                                    addAction={() => {
                                                        handleAddAction(res, "SUBTREE");
                                                    }}
                                                    customClass=""
                                                />
                                            }
                                        </div>
                                    )
                                })}
                                {
                                    orgChartJSON?.listOfParents?.length > 0 &&
                                    <WorkFlowAddAction
                                        isWaitingForDragging={waitingForDragging === "GLOBAL"}
                                        handleDrop={handleDrop}
                                        addAction={() => {
                                            handleAddAction("GLOBAL", "GLOBAL");
                                        }}
                                        customClass="cf_action_trigger_for_department"
                                    />
                                }
                            </div>
                        }
                        {orgChartJSON?.listOfParents?.length === 0 &&
                            <WorkFlowAddAction
                                isWaitingForDragging={waitingForDragging === "GLOBAL"}
                                handleDrop={handleDrop}
                                addAction={() => {
                                    handleAddAction("GLOBAL", "GLOBAL");
                                }}
                                customClass=""
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
                        <div
                            style={{
                                width: "40%",
                                height: "100%",
                                background: "#fff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "10px",
                                padding: "5px",
                                overflowY: "hidden",
                                overflowX: "hidden",
                                display: "flex",
                                flexDirection: "column",
                            }}
                            className="cf_box_shadow"
                        >
                            <div
                                style={{
                                    width: "100%",
                                    padding: "8px 12px",
                                    borderBottom: "1px solid #e2e8f0",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <p
                                    style={{
                                        fontSize: "14px",
                                        fontWeight: "600",
                                        color: "#0f1729",
                                        margin: 0,
                                    }}
                                >
                                </p>
                                <ActionButton
                                    buttonType="button"
                                    customClass="CF_Pointer"
                                    customStyles={{
                                        width: "28px",
                                        height: "28px",
                                        padding: "0",
                                        minWidth: "28px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: "transparent",
                                        border: "none",
                                    }}
                                    buttonClickAction={() => {
                                        const escapeEvent = new KeyboardEvent("keydown", {
                                            key: "Escape",
                                            code: "Escape",
                                            keyCode: 27,
                                            which: 27,
                                            bubbles: true,
                                            cancelable: true,
                                        });
                                        window.dispatchEvent(escapeEvent);
                                    }}
                                >
                                    <X size={18} color="#64748b" />
                                </ActionButton>
                            </div>
                            <div
                                style={{
                                    width: "100%",
                                    height: "calc(100% - 45px)",
                                    overflowY: "auto",
                                    flex: 1,
                                }}
                            >
                                {
                                    <div className="cf_workdflow_action_item_container">
                                        <p
                                            className="cf_sub_heading"
                                            style={{
                                                color: "#64748b",
                                                fontWeight: "500",
                                                fontSize: "14px",
                                            }}
                                        >
                                            Select Title
                                        </p>
                                        <SearchComponent
                                            autoOpen={true}
                                            boxShadows={true}
                                            inputName="searchInput"
                                            customStyles={{ width: "100%", height: "40px" }}
                                            customButtonStyles={{
                                                background: "transparent",
                                                color: "rgb(255, 255, 255)",
                                                fontWeight: "bolder",
                                                height: "35px",
                                            }}
                                            inputPlaceHolder={`Search By Title`}
                                            defaultValue={searchValues}
                                            onInputSearch={(e) =>
                                                setSearchValues(e.searchInput)
                                            }
                                        />
                                        {departmentData?.filter((data) => {
                                            return !listOfSelectedDepartments.includes(data?.name);
                                        })?.filter((res) => {
                                            return res?.name?.toLowerCase().includes(searchValues?.toLowerCase());
                                        })?.map((res) => {
                                            return (
                                                <div
                                                    draggable={true}
                                                    onDragStart={(e) =>
                                                        handleDragStart(e, {
                                                            action: "SELECT_ROLE",
                                                            role: res?.name,
                                                        })
                                                    }
                                                    key={res?.name + "ROLE"}
                                                    className="cf_workdflow_app_container"
                                                >
                                                    <div className="cf_workdflow_app_header">
                                                        <GripVertical
                                                            size={20}
                                                            color="#64748b"
                                                            className="cf_workdflow_app_header_grip"
                                                        />
                                                        <div className="cf_workdflow_action_item_icon">
                                                            <Building size={20} color="#64748b" />
                                                        </div>
                                                        <div>
                                                            <p style={{ fontWeight: "500", fontSize: "12px" }}>
                                                                {res?.name}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                }
                            </div>
                        </div>

                    )
                }
            </div >
        );
    };

    return (
        <>
            <div className="cf_main_container" >
                <SideNav activeTab="Settings" />
                <div className="cf_main_content_place">
                    <TopNav
                        pageName={"Manage Orgchart"}
                        backLink="/Settings"
                    />
                    {renderCanvas()}
                </div>
            </div>
            {isLoading ? getCFLoader() : ""}
        </>
    )
}

export default OrgChart;