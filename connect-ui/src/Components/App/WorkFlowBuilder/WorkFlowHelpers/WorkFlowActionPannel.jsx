import { useContext, useEffect, useRef, useState } from "react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { BriefcaseBusiness, Building, ChevronDown, FileText, GitBranch, GripVertical, MapPin, UserPlus, X, Zap } from "lucide-react";
import "../../NewFlow/css/NewFlow.css";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import OnBoardHandleUserOptions from "../../UserManagement/OnBoard/OnBoardHandleUserOptions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName, onBoardCloudsList } from "../../../helpers/helpers";
import { isGroupUserManagementExist, notifyToast, onBoardFields, onBoardWithOutLicense, userActionRequired } from "../../../helpers/utils";
import { getLicensesList, getSaaSGroupsData, getVendorSearch } from "../../SaaSManagement/SaaSActions/SaaSActions";
import FlowLicenseSelector from "../../NewFlow/FlowLicenseSelector";
import FlowGroupsSelector from "../../NewFlow/FlowGroupsSelector";
import { checkForCustomRoles } from "./WorkFlowHelpers";
import TextInputUpdate from "../../../Resuables/InputsComponents/TextInputUpdate";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import { updateSaaSVendor } from "../../Oauth/OauthActions/OauthApiActions";

