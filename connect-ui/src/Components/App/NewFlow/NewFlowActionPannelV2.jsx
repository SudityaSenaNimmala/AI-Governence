import { Building, ChevronDown, ChevronLeft, FileText, GripVertical, X } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import MultiSelectInputDropDown from "../../Resuables/InputsComponents/MultiSelectInputDropDown";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import {
  cloudImageMapper,
  getCloudName,
  MANUAL_USER_CREATION_VENDORS,
  onBoardCloudsList,
} from "../../helpers/helpers";
import { isGroupUserManagementExist, notifyToast, onBoardWithOutLicense, userActionRequired } from "../../helpers/utils";
import {
  getLicensesList,
  getSaaSGroupsData,
  getVendorSearch,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import FlowGroupsSelector from "./FlowGroupsSelector";
import FlowLicenseSelector from "./FlowLicenseSelector";
import {
  ACTION_TYPE_CONFIG,
  ACTION_TYPES,
  DEPARTMENT_LIST,
  DIVISION_LIST,
  TRIGGER_EVENTS,
} from "./constants/workflowConstants";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import OnBoardHandleUserOptions from "../UserManagement/OnBoard/OnBoardHandleUserOptions";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import TextInputUpdate from "../../Resuables/InputsComponents/TextInputUpdate";
import { updateSaaSVendor } from "../Oauth/OauthActions/OauthApiActions";

const NewFlowActionPannelV2 = ({
  flowActionsList = {},
  licenseInfoMap = {},
  setLicenseInfoMap = () => { },
  isPopupOpen = false,
  setIsPopupOpen = () => { },
  currentAction = null,
  viewActionList = ["TRIGGER"],
  actionsList = [],
  selectedDivisionsList = [],
  handleAddToFlow = () => { },
  currentDepartment = null,
  selectedApplicationList = [],
  selectedDepartmentList = [],
  editedAction = null,
  setEditedAction = () => { },
  selectedApplicaionsBasedOnDepartment = [],
  templatesList = [],
  isTemplatesLoading = false,
  selectedTemplatesList = [],
  editObject = null,
  setIsCreateTemplate = () => { },
  setIsLoading = () => { },
  offboarding = false
}) => {
  console.log(editObject);
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
  const [groupView, setGroupView] = useState(false);
  const [userInfoMap, setUserInfoMap] = useState({});
  const [selectedUserInfoMap, setSelectedUserInfoMap] = useState({});
  const [cursorAiInviteLink, setCursorAiInviteLink] = useState(null);
  const [searchValues, setSearchValues] = useState({
    application: null,
    division: null,
  });
  const [selectedGroupApplication, setSelectedGroupApplication] = useState({
    currentApplication: null,
    groupInfo: {}
  });
  const [divisionsList, setDivisionsList] = useState([]);

  useEffect(() => {
    if (actionsList?.divisions?.length > 0) {
      let divisions = actionsList?.divisions?.reduce((acc, curr) => {
        if (curr && !selectedDivisionsList?.includes(curr)) {
          acc.push({
            id: curr?.replaceAll(" ", "_"),
            name: curr,
          });
        }
        return acc;
      }, []);
      setDivisionsList(divisions);
    }
  }, [actionsList]);

  useEffect(() => {
    if (isPopupOpen) {
      setCurrentTriggerItem(null);
      setSelectedAppMap({});
      setCurrentElement(null);
      setIsLicenseLoaded(false);
      setIsGroupsLoaded(false);
      setGroupsList([]);
      setSearchValue(null);
      setSearchGroupsList([]);
      setLicenseInfoMap({});
      setHasGroupManagement(false);
      setHasLicenseManagement(false);
      if (editedAction) {
        makeEditUI();
      }
    } else {
      setEditedAction(null);
    }
  }, [isPopupOpen]);

  const handleSelectFromMultiList = (e, eData, action, type, cloudInfo) => {
    let mapId = `${cloudInfo?.providerName}|${cloudInfo?.id}`;

    if (editObject) {
      mapId = `${cloudInfo?.providerName}|${cloudInfo?.adminCloudId || cloudInfo?.id
        }`;
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
    const appName = currentTriggerItem?.currentApplication?.providerName;
    const appId = currentTriggerItem?.currentApplication?.id;
    const mappedLicense = `${appName}|${appId}`;

    if (licenseInfoMap[mappedLicense]) {
      return;
    }

    setIsLicenseLoaded(true);
    const res = await getLicensesList("", appName, appId);

    if (res?.status === "OK") {
      setLicenseInfoMap((prev) => ({
        ...prev,
        [mappedLicense]: res?.res,
      }));
    }
    setIsLicenseLoaded(false);
  };

  const fetchGroups = async () => {
    setIsGroupsLoaded(true);
    const res = await getSaaSGroupsData(
      selectedGroupApplication?.currentApplication?.id || currentTriggerItem?.currentApplication?.id,
      selectedGroupApplication?.currentApplication?.providerName || currentTriggerItem?.currentApplication?.providerName,
      0,
      10, selectedGroupApplication?.currentApplication?.ssoAppId || currentTriggerItem?.currentApplication?.ssoAppId
    );
    if (res?.status === "OK" && res?.res) {
      setGroupsList(res?.res);
    }
    setIsGroupsLoaded(false);
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
    const res = await getVendorSearch(
      "",
      "teamgroups",
      encodedSearchValue,
      false,
      selectedGroupApplication?.currentApplication?.providerName || currentTriggerItem?.currentApplication?.providerName,
      selectedGroupApplication?.currentApplication?.id || currentTriggerItem?.currentApplication?.id
    );
    if (res?.status === "OK") {
      setSearchGroupsList(res?.res?.groupDtos || []);
    } else {
      setSearchValue(null);
      setSearchGroupsList([]);
    }
    setIsGroupsLoaded(false);
  };

  useEffect(() => {
    if (
      (currentTriggerItem?.currentApplication?.id &&
        currentElement === "ONBOARD_TO_APPLICATIONS") ||
      (selectedGroupApplication?.currentApplication?.id &&
        currentElement === "SELECT_GROUP")
    ) {
      setCursorAiInviteLink(currentTriggerItem?.currentApplication?.deltaUsersUrl || selectedGroupApplication?.currentApplication?.deltaUsersUrl);
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
      fetchGroups();
    }
  }, [currentTriggerItem, selectedGroupApplication]);

  const handleLicenseSelection = (e, data) => {
    const mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;
    const existingSelectedAppMap = selectedAppMap[mapper]
      ? selectedAppMap[mapper]["LICENSES"] || []
      : [];

    const updatedLicenses = e.target.checked
      ? [...existingSelectedAppMap, data]
      : existingSelectedAppMap.filter((license) => license?.id !== data?.id);

    setSelectedAppMap((prev) => ({
      ...prev,
      [mapper]: {
        ...prev[mapper],
        LICENSES: updatedLicenses,
      },
    }));
  };

  const handleGroupsSelection = (e, data) => {
    if (searchValue && e.target.checked) {
      const cpyGroupsList = groupsList?.groupDtos || [];
      setGroupsList({ ...groupsList, groupDtos: [...cpyGroupsList, data] });
    }

    const mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;
    const existingSelectedAppMap = selectedAppMap[mapper]
      ? selectedAppMap[mapper]["GROUPS"] || []
      : [];

    const updatedGroups = e.target.checked
      ? [...existingSelectedAppMap, data]
      : existingSelectedAppMap.filter(
        (group) => group?.groupId !== data?.groupId
      );

    setSelectedAppMap((prev) => ({
      ...prev,
      [mapper]: {
        ...prev[mapper],
        GROUPS: updatedGroups,
      },
    }));
  };

  const handleAddAction = (action = null) => {
    if (editedAction) {
      const mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;
      handleAddToFlow(
        {
          ...currentTriggerItem,
          action: editedAction?.action,
          ...selectedAppMap[mapper],
        },
        editedAction?.action
      );
    } else {
      if (action === ACTION_TYPES.IF_ELSE) {
        handleAddToFlow([], ACTION_TYPES.IF_ELSE);
      } else {
        let actionEvent = currentElement;

        if (
          flowActionsList[ACTION_TYPES.TRIGGER] &&
          !flowActionsList[ACTION_TYPES.IF_ELSE]
        ) {
          actionEvent = ACTION_TYPES.PRIMARY_APPLICATION;
        }

        if (currentDepartment) {
          actionEvent = currentDepartment;
        }

        const mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;
        handleAddToFlow(
          {
            ...currentTriggerItem,
            action: currentElement,
            ...selectedAppMap[mapper],
          },
          actionEvent
        );
      }
    }
    setIsPopupOpen(false);
    setCurrentElement(null);
    setCurrentTriggerItem(null);
  };

  const handleSelectDepartment = (e, data) => {
    setCurrentTriggerItem({
      ...currentTriggerItem,
      department: data,
      id: data?.name,
      name: data?.name,
    });
  };

  useEffect(() => {
    if (editedAction) {
      makeEditUI();
    }
  }, [editedAction]);

  console.log(editedAction)

  const makeEditUI = () => {
    setIsPopupOpen(true);
    setCurrentElement(editedAction?.action);
    setCurrentTriggerItem(editedAction);
    const mapper = `${editedAction?.currentApplication?.providerName}|${editedAction?.currentApplication?.id}`;
    const selectedAppMap = {
      [mapper]: {
        LICENSES: editedAction?.licenses,
        GROUPS: editedAction?.groups,
      },
    };
    setSelectedAppMap(selectedAppMap);
  };

  const handleDragStart = (e, data) => {
    e.dataTransfer.setData("json", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
  };

  useEffect(() => {
    if (editObject?.currentApplication?.id) {
      setCurrentElement(ACTION_TYPES.ONBOARD_TO_APPLICATIONS);
      setCurrentTriggerItem({
        currentApplication: editObject?.currentApplication,
      });
      const mapper = `${editObject?.currentApplication?.providerName}|${editObject?.currentApplication?.id}`;
      setSelectedAppMap({
        [mapper]: {
          LICENSES: editObject?.LICENSES,
          GROUPS: editObject?.GROUPS,
        },
      });
    }
  }, [editObject]);

  useEffect(() => {
    if (viewActionList?.includes(ACTION_TYPES.SELECT_GROUP)) {
      setCurrentElement(ACTION_TYPES.SELECT_GROUP);
    }
  }, [viewActionList]);

  const setSelectedUserInfoMapInternal = (infoMap) => {
    console.log("infoMap", infoMap);
    setUserInfoMap(infoMap);
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
      <div style={{ width: "100%", height: "calc(100% - 45px)", overflowY: "auto", flex: 1 }}>
        {currentElement === null && (
          <div className="cf_workdflow_action_item_container">
            {ACTION_TYPE_CONFIG?.map((res) => {
              if (!viewActionList?.includes(res?.id)) return null;

              const isIfElse = res?.id === ACTION_TYPES.IF_ELSE;

              return (
                <div
                  draggable={isIfElse}
                  onDragStart={(e) => {
                    if (isIfElse) {
                      handleDragStart(e, {
                        action: res?.id,
                      });
                    }
                  }}
                  className="cf_workdflow_action_item"
                  onClick={() => {
                    if (!isIfElse) {
                      setCurrentElement(res?.id);
                    }
                  }}
                  key={res?.id}
                >
                  {isIfElse && (
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
                        lineHeight: "1",
                        marginTop: "4px",
                      }}
                    >
                      {res?.name}
                    </p>
                    <p className="cf_sub_heading" style={{ fontWeight: "400" }}>
                      {res?.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {currentElement === ACTION_TYPES.DEPARTMENT_BASED_ACTION && (
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
              Select Department
            </p>
            {DEPARTMENT_LIST?.filter(
              (department) => !selectedDepartmentList.includes(department?.name)
            )?.map((data) => (
              <div
                draggable={true}
                onDragStart={(e) =>
                  handleDragStart(e, {
                    action: ACTION_TYPES.SELECT_DEPARTMENT,
                    department: data,
                  })
                }
                key={data?.name + "DEPT"}
                className="cf_workdflow_app_container"
              >
                <div className="cf_workdflow_app_header">
                  <GripVertical
                    size={20}
                    color="#64748b"
                    className="cf_workdflow_app_header_grip"
                  />
                  <div>
                    <p style={{ fontWeight: "500", fontSize: "12px" }}>
                      {data?.name}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {currentElement === ACTION_TYPES.DIVISION_BASED_ACTION && (
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
              defaultValue={searchValues?.division}
              onInputSearch={(e) =>
                setSearchValues({ ...searchValues, division: e.searchInput })
              }
            />
            {[
              ...(divisionsList || DIVISION_LIST)?.filter((res) => {
                if (searchValues?.division) {
                  return res?.name
                    ?.toLowerCase()
                    .includes(searchValues?.division?.toLowerCase());
                }
                return true;
              }),
              ...(selectedDivisionsList?.includes("Division Not Met") ||
                selectedDivisionsList?.includes("DIVISION_NOT_MET")
                ? []
                : [
                  {
                    id: "DIVISION_NOT_MET",
                    name: "Division Not Met",
                  },
                ]),
            ]?.map((data) => (
              <div
                draggable={true}
                onDragStart={(e) =>
                  handleDragStart(e, {
                    action: ACTION_TYPES.SELECT_DIVISION,
                    division: data,
                  })
                }
                key={
                  data?.id === "DIVISION_NOT_MET"
                    ? data?.id
                    : data?.id + "DIVISION"
                }
                className="cf_workdflow_app_container"
              >
                <div className="cf_workdflow_app_header">
                  <GripVertical
                    size={20}
                    color="#64748b"
                    className="cf_workdflow_app_header_grip"
                  />
                  <div className="cf_workdflow_action_item_icon">
                    {data?.id === "DIVISION_NOT_MET" ? (
                      <X size={20} color="#64748b" />
                    ) : (
                      <Building size={20} color="#64748b" />
                    )}
                  </div>
                  <div>
                    <p style={{ fontWeight: "500", fontSize: "12px" }}>
                      {data?.name}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {currentElement === ACTION_TYPES.TRIGGER && (
          <>
            <div
              className="cf_workdflow_cloud_license_item"
              style={{ flexDirection: "column", gap: "4px" }}
            >
              <p
                className="cf_sub_heading"
                style={{
                  color: "#64748b",
                  fontWeight: "500",
                  fontSize: "14px",
                }}
              >
                Primary Application
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
                {cloudsList
                  ?.filter((data) =>
                    searchValues?.application
                      ? getCloudName(data?.providerName)
                        ?.toLowerCase()
                        ?.includes(searchValues?.application?.toLowerCase())
                      : data
                  )
                  ?.filter(
                    (cloud) => {
                      if (currentElement === "TRIGGER") {
                        return true;
                      }
                      return onBoardCloudsList.includes(cloud?.providerName) &&
                        !selectedApplicationList.includes(cloud?.providerName)
                    })
                  ?.map((data) => (
                    <div
                      draggable={true}
                      onDragStart={(e) =>
                        handleDragStart(e, {
                          action: ACTION_TYPES.TRIGGER,
                          currentApplication: data,
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
                          src={cloudImageMapper(data?.providerName)}
                          alt="cloud"
                        />
                        <div>
                          <p style={{ fontWeight: "500", fontSize: "12px" }}>
                            {getCloudName(data?.providerName)}
                          </p>
                          <p
                            style={{
                              fontWeight: "500",
                              fontSize: "12px",
                              color: "#64748b",
                              width: "204px"
                            }}
                            title={data?.adminEmail}
                          >
                            {data?.adminEmail}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            {currentTriggerItem?.currentApplication?.id && (
              <div className="cf_workflow_event_condition_container">
                <p
                  className="cf_sub_heading"
                  style={{ color: "#64748b", fontWeight: "500" }}
                >
                  WHEN
                </p>
                <MultiSelectInputDropDown
                  loadAction={() => true}
                  displayFields={["name"]}
                  options={{
                    inputType: "radio",
                    inputName: "event",
                    name: "Event",
                  }}
                  suggestedData={TRIGGER_EVENTS}
                  selectedData={
                    currentTriggerItem?.event?.id
                      ? [currentTriggerItem?.event]
                      : []
                  }
                  handleSelection={handleSelectFromMultiList}
                  parentStyle={{ maxWidth: "160px", height: "35px" }}
                />
              </div>
            )}
          </>
        )}
        {currentElement === ACTION_TYPES.ONBOARD_TO_APPLICATIONS && (
          <>
            <div
              className="cf_workdflow_cloud_license_item"
              style={{ flexDirection: "column", gap: "4px" }}
            >
              <p
                className="cf_sub_heading"
                style={{
                  color: "#64748b",
                  fontWeight: "500",
                  fontSize: "14px",
                }}
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
              {console.log(selectedApplicationList)}
              <div style={{ paddingBottom: "10px" }}>
                {cloudsList?.filter((data) => {
                  if (currentElement === "TRIGGER") {
                    return true;
                  }
                  return onBoardCloudsList.includes(data?.providerName) || (data?.providerName === "ATLASSIAN" && data?.ssoAppId);
                })
                  ?.filter((data) =>
                    searchValues?.application
                      ? getCloudName(data?.providerName)
                        ?.toLowerCase()
                        ?.includes(searchValues?.application?.toLowerCase())
                      : data
                  )
                  ?.filter((cloud) => {
                    if (currentElement === "TRIGGER") {
                      return true;
                    }
                    if (onBoardCloudsList.includes(cloud?.providerName)) {
                      if (editObject?.currentApplication?.id) {
                        return editObject?.currentApplication?.id === cloud?.id;
                      } else if (currentDepartment) {
                        return (
                          !selectedApplicationList.includes(
                            cloud?.providerName
                          ) &&
                          !selectedApplicaionsBasedOnDepartment.includes(
                            cloud?.providerName
                          )
                        );
                      } else {
                        return !selectedApplicationList.includes(
                          cloud?.providerName
                        );
                      }
                    }
                  })
                  ?.map((data) => {
                    return (
                      <div
                        draggable={true}
                        onDragStart={(e) => {
                          const mapper = `${data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName}|${data?.id}`;
                          handleDragStart(e, {
                            action: ACTION_TYPES.ONBOARD_TO_APPLICATIONS,
                            currentApplication: data,
                            currentDepartment: currentDepartment,
                            LICENSES: selectedAppMap[mapper]?.LICENSES || [],
                            GROUPS: selectedAppMap[mapper]?.GROUPS || [],
                            roles: Object.values(
                              selectedUserInfoMap[
                              `${data?.providerName}|${data?.id}`
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
                          });
                        }}
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
                              title={data?.adminEmail}
                            >
                              {data?.adminEmail}
                            </p>
                          </div>
                          <div
                            style={{ marginLeft: "auto" }}
                            className="CF_d-flex ai-center CF_Pointer"
                            onClick={() => {
                              if (
                                currentTriggerItem?.currentApplication?.id ===
                                data?.id
                              ) {
                                setCurrentTriggerItem(null);
                              } else {
                                setCurrentTriggerItem({
                                  currentApplication: data,
                                });
                              }
                            }}
                          >
                            {(MANUAL_USER_CREATION_VENDORS.includes(currentTriggerItem?.currentApplication?.providerName) && !offboarding) &&
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
                        {currentTriggerItem?.currentApplication?.id ===
                          data?.id && (
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
                                <FlowLicenseSelector
                                  appName={
                                    currentTriggerItem?.currentApplication
                                      ?.providerName
                                  }
                                  appId={
                                    currentTriggerItem?.currentApplication?.id
                                  }
                                  licenseMap={
                                    licenseInfoMap[
                                    `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`
                                    ]
                                  }
                                  isLicenseLoaded={isLicenseLoaded}
                                  handleLicenseSelection={handleLicenseSelection}
                                  selectedLicenses={
                                    selectedAppMap[
                                      `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`
                                    ]?.LICENSES || []
                                  }
                                />
                              )}
                              {hasGroupManagement && (
                                <FlowGroupsSelector
                                  currentApplication={currentTriggerItem?.currentApplication}
                                  appName={
                                    currentTriggerItem?.currentApplication
                                      ?.providerName
                                  }
                                  appId={
                                    currentTriggerItem?.currentApplication?.id
                                  }
                                  groupsList={groupsList}
                                  isGroupsLoaded={isGroupsLoaded}
                                  handleGroupsSelection={handleGroupsSelection}
                                  searchGroupsList={searchGroupsList}
                                  searchValue={searchValue}
                                  searchTeamsGroupsList={searchTeamsGroupsList}
                                  selectedGroups={
                                    editedAction?.currentApplication?.id
                                      ? editedAction["GROUPS"] || []
                                      : selectedAppMap[
                                        `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`
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
        {currentElement === ACTION_TYPES.SELECT_GROUP && !groupView && (
          <>
            <div
              className="cf_workdflow_cloud_license_item"
              style={{ flexDirection: "column", gap: "4px" }}
            >
              <p
                className="cf_sub_heading"
                style={{
                  color: "#64748b",
                  fontWeight: "500",
                  fontSize: "14px",
                }}
              >
                Select Application to get groups
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
                {cloudsList
                  ?.filter((data) =>
                    searchValues?.application
                      ? getCloudName(data?.providerName)
                        ?.toLowerCase()
                        ?.includes(searchValues?.application?.toLowerCase())
                      : data
                  )
                  ?.map((data) => {
                    return (
                      <div
                        key={data?.id + "GROUP"}
                        className="cf_workdflow_app_container"
                        onClick={() => {
                          setGroupView(true);
                          setSelectedGroupApplication({
                            currentApplication: data,
                            groupInfo: {},
                          });
                        }}
                      >
                        <div className="cf_workdflow_app_header">
                          <img
                            src={cloudImageMapper(data?.providerName)}
                            alt="cloud"
                          />
                          <div>
                            <p style={{ fontWeight: "500", fontSize: "12px" }}>
                              {getCloudName(data?.providerName)}
                            </p>
                            <p
                              style={{
                                fontWeight: "500",
                                fontSize: "12px",
                                color: "#64748b",
                                width: "204px"
                              }}
                              title={data?.adminEmail}
                            >
                              {data?.adminEmail}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}
        {currentElement === ACTION_TYPES.SELECT_GROUP && groupView && (
          <>
            <FlowGroupsSelector
              appName={
                selectedGroupApplication?.currentApplication
                  ?.providerName
              }
              appId={
                selectedGroupApplication?.currentApplication?.id
              }
              groupsList={groupsList}
              isGroupsLoaded={isGroupsLoaded}
              handleGroupsSelection={handleGroupsSelection}
              searchGroupsList={searchGroupsList}
              searchValue={searchValue}
              searchTeamsGroupsList={searchTeamsGroupsList}
              selectedGroups={[]}
              currentApplication={selectedGroupApplication?.currentApplication}
              viewType="group"
              setGroupView={setGroupView}
            />
          </>
        )}
        {currentElement === ACTION_TYPES.ASSIGN_TEMPLATE && (
          <div
            className="cf_workdflow_cloud_license_item"
            style={{ flexDirection: "column", gap: "4px" }}
          >
            <p
              className="cf_sub_heading"
              style={{ color: "#64748b", fontWeight: "500", fontSize: "14px" }}
            >
              Select Template
            </p>
            <div className="CF_d-flex" style={{ gap: "10px" }}>
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
              <ActionButton
                customClass={`changeButtonColorOnHover`}
                customStyles={{
                  width: "110px",
                  height: "40px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#f2f2f2",
                }}
                buttonType="button"
                buttonClickAction={() => {
                  setIsCreateTemplate(true);
                }}
              >
                <p style={{ fontSize: "12px", fontWeight: "500" }}>
                  Create New
                </p>
              </ActionButton>
            </div>
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
                      (!selectedTemplatesList?.includes(
                        template?.conditionValue
                      ) && template?.conditionValue)
                    )
                    ?.map((template) => (
                      <div
                        draggable={true}
                        onDragStart={(e) =>
                          handleDragStart(e, {
                            action: ACTION_TYPES.ASSIGN_TEMPLATE,
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
                              {template?.conditionValue || "Unnamed Template"}
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
        )}
      </div>
    </div>
  );
};

export default NewFlowActionPannelV2;
