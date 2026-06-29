import {
  BriefcaseBusiness,
  Building,
  ChevronDown,
  FileText,
  GripVertical,
  MapPin,
  UserPlus,
  X,
} from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  getCloudName,
  MANUAL_USER_CREATION_VENDORS,
  onBoardCloudsList,
} from "../../../helpers/helpers";
import {
  isGroupUserManagementExist,
  onBoardFields,
  onBoardWithOutLicense,
  userActionRequired,
} from "../../../helpers/utils";
import {
  getLicensesList,
  getSaaSGroupsData,
  getVendorSearch,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import FlowGroupsSelector from "../FlowGroupsSelector";
import FlowLicenseSelector from "../FlowLicenseSelector";
import OnBoardHandleUserOptions from "../../UserManagement/OnBoard/OnBoardHandleUserOptions";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getRolesInternal } from "../utils/workflowUtils";
import MultiSelectInputDropDown from "../../../Resuables/InputsComponents/MultiSelectInputDropDown";
import { getUniqueUsersList } from "../../Dashboard/DashboardActions/DashboardActions";
import TextInput from "../../../Resuables/InputsComponents/TextInput";

const CustomTemplateActionPannel = ({
  isApprovalEmailOpen = false,
  setIsApprovalEmailOpen = () => { },
  isGoogleWorkspaceDataTransferOpen = false,
  setIsGoogleWorkspaceDataTransferOpen = () => { },
  googleWorkSpaceDataTransferEmail = null,
  setGoogleWorkSpaceDataTransferEmail = () => { },
  approvalEmail = null,
  setApprovalEmail = () => { },
  editObject = null,
  handleSaveApplicationEditObject = () => { },
  licenseInfoMap = {},
  setLicenseInfoMap = () => { },
  isPopupOpen,
  workFlowJSON = {},
  setIsPopupOpen = () => { },
  currentRole = null,
  currentLocation = null,
  enableOptionsList = [],
  selectedApplicationList = [],
  actionsList = {},
  initialElement = null,
  templatesList = [],
  isTemplatesLoading = false,
  selectedTemplatesList = [],
  fetchTemplatesInternal = () => { },
  offboarding = false
}) => {
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [currentElement, setCurrentElement] = useState(null);
  const [currentTriggerItem, setCurrentTriggerItem] = useState(null);
  const [isLicenseLoaded, setIsLicenseLoaded] = useState(false);
  const [hasGroupManagement, setHasGroupManagement] = useState(false);
  const [hasLicenseManagement, setHasLicenseManagement] = useState(false);
  const [isGroupsLoaded, setIsGroupsLoaded] = useState(false);
  const [groupsList, setGroupsList] = useState([]);
  const [selectedAppMap, setSelectedAppMap] = useState({});
  const [searchValue, setSearchValue] = useState(null);
  const [searchGroupsList, setSearchGroupsList] = useState([]);
  const [userInfoMap, setUserInfoMap] = useState({});
  const [selectedUserInfoMap, setSelectedUserInfoMap] = useState({});
  const [userList, setUserList] = useState([]);
  const [pendingApprovalEmail, setPendingApprovalEmail] = useState(null);
  const [cursorAiInviteLink, setCursorAiInviteLink] = useState(null);
  const [pendingGoogleWorkspaceDataTransferEmail, setPendingGoogleWorkspaceDataTransferEmail] = useState(null);
  const [searchValues, setSearchValues] = useState({
    location: null,
    title: null,
    department: null,
    application: null,
  });

  // Context-aware key so department app and location app don't share LICENSES/GROUPS
  const getAppMapKey = (providerName, adminCloudId, editObj = null) => {
    const base = `${providerName}|${adminCloudId}`;
    if (!editObj) return base;
    if (editObj?.parentType === "DEPARTMENT") return `${base}|DEPARTMENT`;
    if (editObj?.role != null && editObj?.location != null)
      return `${base}|${editObj.role}|${editObj.location}`;
    return base;
  };

  const triggerEvents = [
    {
      id: "USER_CREATED",
      name: "User Created",
    },
  ];
  const [departmentList] = useState([
    {
      id: "1",
      name: "Sales",
      icon: "📈",
    },
    {
      id: "2",
      name: "Marketing",
      icon: "📢",
    },
    {
      id: "3",
      name: "IT",
      icon: "💻",
    },
    {
      id: "4",
      name: "HR",
      icon: "👥",
    },
    {
      id: "5",
      name: "Finance",
      icon: "💰",
    },
    {
      id: "6",
      name: "Operations",
      icon: "⚙️",
    },
    {
      id: "7",
      name: "Customer Support",
      icon: "🎧",
    },
    {
      id: "8",
      name: "Engineering",
      icon: "🔧",
    },
  ]);

  const [roleList, setRoleList] = useState([]);

  const [locationList, setLocationList] = useState([]);

  const TEMPLATES_CONDITION_VALUES_KEY = "workflowTemplatesConditionValues";

  const getStoredConditionValues = () => {
    try {
      return JSON.parse(localStorage.getItem(TEMPLATES_CONDITION_VALUES_KEY) || "[]");
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (currentElement === "EXISTING_TEMPLATE") {
      fetchTemplatesInternal();
    }
  }, [currentElement])

  useEffect(() => {
    if (actionsList["titles"]) {
      let titlesList = actionsList["titles"]?.reduce((acc, curr) => {
        if (curr) {
          acc.push({
            id: curr?.replaceAll(" ", "_"),
            name: curr,
          });
        }
        return acc;
      }, []);
      setRoleList(titlesList);
    }
    if (actionsList["locations"]) {
      let locationsList = actionsList["locations"]?.reduce((acc, curr) => {
        if (curr) {
          acc.push({
            id: curr?.replaceAll(" ", "_"),
            name: curr,
          });
        }
        return acc;
      }, []);
      setLocationList(locationsList);
    }
  }, [actionsList]);

  const [actionType] = useState([
    {
      id: "DEPARTMENT_BASED_ACTION",
      name: "Department Based Action",
      icon: <Building size={20} color="#64748b" />,
      description: "Add actions based on department",
    },
    {
      id: "ONBOARD_TO_APPLICATIONS",
      name: "Onboard To Applications",
      icon: <UserPlus size={20} color="#64748b" />,
      description: "Add users to selected applications",
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
      id: "EXISTING_TEMPLATE",
      name: "Choose Existing Template",
      icon: <FileText size={20} color="#64748b" />,
      description: "Choose an existing template to add actions",
    },
  ]);

  useEffect(() => {
    if (isPopupOpen) {
      setCurrentTriggerItem(null);
      setSelectedAppMap({});
      setCurrentElement(initialElement || null);
      setIsLicenseLoaded(false);
      setIsGroupsLoaded(false);
      setGroupsList([]);
      setSearchValue(null);
      setSearchGroupsList([]);
      setLicenseInfoMap({});
      setHasGroupManagement(false);
      setHasLicenseManagement(false);
    }
  }, [isPopupOpen, initialElement]);

  const fetchLicenses = async () => {
    let appName = currentTriggerItem?.currentApplication?.providerName;
    let appId = currentTriggerItem?.currentApplication?.id;
    if (editObject) {
      appId = currentTriggerItem?.currentApplication?.adminCloudId;
    }
    let mappedLicense = `${appName}|${appId}`;
    if (licenseInfoMap[mappedLicense]) {
      return;
    }
    setIsLicenseLoaded(true);
    let res = await getLicensesList("", appName, appId);

    if (res?.status === "OK") {
      setIsLicenseLoaded(false);
      setLicenseInfoMap((prev) => ({
        ...prev,
        [mappedLicense]: res?.res,
      }));
    } else {
      setIsLicenseLoaded(false);
    }
  };

  const fetchGroups = async () => {
    setIsGroupsLoaded(true);
    setGroupsList([]);
    let appId = currentTriggerItem?.currentApplication?.id;
    if (editObject) {
      appId = currentTriggerItem?.currentApplication?.adminCloudId;
    }
    let res = await getSaaSGroupsData(
      appId,
      currentTriggerItem?.currentApplication?.providerName,
      0,
      10,
      currentTriggerItem?.currentApplication?.ssoAppId
    );
    if (res?.status === "OK" && res?.res) {
      setGroupsList(res?.res);
      setIsGroupsLoaded(false);
    } else {
      setGroupsList([]);
      setIsGroupsLoaded(false);
    }
  };

  const searchDebounce = useRef(null);
  const searchTeamsGroupsList = async (e) => {
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e.length > 0) {
      setSearchValue(e);
      searchDebounce.current = setTimeout(async () => {
        searchTeamsGroups(e);
      }, 500);
    } else {
      setSearchValue(null);
    }
  };
  const searchTeamsGroups = async (searchValue) => {
    setIsGroupsLoaded(true);
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
      setIsGroupsLoaded(false);
      setSearchGroupsList(res?.res?.groupDtos || []);
    } else {
      setSearchValue(null);
      setSearchGroupsList([]);
      setIsGroupsLoaded(false);
    }
  };

  useEffect(() => {
    if (
      currentTriggerItem?.currentApplication?.id &&
      currentElement === "ONBOARD_TO_APPLICATIONS"
    ) {
      setCursorAiInviteLink(currentTriggerItem?.currentApplication?.deltaUsersUrl);
      if (
        !onBoardWithOutLicense.includes(
          currentTriggerItem?.currentApplication?.providerName
        )
      ) {
        setHasLicenseManagement(true);
        fetchLicenses();
      }
      if (isGroupUserManagementExist.includes(currentTriggerItem?.currentApplication?.providerName)) {
        setHasGroupManagement(true);
        fetchGroups();
      }
    }
  }, [currentTriggerItem]);

  const handleLicenseSelection = (e, data) => {
    let mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;

    if (editObject) {
      mapper = getAppMapKey(
        currentTriggerItem?.currentApplication?.providerName,
        currentTriggerItem?.currentApplication?.adminCloudId,
        editObject
      );
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
      mapper = getAppMapKey(
        currentTriggerItem?.currentApplication?.providerName,
        currentTriggerItem?.currentApplication?.adminCloudId,
        editObject
      );
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

  const handleDragStart = (e, data) => {
    e.dataTransfer.setData("json", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
  };

  const setSelectedUserInfoMapInternal = (infoMap) => {
    setUserInfoMap(infoMap);
  };

  const handleSelectFromMultiList = (e, eData, action, type, cloudInfo) => {
    let mapId = `${cloudInfo?.providerName === "OTHERS" ? cloudInfo?.externalProviderName : cloudInfo?.providerName}|${cloudInfo?.id}`;

    if (editObject) {
      mapId = getAppMapKey(
        cloudInfo?.providerName === "OTHERS" ? cloudInfo?.externalProviderName : cloudInfo?.providerName,
        cloudInfo?.adminCloudId || cloudInfo?.id,
        editObject
      );
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


  useEffect(() => {
    if (editObject) {
      setCurrentTriggerItem({
        currentApplication: editObject?.application?.currentApplication,
      });
      setCurrentElement("ONBOARD_TO_APPLICATIONS");
      setCursorAiInviteLink(editObject?.application?.currentApplication?.deltaUsersUrl);
      if (
        userActionRequired?.includes(
          editObject?.application?.currentApplication?.providerName
        ) &&
        (editObject?.application?.roles?.length > 0 ||
          editObject?.application?.commonName)
      ) {
        checkForCustomRoles(
          onBoardFields[
          editObject?.application?.currentApplication?.providerName
          ]
        );
      }

      const mapKey = getAppMapKey(
        editObject?.application?.currentApplication?.providerName,
        editObject?.application?.currentApplication?.adminCloudId,
        editObject
      );
      setSelectedAppMap({
        [mapKey]: {
          LICENSES: editObject?.application?.LICENSES,
          GROUPS: editObject?.application?.GROUPS,
        },
      });
    }
  }, [editObject]);

  const checkForCustomRoles = async (e) => {
    let res = await getRolesInternal(
      e.reduce((acc, res) => {
        acc.push(res?.id);
        return acc;
      }, []),
      cloudsList?.find(
        (cloud) =>
          cloud?.providerName ===
          editObject?.application?.currentApplication?.providerName
      ),
      getAppMapKey(
        editObject?.application?.currentApplication?.providerName,
        editObject?.application?.currentApplication?.adminCloudId,
        editObject
      )
    );
    if (res) {
      setUserInfoMap(res);
      let selMap = {};
      let map = getAppMapKey(
        editObject?.application?.currentApplication?.providerName,
        editObject?.application?.currentApplication?.adminCloudId,
        editObject
      );
      e.forEach((rol) => {
        let rolMap = selMap[map] || {};
        if (rol.id === "CUSTOM_ACTION") {
          rolMap[rol?.id] = [
            res[map]?.[rol?.id]?.find(
              (res1) => res1?.id === editObject?.application?.commonName
            ) || null,
          ];
        } else {
          rolMap[rol?.id] = [
            res[map]?.[rol?.id]?.find((res1) =>
              editObject?.application?.roles?.includes(res1?.id)
            ) || null,
          ];
        }
        selMap[map] = rolMap;
      });
      setSelectedUserInfoMap(selMap);
    }
  };

  const handleSaveEditObject = () => {
    if (isApprovalEmailOpen) {
      setApprovalEmail(pendingApprovalEmail);
      setIsPopupOpen(false);
      setIsApprovalEmailOpen(false);
      return;
    }
    if (isGoogleWorkspaceDataTransferOpen) {
      setGoogleWorkSpaceDataTransferEmail(pendingGoogleWorkspaceDataTransferEmail);
      setIsPopupOpen(false);
      setIsGoogleWorkspaceDataTransferOpen(false);
      return;
    }
    let editApplication = editObject?.application || {};
    let mapObj = getAppMapKey(
      editObject?.application?.currentApplication?.providerName,
      editObject?.application?.currentApplication?.adminCloudId,
      editObject
    );

    const licList =
      selectedAppMap[mapObj]?.LICENSES?.map((lic) => ({
        id: lic?.id,
        planName: lic?.planName,
        planId: lic?.planId,
      })) || [];

    const groupList =
      selectedAppMap[mapObj]?.GROUPS?.map((group) => ({
        groupId: group?.groupId,
        groupName: group?.groupName,
      })) || [];

    editApplication.LICENSES = licList;
    editApplication.GROUPS = groupList;
    editApplication.roles = Object.values(selectedUserInfoMap[mapObj] || {})
      .flat()
      ?.reduce((acc, curr) => {
        if (curr?.roleFor !== "CUSTOM_ACTION") {
          acc.push(curr?.id);
        }
        return acc;
      }, []);
    editApplication.commonName =
      Object.values(selectedUserInfoMap[mapObj] || {})
        .flat()
        ?.find((curr) => curr?.roleFor === "CUSTOM_ACTION")?.id || null;

    editObject.application = editApplication;
    handleSaveApplicationEditObject(editObject);
  };

  useEffect(() => {
    if (isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen) {
      setCurrentElement("APPROVAL_EMAIL");
    }
  }, [isApprovalEmailOpen, isGoogleWorkspaceDataTransferOpen]);

  useEffect(() => {
    if (isApprovalEmailOpen) {
      setPendingApprovalEmail(approvalEmail);
    }
    if (isGoogleWorkspaceDataTransferOpen) {
      setPendingGoogleWorkspaceDataTransferEmail(googleWorkSpaceDataTransferEmail);
    }
  }, [isApprovalEmailOpen, isGoogleWorkspaceDataTransferOpen, approvalEmail, googleWorkSpaceDataTransferEmail]);

  const getUserList = async () => {
    let res = await getUniqueUsersList(1, 20, isGoogleWorkspaceDataTransferOpen ? "GOOGLE_WORKSPACE" : "ALL");
    if (res?.status === "OK") {
      setUserList(res?.res?.data);
      return true;
    }
  };

  const searchUsers = async (searchValue) => {
    let res = await getVendorSearch(
      "UNIQUUSERSSEARCH",
      "unqusers",
      searchValue?.trim()?.toLowerCase(),
      false,
      isGoogleWorkspaceDataTransferOpen ? "GOOGLE_WORKSPACE" : "ALL"
    );
    if (res?.status === "OK") {
      if (res?.res?.data?.length > 0) {
        setUserList(res?.res?.data);
        return true;
      }
    } else {
      return false;
    }
  };

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
      {/* Header with Close Button */}
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
          height: editObject || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen ? "calc(100% - 45px - 45px)" : "calc(100% - 45px)",
          overflowY: "auto",
          flex: 1,
        }}
      >
        {(isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen) && (
          <div className="cf_workdflow_action_item_container">
            <p className="cf_sub_heading">
              {isApprovalEmailOpen ? "Approval Email" : "Google Workspace Data Transfer Email"}
            </p>
            <MultiSelectInputDropDown
              parentStyle={{ maxWidth: "100%" }}
              childrenStyle={{ maxWidth: "300px" }}
              loadAction={() => getUserList()}
              displayFields={["email"]}
              suggestedData={userList}
              searchAction={searchUsers}
              selectedData={isApprovalEmailOpen ? pendingApprovalEmail ? [{
                email: pendingApprovalEmail,
              }] : [] : isGoogleWorkspaceDataTransferOpen ? pendingGoogleWorkspaceDataTransferEmail ? [{
                email: pendingGoogleWorkspaceDataTransferEmail?.email,
              }] : [] : []}
              options={{
                inputType: "radio",
                inputName: "EMAIL",
                name: "Email",
              }}
              handleSelection={(e, data) => isApprovalEmailOpen ? setPendingApprovalEmail(data?.email) : setPendingGoogleWorkspaceDataTransferEmail(data)}
            />
          </div>
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
                defaultValue={searchValues?.template}
                onInputSearch={(e) =>
                  setSearchValues({
                    ...searchValues,
                    template: e.searchInput,
                  })
                }
              />
              {isTemplatesLoading ? (
                <p style={{ padding: "10px", color: "#64748b" }}>
                  Loading templates...
                </p>
              ) : (
                <div style={{ paddingBottom: "10px" }}>
                  {templatesList?.length > 0 ? (
                    templatesList
                      ?.reverse()
                      ?.filter((template) =>
                        searchValues?.template
                          ? template?.conditionValue
                            ?.toLowerCase()
                            ?.includes(searchValues?.template?.toLowerCase())
                          : template
                      )
                      ?.filter(
                        (template) =>
                          !selectedTemplatesList?.includes(
                            template?.conditionValue
                          ) && !template?.conditionValue
                      )
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
                                {template?.templetName || "Unnamed Template"}
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
              )}
            </div>
          )
        }

        {(workFlowJSON?.departMentName || !workFlowJSON?.departMentName) &&
          currentElement === "ROLE_BASED_ACTION" && (
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
                defaultValue={searchValues?.title}
                onInputSearch={(e) =>
                  setSearchValues({ ...searchValues, title: e.searchInput })
                }
              />
              {[
                ...roleList
                  ?.filter((res) => {
                    if (searchValues?.title) {
                      return res?.name
                        ?.toLowerCase()
                        .includes(searchValues?.title?.toLowerCase());
                    }
                    return true;
                  })
                  ?.filter(
                    (res) => !workFlowJSON?.rolesList?.includes(res?.name)
                  ),
                ...(workFlowJSON?.rolesList?.includes("Title Not Met") ||
                  workFlowJSON?.rolesList?.includes("TITLE_NOT_MET")
                  ? []
                  : [
                    {
                      id: "TITLE_NOT_MET",
                      name: "Title Not Met",
                    },
                  ]),
              ].map((res) => {
                return (
                  <div
                    draggable={true}
                    onDragStart={(e) =>
                      handleDragStart(e, {
                        action: "SELECT_ROLE",
                        role: res?.name,
                      })
                    }
                    key={res?.id || res?.name + "ROLE"}
                    className="cf_workdflow_app_container"
                  >
                    <div className="cf_workdflow_app_header">
                      <GripVertical
                        size={20}
                        color="#64748b"
                        className="cf_workdflow_app_header_grip"
                      />
                      <div className="cf_workdflow_action_item_icon">
                        {res?.id === "TITLE_NOT_MET" ? (
                          <X size={20} color="#64748b" />
                        ) : (
                          <BriefcaseBusiness size={20} color="#64748b" />
                        )}
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
                defaultValue={searchValues?.location}
                onInputSearch={(e) =>
                  setSearchValues({ ...searchValues, location: e.searchInput })
                }
              />
              {[
                ...locationList
                  ?.filter((res) => {
                    if (currentRole) {
                      const roleLocations =
                        workFlowJSON?.actions?.[currentRole]?.locationsList ||
                        [];
                      return !roleLocations.includes(res?.name);
                    } else if (workFlowJSON?.departMentName) {
                      const departmentLocations =
                        workFlowJSON?.locationsList || [];
                      return !departmentLocations.includes(res?.name);
                    }
                    return true;
                  })
                  ?.filter((res) => {
                    if (searchValues?.location) {
                      return res?.name
                        ?.toLowerCase()
                        .includes(searchValues?.location?.toLowerCase());
                    }
                    return true;
                  }),
                ...(() => {
                  // Check if Location Not Met is already selected
                  let isLocationNotMetSelected = false;
                  if (currentRole) {
                    const roleLocations =
                      workFlowJSON?.actions?.[currentRole]?.locationsList || [];
                    isLocationNotMetSelected =
                      roleLocations.includes("Location Not Met") ||
                      roleLocations.includes("LOCATION_NOT_MET");
                  } else if (workFlowJSON?.departMentName) {
                    const departmentLocations =
                      workFlowJSON?.locationsList || [];
                    isLocationNotMetSelected =
                      departmentLocations.includes("Location Not Met") ||
                      departmentLocations.includes("LOCATION_NOT_MET");
                  }
                  return isLocationNotMetSelected
                    ? []
                    : [
                      {
                        id: "LOCATION_NOT_MET",
                        name: "Location Not Met",
                      },
                    ];
                })(),
              ].map((res) => {
                return (
                  <div
                    draggable={true}
                    onDragStart={(e) =>
                      handleDragStart(e, {
                        action: "SELECT_LOCATION",
                        location: res,
                        currentRole: currentRole,
                      })
                    }
                    key={res?.id || res?.name + "LOCATION"}
                    className="cf_workdflow_app_container"
                  >
                    <div className="cf_workdflow_app_header">
                      <GripVertical
                        size={20}
                        color="#64748b"
                        className="cf_workdflow_app_header_grip"
                      />
                      <div className="cf_workdflow_action_item_icon">
                        {res?.id === "LOCATION_NOT_MET" ? (
                          <X size={20} color="#64748b" />
                        ) : (
                          <MapPin size={20} color="#64748b" />
                        )}
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
          </>
        )}

        {currentElement === null &&
          (workFlowJSON?.departMentName ||
            (!workFlowJSON?.departMentName &&
              (workFlowJSON?.rolesList?.length === 0 ||
                enableOptionsList?.length > 0))) ? (
          <div className="cf_workdflow_action_item_container">
            {actionType
              ?.filter((res) => {
                if (enableOptionsList?.length > 0) {
                  return enableOptionsList?.includes(res?.id);
                }
                if (res?.id === "DEPARTMENT_BASED_ACTION") {
                  return !workFlowJSON?.departMentName;
                }
                return true;
              })
              .map((res) => {
                return (
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
                      if (res?.id !== "IF_ELSE") {
                        setCurrentElement(res?.id);
                        setSearchValues({
                          title: null,
                          location: null,
                        });
                      }
                    }}
                    key={res?.id}
                  >
                    {res?.id === "IF_ELSE" ? (
                      <GripVertical
                        size={20}
                        color="#64748b"
                        className="cf_workdflow_app_header_grip"
                      />
                    ) : (
                      ""
                    )}
                    <div className="cf_workdflow_action_item_icon">
                      {res?.icon}
                    </div>
                    <div className="cf_workdflow_action_item_content">
                      <p
                        style={{
                          color: "#0f1729",
                          fontWeight: "500",
                          lineHeight: "1",
                          marginTop: "4px",
                        }}
                      >
                        {res?.name}
                      </p>
                      <p
                        className="cf_sub_heading"
                        style={{ fontWeight: "400" }}
                      >
                        {res?.description}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          ""
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
              defaultValue={searchValues?.department}
              onInputSearch={(e) =>
                setSearchValues({ ...searchValues, department: e.searchInput })
              }
            />
            {[
              ...departmentList?.filter((res) => {
                const storedConditionValues = getStoredConditionValues();
                if (storedConditionValues.includes(res?.name)) {
                  return false;
                }
                if (searchValues?.department) {
                  return res?.name
                    ?.toLowerCase()
                    .includes(searchValues?.department?.toLowerCase());
                }
                return true;
              }),
            ]?.map((data) => {
              return (
                <div
                  draggable={true}
                  onDragStart={(e) =>
                    handleDragStart(e, {
                      action: "SELECT_DEPARTMENT",
                      department: data,
                    })
                  }
                  key={data?.id || data?.name + "DEPT"}
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
                        {data?.name}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
                defaultValue={searchValues?.application}
                onInputSearch={(e) =>
                  setSearchValues({
                    ...searchValues,
                    application: e.searchInput,
                  })
                }
              />
              <div style={{ paddingBottom: "10px" }}>
                {cloudsList?.filter((data) => {
                  return onBoardCloudsList.includes(data?.providerName) || (data?.providerName === "ATLASSIAN" && data?.ssoAppId) || (data?.providerName === "CURSOR_AI" && data?.deltaUsersUrl);
                })
                  ?.filter((data) =>
                    searchValues?.application
                      ? getCloudName(data?.providerName)
                        ?.toLowerCase()
                        ?.includes(searchValues?.application?.toLowerCase())
                      : data
                  )
                  ?.filter((data) => {
                    if (editObject?.application) {
                      if (
                        editObject?.application?.currentApplication
                          ?.adminCloudId === data?.id
                      ) {
                        return data;
                      }
                    } else {
                      return data;
                    }
                  })
                  .filter((cloud) => {
                    if (editObject?.application?.currentApplication
                      ?.adminCloudId) {
                      return true;
                    }
                    const isAppSelected = (appId) => {
                      if (currentRole) {
                        if (currentLocation) {
                          const locationApps =
                            workFlowJSON?.actions?.[currentRole]?.actions?.[
                            currentLocation
                            ] || [];
                          return locationApps.some(
                            (app) =>
                              (app?.currentApplication?.id || app?.id) === appId
                          );
                        } else {
                          const roleApps =
                            workFlowJSON?.actions?.[currentRole]
                              ?.applicationsList || [];
                          return roleApps.some(
                            (app) =>
                              (app?.currentApplication?.id || app?.id) === appId
                          );
                        }
                      } else if (workFlowJSON?.departMentName) {
                        if (currentLocation) {
                          const locationApps =
                            workFlowJSON?.locationActions?.[currentLocation] ||
                            [];
                          return locationApps.some(
                            (app) =>
                              (app?.currentApplication?.id || app?.id) === appId
                          );
                        } else {
                          const deptApps = workFlowJSON?.applicationsList || [];
                          return deptApps.some(
                            (app) =>
                              (app?.currentApplication?.id || app?.id) === appId
                          );
                        }
                      }
                      return false;
                    };

                    return !isAppSelected(cloud?.id);
                  })?.filter((data) => {
                    if (editObject?.application?.currentApplication
                      ?.adminCloudId) {
                      return true;
                    }
                    return !selectedApplicationList?.includes(data?.providerName);
                  })
                  ?.map((data) => {
                    return (
                      <div
                        draggable={true}
                        onDragStart={(e) =>
                          handleDragStart(e, {
                            action: "ONBOARD_TO_APPLICATIONS",
                            currentApplication: data,
                            currentRole: currentRole,
                            currentLocation: currentLocation,
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
                            <p style={{ fontWeight: "500", fontSize: "12px" }}>
                              {getCloudName(data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName)}
                            </p>
                            <p
                              style={{
                                fontWeight: "500",
                                fontSize: "12px",
                                color: "#64748b",
                                width: "204px"
                              }}
                            >
                              {data?.adminEmail}
                            </p>
                          </div>
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
                            {MANUAL_USER_CREATION_VENDORS.includes(data?.providerName) || offboarding ? "" :
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
                              />}
                          </div>
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
                              {hasLicenseManagement && (
                                <>
                                  <FlowLicenseSelector
                                    appName={
                                      currentTriggerItem?.currentApplication
                                        ?.providerName
                                    }
                                    appId={
                                      currentTriggerItem?.currentApplication
                                        ?.adminCloudId
                                    }
                                    licenseMap={
                                      licenseInfoMap[
                                      `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`
                                      ]
                                    }
                                    isLicenseLoaded={isLicenseLoaded}
                                    handleLicenseSelection={handleLicenseSelection}
                                    selectedLicenses={
                                      selectedAppMap[
                                        editObject
                                          ? getAppMapKey(
                                            currentTriggerItem?.currentApplication?.providerName,
                                            currentTriggerItem?.currentApplication?.adminCloudId,
                                            editObject
                                          )
                                          : `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`
                                      ]?.LICENSES || []
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
                                  isGroupsLoaded={isGroupsLoaded}
                                  handleGroupsSelection={handleGroupsSelection}
                                  searchGroupsList={searchGroupsList}
                                  searchValue={searchValue}
                                  searchTeamsGroupsList={searchTeamsGroupsList}
                                  selectedGroups={
                                    selectedAppMap[
                                      editObject
                                        ? getAppMapKey(
                                          currentTriggerItem?.currentApplication?.providerName,
                                          currentTriggerItem?.currentApplication?.adminCloudId,
                                          editObject
                                        )
                                        : `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`
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
                                      currentProvider={cloudsList?.find(
                                        (cloud) =>
                                          cloud?.id ===
                                          currentTriggerItem?.currentApplication
                                            ?.id ||
                                          cloud?.id ===
                                          currentTriggerItem?.currentApplication
                                            ?.adminCloudId
                                      )}
                                      infoMap={userInfoMap}
                                      selectMap={selectedUserInfoMap}
                                      handleSelectFromMultiList={
                                        handleSelectFromMultiList
                                      }
                                      keyToCheck={editObject
                                        ? getAppMapKey(
                                          currentTriggerItem?.currentApplication?.providerName,
                                          currentTriggerItem?.currentApplication?.adminCloudId,
                                          editObject
                                        )
                                        : `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.adminCloudId}`}
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
      </div>
      {(editObject || isApprovalEmailOpen || isGoogleWorkspaceDataTransferOpen) && (
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
  );
};

export default CustomTemplateActionPannel;