const WorkFlowActionPannel = ({
    selectedDepartments = [],
    selectedDivisionsList = [],
    selectedApplicationsList = [],
    selectedRoles = [],
    selectedLocations = [],
    currentAvailableOptions = [],
    actionsList = {},
    editObject = null,
    templatesList = [],
    handleEditObject = () => { },
    selectedTemplatesList = [],
    templateView = "CUSTOM",
    setIsLoading = () => { },
}) => {
    const { globalContext } = useContext(GlobalContext);
    const { cloudsList } = globalContext;
    const [currentElement, setCurrentElement] = useState(null);
    const [searchValues, setSearchValues] = useState(null);
    const [currentTriggerItem, setCurrentTriggerItem] = useState(null);
    const [hasLicenseManagement, setHasLicenseManagement] = useState(false);
    const [hasGroupManagement, setHasGroupManagement] = useState(false);
    const [isLoaded, setIsLoaded] = useState({
        license: false,
        group: false,
    });
    const [licenseInfoMap, setLicenseInfoMap] = useState({});
    const [groupsList, setGroupsList] = useState([]);
    const [searchGroupsList, setSearchGroupsList] = useState([]);
    const [searchValue, setSearchValue] = useState(null);
    const [userInfoMap, setUserInfoMap] = useState({});
    const [selectedUserInfoMap, setSelectedUserInfoMap] = useState({});
    const [selectedAppMap, setSelectedAppMap] = useState({});
    const [selectedUserInfoMapInternal, setSelectedUserInfoMapInternal] = useState({});
    const [cursorAiInviteLink, setCursorAiInviteLink] = useState(null);
    const [actionType] = useState([
        {
            id: "TRIGGER",
            name: "Trigger Action",
            icon: <Zap size={20} color="#64748b" />,
            description: "Trigger an action based on a specific event",
        },
        {
            id: "IF_ELSE",
            name: "If Else",
            icon: <GitBranch size={20} color="#64748b" />,
            description: "Add conditional branching logic",
        },
        {
            id: "DIVISION_BASED_ACTION",
            name: "Division Based Action",
            icon: <Building size={20} color="#64748b" />,
            description: "Add actions based on division",
        },
        {
            id: "DEPARTMENT_BASED_ACTION",
            name: "Department Based Action",
            icon: <Building size={20} color="#64748b" />,
            description: "Add actions based on department",
        },
        {
            id: "ROLE_BASED_ACTION",
            name: "Title Based Action",
            icon: <BriefcaseBusiness size={20} color="#64748b" />,
            description: "Add actions based on title",
        },
        {
            id: "LOCATION_BASED_ACTION",
            name: "Location Based Action",
            icon: <MapPin size={20} color="#64748b" />,
            description: "Add actions based on location",
        },
        {
            id: "ONBOARD_TO_APPLICATIONS",
            name: "Onboard To Applications",
            icon: <UserPlus size={20} color="#64748b" />,
            description: "Add users to selected applications",
        },
        {
            id: "EXISTING_TEMPLATE",
            name: "Choose Existing Template",
            icon: <FileText size={20} color="#64748b" />,
            description: "Choose an existing template to add actions",
        },
    ]);


    useEffect(() => {
        const checkForCustomRolesInternal = async () => {
            if (editObject) {
                if (editObject?.actionType?.type === "APPLICATION") {
                    let currentApplication = { ...editObject?.res?.currentApplication, adminCloudId: editObject?.res?.currentApplication?.id };
                    setCurrentElement("ONBOARD_TO_APPLICATIONS");
                    setCurrentTriggerItem({
                        currentApplication: currentApplication,
                    });
                    setCursorAiInviteLink(currentApplication?.deltaUsersUrl);
                    let mapper = `${currentApplication?.providerName === "OTHERS" ? currentApplication?.externalProviderName : currentApplication?.providerName}|${currentApplication?.id}`;
                    setSelectedAppMap({
                        [mapper]: {
                            LICENSES: [...(editObject?.res?.LICENSES || [])],
                            GROUPS: [...(editObject?.res?.GROUPS || [])],
                        },
                    });

                    if (userActionRequired?.includes(currentApplication?.providerName === "OTHERS" ? currentApplication?.externalProviderName : currentApplication?.providerName) && (editObject?.res?.roles?.length > 0 || editObject?.res?.commonName)) {
                        let res = await checkForCustomRoles(
                            onBoardFields[
                            currentApplication?.providerName === "OTHERS" ? currentApplication?.externalProviderName : currentApplication?.providerName
                            ],
                            currentApplication,
                            editObject?.res?.commonName,
                            editObject?.res?.roles
                        );
                        setUserInfoMap(res?.userInfoMap);
                        setSelectedUserInfoMap(res?.selectedUserInfoMap);
                    }
                }
            } else {
                setCurrentElement("");
                setSelectedUserInfoMap({});
                setUserInfoMap({});
                setLicenseInfoMap({});
                setCurrentTriggerItem(null);
                setCursorAiInviteLink(null);
            }
        }
        checkForCustomRolesInternal();
    }, [editObject]);


    useEffect(() => {
        if (
            currentTriggerItem?.currentApplication?.id &&
            currentElement === "ONBOARD_TO_APPLICATIONS"
        ) {
            setCursorAiInviteLink(currentTriggerItem?.currentApplication?.deltaUsersUrl);
            setGroupsList([]);
            // setLicenseInfoMap({});
            if (
                !onBoardWithOutLicense.includes(
                    currentTriggerItem?.currentApplication?.providerName
                )
            ) {
                setHasLicenseManagement(true);
                fetchLicenses();
            } else {
                setHasLicenseManagement(false);
            }
            if (isGroupUserManagementExist.includes(currentTriggerItem?.currentApplication?.providerName)) {
                setHasGroupManagement(true);
                fetchGroups();
            } else {
                setHasGroupManagement(false);
            }
        }
    }, [currentTriggerItem]);


    const handleLicenseSelection = (e, data) => {
        let mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;

        if (editObject) {
            mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`;
        }

        let existingSelectedAppMap = selectedAppMap[mapper]
            ? selectedAppMap[mapper]["LICENSES"] || []
            : [];
        if (e.target.checked) {
            existingSelectedAppMap.push(data);
        } else {
            existingSelectedAppMap = existingSelectedAppMap.filter(
                (license) => license?.id !== data?.id
            );
        }
        setSelectedAppMap((prev) => ({
            ...prev,
            [mapper]: {
                ...prev[mapper],
                LICENSES: existingSelectedAppMap,
            },
        }));
    };

    const handleGroupsSelection = (e, data) => {
        if (searchValue !== null || searchValue?.length > 0) {
            if (e.target.checked) {
                let cpyGroupsList = groupsList?.groupDtos;
                cpyGroupsList.push(data);
                setGroupsList({ ...groupsList, groupDtos: cpyGroupsList });
            }
        }
        let mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;
        if (editObject) {
            mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`;
        }
        let existingSelectedAppMap = selectedAppMap[mapper]
            ? selectedAppMap[mapper]["GROUPS"] || []
            : [];
        if (e.target.checked) {
            existingSelectedAppMap.push(data);
        } else {
            existingSelectedAppMap = existingSelectedAppMap.filter(
                (group) => group?.groupId !== data?.groupId
            );
        }
        setSelectedAppMap((prev) => ({
            ...prev,
            [mapper]: {
                ...prev[mapper],
                GROUPS: existingSelectedAppMap,
            },
        }));
    };

    const handleSelectFromMultiList = (e, eData, action, type, cloudInfo) => {
        let mapId = `${cloudInfo?.providerName}|${cloudInfo?.id}`;

        if (editObject) {
            mapId = `${cloudInfo?.providerName}|${cloudInfo?.adminCloudId || cloudInfo?.id}`;
        }

        if (type === "radio") {
            setSelectedUserInfoMap((prev) => ({
                ...prev,
                [mapId]: {
                    ...(selectedUserInfoMap[mapId] || {}),
                    [action]: [{ ...eData }],
                },
            }));
        } else {
            if (type === "checkbox") {
                let mapper = selectedUserInfoMap[mapId] || {};
                let selectedData = mapper[action] || [];
                if (e.target.checked) {
                    selectedData.push(eData);
                } else {
                    selectedData = selectedData.filter(
                        (selData) => selData?.id !== eData?.id
                    );
                }
                setSelectedUserInfoMap((prev) => ({
                    ...prev,
                    [mapId]: {
                        ...(selectedUserInfoMap[mapId] || {}),
                        [action]: selectedData,
                    },
                }));
            }
        }
    };

    const fetchLicenses = async () => {
        let appName = currentTriggerItem?.currentApplication?.providerName;
        let appId = currentTriggerItem?.currentApplication?.id;
        if (editObject) {
            appId = currentTriggerItem?.currentApplication?.adminCloudId;
        }
        let mappedLicense = `${appName}|${appId}`;
        // if (licenseInfoMap[mappedLicense]) {
        //     return;
        // }
        setIsLoaded((prev) => ({ ...prev, license: true }));
        let res = await getLicensesList("", appName, appId);
        if (res?.status === "OK") {
            setIsLoaded((prev) => ({ ...prev, license: false }));
            setLicenseInfoMap((prev) => ({
                [mappedLicense]: res?.res,
            }));
        } else {
            setIsLoaded((prev) => ({ ...prev, license: false }));
        }
    };


    const fetchGroups = async () => {
        setIsLoaded((prev) => ({ ...prev, group: true }));
        setGroupsList([]);
        let appId = currentTriggerItem?.currentApplication?.id;
        if (editObject) {
            appId = currentTriggerItem?.currentApplication?.adminCloudId;
        }
        let res = await getSaaSGroupsData(
            appId,
            currentTriggerItem?.currentApplication?.providerName,
            0,
            10, currentTriggerItem?.currentApplication?.ssoAppId
        );
        if (res?.status === "OK" && res?.res) {
            setGroupsList(res?.res);
            setIsLoaded((prev) => ({ ...prev, group: false }));
        } else {
            setGroupsList([]);
            setIsLoaded((prev) => ({ ...prev, group: false }));
        }
    };


    const searchDebounce = useRef(null);
    const searchTeamsGroupsList = async (e) => {
        setIsLoaded((prev) => ({ ...prev, group: true }));
        if (searchDebounce.current) {
            clearInterval(searchDebounce.current);
            // setIsLoaded((prev) => ({ ...prev, group: false }));
        }

        if (e.length > 0) {
            setSearchValue(e);
            searchDebounce.current = setTimeout(async () => {
                setIsLoaded((prev) => ({ ...prev, group: true }));
                searchTeamsGroups(e);
            }, 500);
        } else {
            setIsLoaded((prev) => ({ ...prev, group: false }));
            setSearchValue(null);
        }
    };

    const searchTeamsGroups = async (searchValue) => {
        setIsLoaded((prev) => ({ ...prev, group: true }));
        const encodedSearchValue = encodeURIComponent(searchValue);
        let appId = currentTriggerItem?.currentApplication?.id;
        if (editObject) {
            appId = currentTriggerItem?.currentApplication?.adminCloudId;
        }
        let res = await getVendorSearch(
            "",
            "teamgroups",
            encodedSearchValue,
            false,
            currentTriggerItem?.currentApplication?.providerName,
            appId
        );
        if (res?.status === "OK") {
            setIsLoaded((prev) => ({ ...prev, group: false }));
            setSearchGroupsList(res?.res?.groupDtos || []);
        } else {
            setSearchValue(null);
            setSearchGroupsList([]);
            setIsLoaded((prev) => ({ ...prev, group: false }));
        }
    };

    const handleDragStart = (e, data) => {
        e.dataTransfer.setData("json", JSON.stringify(data));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleSaveEditObject = () => {
        let cpyApp = { ...editObject?.res };
        let mapper = `${cpyApp?.currentApplication?.providerName}|${cpyApp?.currentApplication?.id}`;
        if (editObject) {
            mapper = `${cpyApp?.currentApplication?.providerName}|${cpyApp?.currentApplication?.adminCloudId}`;
        }
        cpyApp.GROUPS = selectedAppMap[mapper]?.GROUPS || [];

        cpyApp.LICENSES = selectedAppMap[mapper]?.LICENSES || [];

        cpyApp.roles = Object.values(
            selectedUserInfoMap[mapper] || {}
        )
            .flat()
            ?.reduce((acc, curr) => {
                if (curr?.roleFor !== "CUSTOM_ACTION") {
                    acc.push(curr?.id);
                }
                return acc;
            }, []),
            cpyApp.commonName =
            Object.values(
                selectedUserInfoMap[
                mapper
                ] || {}
            )
                .flat()
                ?.find(
                    (curr) => curr?.roleFor === "CUSTOM_ACTION"
                )?.id || null,


            handleEditObject(cpyApp, editObject?.actionType, "SAVE");
    }


    const saveCusrsorInviteLink = async () => {
        setIsLoading(true);
        let app = cloudsList?.find(data => data?.providerName === "CURSOR_AI" && data?.id === currentTriggerItem?.currentApplication?.id);
        if (app) {
            app.deltaUsersUrl = cursorAiInviteLink;
            let res = await updateSaaSVendor(app);
            if (res?.status === "OK") {
                notifyToast("success", "Cursor Invite Link Saved Successfully");
            } else {
                notifyToast("error", "Failed To Save Cursor Invite Link");
            }
        }
        setIsLoading(false);
    }

    return (
        <div
            style={{
                width: "30%",
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
                <div className="cf_workdflow_action_item_container">
                    {!currentElement && (
                        <div className="cf_workflow_action_panel_compact">
                            {actionType?.filter(data => currentAvailableOptions?.includes(data?.id))?.map(res => (
                                <div
                                    draggable={res?.id === "IF_ELSE"}
                                    onDragStart={(e) => {
                                        if (res?.id === "IF_ELSE") {
                                            handleDragStart(e, {
                                                action: res?.id,
                                            });
                                        }
                                    }}
                                    className="cf_workdflow_action_item"
                                    onClick={() => {
                                        if (res?.id === "TRIGGER") {
                                            setCurrentElement("ONBOARD_TO_APPLICATIONS");
                                        } else if (res?.id !== "IF_ELSE") {
                                            setCurrentElement(res?.id);
                                        }
                                    }}
                                    key={res?.id}
                                >
                                    {res?.id === "IF_ELSE" && (
                                        <GripVertical
                                            size={20}
                                            color="#64748b"
                                            className="cf_workdflow_app_header_grip"
                                        />
                                    )}
                                    <div className="cf_workdflow_action_item_icon">
                                        {res?.icon}
                                    </div>
                                    <div className="cf_workdflow_action_item_content">
                                        <p
                                            style={{
                                                color: "#0f1729",
                                                fontWeight: "500",
                                                lineHeight: "1.25",
                                                margin: 0,
                                            }}
                                        >
                                            {res?.name}
                                        </p>
                                        <p
                                            className="cf_sub_heading"
                                            style={{ fontWeight: "400", margin: "2px 0 0 0" }}
                                        >
                                            {res?.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {currentElement === "DIVISION_BASED_ACTION" && (
                        <div
                            className="cf_workdflow_cloud_license_item"
                            style={{
                                flexDirection: "column",
                                gap: "4px",
                                marginTop: "20px",
                            }}
                        >
                            <p
                                className="cf_sub_heading"
                                style={{ color: "#64748b", fontWeight: "500", fontSize: "14px" }}
                            >
                                Select Division
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
                                inputPlaceHolder={`Search By Division`}
                                defaultValue={searchValues}
                                onInputSearch={(e) =>
                                    setSearchValues(e.searchInput)
                                }
                            />
                            {actionsList?.divisions?.filter((res) => {
                                if (searchValues) {
                                    return res?.name?.toLowerCase().includes(searchValues?.toLowerCase());
                                }
                                return true;
                            })?.filter((res) => !selectedDivisionsList?.includes(res) && res)?.map((data) => (
                                <div
                                    draggable={true}
                                    onDragStart={(e) =>
                                        handleDragStart(e, {
                                            action: "SELECT_DIVISION",
                                            division: data,
                                        })
                                    }
                                    key={data}
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
                                                {data}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {currentElement === "DEPARTMENT_BASED_ACTION" && (
                        <div className="cf_workdflow_action_item_container">
                            <p
                                className="cf_sub_heading"
                                style={{
                                    color: "#64748b",
                                    fontWeight: "500",
                                    fontSize: "14px",
                                }}
                            >
                                Select Department
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
                                inputPlaceHolder={`Search By Department`}
                                defaultValue={searchValues}
                                onInputSearch={(e) =>
                                    setSearchValues(e.searchInput)
                                }
                            />
                            {actionsList?.departMents
                                ?.filter((res) => {
                                    if (searchValues) {
                                        return res
                                            ?.toLowerCase()
                                            .includes(searchValues?.toLowerCase());
                                    }
                                    return true;
                                })
                                ?.filter((res) => !selectedDepartments?.includes(res))
                                ?.map((data) => {
                                    return (
                                        <div
                                            draggable={true}
                                            onDragStart={(e) =>
                                                handleDragStart(e, {
                                                    action: "SELECT_DEPARTMENT",
                                                    department: data,
                                                })
                                            }
                                            key={data || data + "DEPT"}
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
                                                        {data}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                    {currentElement === "ROLE_BASED_ACTION" && (
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
                            {[
                                ...actionsList?.titles
                                    ?.filter((res) => {
                                        if (searchValues) {
                                            return res
                                                ?.toLowerCase()
                                                .includes(searchValues?.toLowerCase());
                                        }
                                        return true;
                                    })
                                    ?.filter(
                                        (res) => res
                                    )
                                    ?.filter((res) => !selectedRoles?.includes(res))
                            ].map((res, index) => {
                                return (
                                    <div
                                        draggable={true}
                                        onDragStart={(e) =>
                                            handleDragStart(e, {
                                                action: "SELECT_ROLE",
                                                role: res,
                                            })
                                        }
                                        key={"ROLE" + index}
                                        className="cf_workdflow_app_container"
                                    >
                                        <div className="cf_workdflow_app_header">
                                            <GripVertical
                                                size={20}
                                                color="#64748b"
                                                className="cf_workdflow_app_header_grip"
                                            />
                                            <div className="cf_workdflow_action_item_icon">
                                                {res === "TITLE_NOT_MET" ? (
                                                    <X size={20} color="#64748b" />
                                                ) : (
                                                    <BriefcaseBusiness size={20} color="#64748b" />
                                                )}
                                            </div>
                                            <div>
                                                <p style={{ fontWeight: "500", fontSize: "12px" }}>
                                                    {res}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {currentElement === "LOCATION_BASED_ACTION" && (
                        <>
                            <div className="cf_workdflow_action_item_container">
                                <p
                                    className="cf_sub_heading"
                                    style={{
                                        color: "#64748b",
                                        fontWeight: "500",
                                        fontSize: "14px",
                                    }}
                                >
                                    Select Location
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
                                    inputPlaceHolder={`Search By Location`}
                                    defaultValue={searchValues}
                                    onInputSearch={(e) =>
                                        setSearchValues(e.searchInput)
                                    }
                                />
                                {actionsList?.locations?.filter(res => res)?.filter((res) => !selectedLocations?.includes(res))?.filter((res) => {
                                    if (searchValues) {
                                        return res
                                            ?.toLowerCase()
                                            .includes(searchValues?.toLowerCase());
                                    }
                                    return true;
                                }).map((res) => {
                                    return (
                                        <div
                                            draggable={true}
                                            onDragStart={(e) =>
                                                handleDragStart(e, {
                                                    action: "SELECT_LOCATION",
                                                    location: res,
                                                })
                                            }
                                            key={res + "LOCATION"}
                                            className="cf_workdflow_app_container"
                                        >
                                            <div className="cf_workdflow_app_header">
                                                <GripVertical
                                                    size={20}
                                                    color="#64748b"
                                                    className="cf_workdflow_app_header_grip"
                                                />
                                                <div className="cf_workdflow_action_item_icon">
                                                    {res === "LOCATION_NOT_MET" ? (
                                                        <X size={20} color="#64748b" />
                                                    ) : (
                                                        <MapPin size={20} color="#64748b" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p style={{ fontWeight: "500", fontSize: "12px" }}>
                                                        {res}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                    {currentElement === "ONBOARD_TO_APPLICATIONS" && (
                        <>
                            <div
                                className="cf_workdflow_cloud_license_item"
                                style={{ flexDirection: "column", gap: "4px" }}
                            >
                                <p
                                    className="cf_sub_heading"
                                    style={{ color: "#64748b", fontWeight: "500" }}
                                >
                                    Select Application To Onboard
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
                                    inputPlaceHolder={`Search By Application`}
                                    defaultValue={searchValues}
                                    onInputSearch={(e) =>
                                        setSearchValues(e.searchInput)
                                    }
                                />
                                <div style={{ paddingBottom: "10px" }}>
                                    {cloudsList?.filter((data) => {
                                        return (onBoardCloudsList.includes(data?.providerName) || (data?.providerName === "ATLASSIAN" && data?.ssoAppId));
                                    })?.filter((data) => {
                                        if (editObject) {
                                            return true;
                                        }
                                        return !selectedApplicationsList?.includes(data?.id)
                                    })
                                        ?.filter((data) => {
                                            if (searchValues) {
                                                return getCloudName(data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName)
                                                    ?.toLowerCase()
                                                    ?.includes(searchValues?.toLowerCase())
                                            } else {
                                                return true;
                                            }
                                        }
                                        )
                                        ?.filter((data) => {
                                            if (editObject) {
                                                return data?.id === editObject?.res?.currentApplication?.id;
                                            }
                                            return true;
                                        })
                                        ?.map((data) => {
                                            return (
                                                <div
                                                    draggable={true}
                                                    onDragStart={(e) =>
                                                        handleDragStart(e, {
                                                            action: "ONBOARD_TO_APPLICATIONS",
                                                            currentApplication: data,
                                                            LICENSES:
                                                                selectedAppMap[
                                                                    `${data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName}|${data?.id}`
                                                                ]?.LICENSES || [],
                                                            GROUPS:
                                                                selectedAppMap[
                                                                    `${data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName}|${data?.id}`
                                                                ]?.GROUPS || [],
                                                            roles: Object.values(
                                                                selectedUserInfoMap[
                                                                `${data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName}|${data?.id}`
                                                                ] || {}
                                                            )
                                                                .flat()
                                                                ?.reduce((acc, curr) => {
                                                                    if (curr?.roleFor !== "CUSTOM_ACTION") {
                                                                        acc.push(curr?.id);
                                                                    }
                                                                    return acc;
                                                                }, []),
                                                            commonName:
                                                                Object.values(
                                                                    selectedUserInfoMap[
                                                                    `${data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName}|${data?.id}`
                                                                    ] || {}
                                                                )
                                                                    .flat()
                                                                    ?.find(
                                                                        (curr) => curr?.roleFor === "CUSTOM_ACTION"
                                                                    )?.id || null,
                                                        })
                                                    }
                                                    key={data?.id + "TRIGGER"}
                                                    className="cf_workdflow_app_container"
                                                >
                                                    <div className="cf_workdflow_app_header">
                                                        <GripVertical
                                                            size={20}
                                                            color="#64748b"
                                                            className="cf_workdflow_app_header_grip"
                                                        />
                                                        <img
                                                            src={cloudImageMapper(data?.providerName, data?.externalProviderName)}
                                                            alt="cloud"
                                                        />
                                                        <div>
                                                            <p style={{ fontWeight: "500", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                                {getCloudName(data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName)}
                                                            </p>
                                                            <p
                                                                style={{
                                                                    fontWeight: "500",
                                                                    fontSize: "12px",
                                                                    color: "#64748b",
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                    whiteSpace: "nowrap",
                                                                    width: "204px"
                                                                }}
                                                                title={data?.adminEmail}
                                                            >
                                                                {data?.adminEmail}
                                                            </p>
                                                        </div>
                                                        {
                                                            userActionRequired?.includes(data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName)
                                                                || !onBoardWithOutLicense.includes(data?.providerName)
                                                                || isGroupUserManagementExist.includes(data?.providerName) ?
                                                                <div
                                                                    style={{ marginLeft: "auto" }}
                                                                    className="CF_d-flex ai-center CF_Pointer"
                                                                    onClick={() => {
                                                                        if (
                                                                            currentTriggerItem?.currentApplication
                                                                                ?.adminCloudId === data?.id
                                                                        ) {
                                                                            setCurrentTriggerItem(null);
                                                                        } else {
                                                                            setCurrentTriggerItem({
                                                                                currentApplication: {
                                                                                    ...data,
                                                                                    adminCloudId: data?.id,
                                                                                },
                                                                            });
                                                                        }
                                                                    }}
                                                                >
                                                                    <ChevronDown
                                                                        size={20}
                                                                        color="#64748b"
                                                                        style={{
                                                                            transform:
                                                                                currentTriggerItem?.currentApplication
                                                                                    ?.adminCloudId === data?.id
                                                                                    ? "rotate(180deg)"
                                                                                    : "rotate(0deg)",
                                                                            transition: "all 0.3s ease",
                                                                        }}
                                                                    />
                                                                </div> : ""
                                                        }
                                                    </div>
                                                    {currentTriggerItem?.currentApplication
                                                        ?.adminCloudId === data?.id && (
                                                            <div
                                                                style={{
                                                                    width: "100%",
                                                                    padding: "5px",
                                                                    borderTop: "1px solid #e2e8f0",
                                                                    paddingTop: "0",
                                                                }}
                                                            >

                                                                {data?.providerName === "CURSOR_AI" && (
                                                                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "30px" }}>
                                                                        <TextInput
                                                                            type="text"
                                                                            autoFocus={true}
                                                                            inputWidth="100%"
                                                                            defaultValue={cursorAiInviteLink}
                                                                            inputName="domainName"
                                                                            placeHolder={"Invite Link *"}
                                                                            getInputText={(val) => setCursorAiInviteLink(val)}
                                                                        />
                                                                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                                                            <ActionButton
                                                                                customClass={`changeButtonColorOnHover cf_button_gradient ${cursorAiInviteLink?.length === 0 ? "cf_disabled" : ""}`}
                                                                                buttonType="button"
                                                                                customStyles={{
                                                                                    backgroundColor: "#f2f2f2",
                                                                                }}
                                                                                isDisabled={cursorAiInviteLink?.length === 0}
                                                                                buttonClickAction={() => saveCusrsorInviteLink()}
                                                                            >
                                                                                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                                                                    <span style={{ fontSize: "12px" }}>Save</span>
                                                                                </div>
                                                                            </ActionButton>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {(hasLicenseManagement && !onBoardWithOutLicense.includes(data?.providerName)) && (
                                                                    <>
                                                                        <FlowLicenseSelector
                                                                            appName={
                                                                                currentTriggerItem?.currentApplication
                                                                                    ?.providerName === "OTHERS" ? currentTriggerItem?.currentApplication
                                                                                    ?.externalProviderName : currentTriggerItem?.currentApplication
                                                                                    ?.providerName
                                                                            }
                                                                            appId={
                                                                                currentTriggerItem?.currentApplication
                                                                                    ?.adminCloudId
                                                                            }
                                                                            licenseMap={
                                                                                licenseInfoMap[
                                                                                `${currentTriggerItem?.currentApplication
                                                                                    ?.providerName === "OTHERS" ? currentTriggerItem?.currentApplication
                                                                                    ?.externalProviderName : currentTriggerItem?.currentApplication
                                                                                    ?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`
                                                                                ]
                                                                            }
                                                                            isLicenseLoaded={isLoaded?.license}
                                                                            handleLicenseSelection={handleLicenseSelection}
                                                                            selectedLicenses={
                                                                                selectedAppMap[`${currentTriggerItem?.currentApplication
                                                                                    ?.providerName === "OTHERS" ? currentTriggerItem?.currentApplication
                                                                                    ?.externalProviderName : currentTriggerItem?.currentApplication
                                                                                    ?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`]?.LICENSES || []
                                                                            }
                                                                        />
                                                                    </>
                                                                )}
                                                                {hasGroupManagement && (
                                                                    <FlowGroupsSelector
                                                                        currentApplication={currentTriggerItem?.currentApplication}
                                                                        appName={
                                                                            currentTriggerItem?.currentApplication
                                                                                ?.providerName
                                                                        }
                                                                        appId={
                                                                            currentTriggerItem?.currentApplication
                                                                                ?.adminCloudId
                                                                        }
                                                                        groupsList={groupsList}
                                                                        isGroupsLoaded={isLoaded?.group}
                                                                        handleGroupsSelection={handleGroupsSelection}
                                                                        searchGroupsList={searchGroupsList}
                                                                        searchValue={searchValue}
                                                                        searchTeamsGroupsList={searchTeamsGroupsList}
                                                                        selectedGroups={
                                                                            selectedAppMap[
                                                                                `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`
                                                                            ]?.GROUPS || []
                                                                        }
                                                                    />
                                                                )}
                                                                {userActionRequired?.includes(
                                                                    currentTriggerItem?.currentApplication
                                                                        ?.providerName
                                                                ) && (
                                                                        <div
                                                                            className="cf_onboard_cloudSelect_userOptions"
                                                                            style={{ padding: "20px 0" }}
                                                                        >
                                                                            <OnBoardHandleUserOptions
                                                                                currentProvider={currentTriggerItem?.currentApplication}
                                                                                infoMap={userInfoMap}
                                                                                selectMap={selectedUserInfoMap}
                                                                                handleSelectFromMultiList={
                                                                                    handleSelectFromMultiList
                                                                                }
                                                                                keyToCheck={`${currentTriggerItem?.currentApplication
                                                                                    ?.providerName === "OTHERS" ? currentTriggerItem?.currentApplication
                                                                                    ?.externalProviderName : currentTriggerItem?.currentApplication
                                                                                    ?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`}
                                                                                setSelectedUserInfoMapInternal={
                                                                                    setSelectedUserInfoMapInternal
                                                                                }
                                                                            />
                                                                        </div>
                                                                    )}
                                                            </div>
                                                        )}
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        </>
                    )}
                    {
                        currentElement === "EXISTING_TEMPLATE" && (
                            <div className="cf_workdflow_action_item_container">
                                <p className="cf_sub_heading"
                                    style={{
                                        color: "#64748b",
                                        fontWeight: "500",
                                        fontSize: "14px",
                                    }}>
                                    Select Existing Template
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
                                    inputPlaceHolder={`Search By Template`}
                                    defaultValue={searchValues}
                                    onInputSearch={(e) =>
                                        setSearchValues(e.searchInput)
                                    }
                                />
                                {<div style={{ paddingBottom: "10px" }}>
                                    {templatesList?.length > 0 ? (
                                        templatesList
                                            ?.reverse()
                                            ?.filter((template) =>
                                                searchValues
                                                    ? template?.conditionValue
                                                        ?.toLowerCase()
                                                        ?.includes(searchValues?.toLowerCase())
                                                    : template
                                            )
                                            ?.filter(
                                                (template) =>
                                                    !selectedTemplatesList?.includes(
                                                        template?.conditionValue
                                                    )
                                            )?.filter((template) => {
                                                if (templateView === "CUSTOM") {
                                                    return !template?.conditionValue;
                                                }
                                                if (templateView === "ONLY_TEMPLATE") {
                                                    return template?.conditionValue;
                                                }
                                                return true;
                                            })
                                            ?.map((template) => (
                                                <div
                                                    draggable={true}
                                                    onDragStart={(e) =>
                                                        handleDragStart(e, {
                                                            action: "ASSIGN_TEMPLATE",
                                                            id: template?.id,
                                                            workFlowName: template?.workFlowName,
                                                            name: template?.workFlowName,
                                                            templateObject: template,
                                                        })
                                                    }
                                                    key={template?.id + "TEMPLATE"}
                                                    className="cf_workdflow_app_container"
                                                >
                                                    <div className="cf_workdflow_app_header">
                                                        <GripVertical
                                                            size={20}
                                                            color="#64748b"
                                                            className="cf_workdflow_app_header_grip"
                                                        />
                                                        <FileText size={20} color="#8b5cf6" />
                                                        <div>
                                                            <p style={{ fontWeight: "500", fontSize: "12px" }}>
                                                                {template?.templetName || template?.conditionValue || "Unnamed Template"}
                                                            </p>
                                                            {template?.description && (
                                                                <p
                                                                    style={{
                                                                        fontWeight: "400",
                                                                        fontSize: "11px",
                                                                        color: "#64748b",
                                                                    }}
                                                                >
                                                                    {template?.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                    ) : (
                                        <p style={{ padding: "10px", color: "#64748b" }}>
                                            No templates available
                                        </p>
                                    )}
                                </div>
                                }
                            </div>
                        )
                    }
                </div>
            </div>
            {(editObject) && (
                <div
                    style={{ width: "100%", height: "45px" }}
                    className="CF_d-flex ai-center"
                >
                    <span style={{ marginLeft: "auto" }}></span>
                    <ActionButton
                        buttonType="button"
                        customClass="changeButtonColorOnHover cf_newBox_Shadow"
                        customStyles={{
                            backgroundColor: "#fff",
                            height: "35px",
                            width: "60px",
                        }}
                        buttonClickAction={() => {
                            handleSaveEditObject();
                        }}
                    >
                        <p>Save</p>
                    </ActionButton>
                </div>
            )}
        </div>
    )
}

export default WorkFlowActionPannel;