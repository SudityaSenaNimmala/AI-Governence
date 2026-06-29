import { useContext, useEffect, useRef, useState } from "react";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import Popup from "../../Resuables/Popup/Popup";
import { Building, GitBranch, UserPlus, Zap } from "lucide-react";
import MultiSelectInputDropDown from "../../Resuables/InputsComponents/MultiSelectInputDropDown";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { onBoardCloudsList } from "../../helpers/helpers";
import {
  getLicensesList,
  getSaaSGroupsData,
  getVendorSearch,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import FlowLicenseSelector from "./FlowLicenseSelector";
import { onBoardWithOutLicense } from "../../helpers/utils";
import FlowGroupsSelector from "./FlowGroupsSelector";

const NewFlowActionPannel = ({
  flowActionsList = {},
  licenseInfoMap = {},
  setLicenseInfoMap = () => {},
  isPopupOpen = false,
  setIsPopupOpen = () => {},
  currentAction = null,
  viewActionList = ["TRIGGER"],
  actionsList = [],
  handleAddToFlow = () => {},
  currentDepartment = null,
  selectedApplicationList = [],
  selectedDepartmentList = [],
  editedAction = null,
  setEditedAction = () => {},
  selectedApplicaionsBasedOnDepartment = [],
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
    },
    {
      id: "2",
      name: "Marketing",
    },
    {
      id: "3",
      name: "IT",
    },
    {
      id: "4",
      name: "HR",
    },
    {
      id: "5",
      name: "Finance",
    },
    {
      id: "6",
      name: "Operations",
    },
    {
      id: "7",
      name: "Customer Support",
    },
    {
      id: "8",
      name: "Engineering",
    },
  ]);

  console.log(editedAction);

  const [actionType] = useState([
    {
      id: "TRIGGER",
      name: "Trigger Action",
      icon: <Zap size={20} color="#64748b" />,
      description: "Trigger an action based on a specific event",
    },
    {
      id: "ONBOARD_TO_APPLICATIONS",
      name: "Onboard To Applications",
      icon: <UserPlus size={20} color="#64748b" />,
      description: "Add users to selected applications",
    },
    {
      id: "IF_ELSE",
      name: "If Else",
      icon: <GitBranch size={20} color="#64748b" />,
      description: "Add conditional branching logic",
    },
    {
      id: "DEPARTMENT_BASED_ACTION",
      name: "Department Based Action",
      icon: <Building size={20} color="#64748b" />,
      description: "Add actions based on department",
    },
  ]);

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

  const handleSelectFromMultiList = (e, data, action, type) => {
    console.log(data, action, type);
    if (type === "radio") {
      setCurrentTriggerItem({
        ...currentTriggerItem,
        [action]: data,
      });
    }
  };

  const fetchLicenses = async () => {
    let appName = currentTriggerItem?.currentApplication?.providerName;
    let appId = currentTriggerItem?.currentApplication?.id;
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
    let res = await getSaaSGroupsData(
      currentTriggerItem?.currentApplication?.id,
      currentTriggerItem?.currentApplication?.providerName,
      0,
      10,currentTriggerItem?.currentApplication?.ssoAppId
    );
    if (res?.status === "OK" && res?.res) {
      setGroupsList(res?.res);
      setIsGroupsLoaded(false);
    } else {
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
    let res = await getVendorSearch(
      "",
      "teamgroups",
      encodedSearchValue,
      false,
      currentTriggerItem?.currentApplication?.providerName,
      currentTriggerItem?.currentApplication?.id
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
      if (
        !onBoardWithOutLicense.includes(
          currentTriggerItem?.currentApplication?.providerName
        )
      ) {
        setHasLicenseManagement(true);
        fetchLicenses();
      }
      setHasGroupManagement(true);
      fetchGroups();
    }
  }, [currentTriggerItem]);

  const handleLicenseSelection = (e, data) => {
    let mapper = `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`;
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

  const handleAddAction = (action = null) => {
    if (editedAction) {
      handleAddToFlow(
        {
          ...currentTriggerItem,
          action: editedAction?.action,
          ...selectedAppMap[
            `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`
          ],
        },
        editedAction?.action
      );
    } else {
      let actionEvent = currentElement;

      if (action === "IF_ELSE") {
        handleAddToFlow([], "IF_ELSE");
      } else {
        if (flowActionsList["TRIGGER"] && !flowActionsList["IF_ELSE"]) {
          actionEvent = "PRIMARY_APPLICATION";
        }

        if (currentDepartment) {
          actionEvent = currentDepartment;
        }

        handleAddToFlow(
          {
            ...currentTriggerItem,
            action: currentElement,
            ...selectedAppMap[
              `${currentTriggerItem?.currentApplication?.providerName}|${currentTriggerItem?.currentApplication?.id}`
            ],
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

  const makeEditUI = () => {
    // if (editedAction?.action === "TRIGGER") {
    setIsPopupOpen(true);
    setCurrentElement(editedAction?.action);
    setCurrentTriggerItem(editedAction);
    let mapper = `${editedAction?.currentApplication?.providerName}|${editedAction?.currentApplication?.id}`;
    let selectedAppMap = {
      [mapper]: {
        LICENSES: editedAction?.licenses,
        GROUPS: editedAction?.groups,
      },
    };
    setSelectedAppMap({ ...selectedAppMap });
  };

  return (
    <Popup
      options={{
        isOpen: isPopupOpen,
        title: currentAction === "TRIGGER" ? "Trigger Action" : "Select Action",
        popupWidth: "30%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "00px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: {
          justifyContent: "flex-end",
        },
        titleCustomStyles: {
          fontSize: "16px",
          fontWeight: "600",
        },
      }}
      toggleOpen={setIsPopupOpen}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "calc(100% - 80px)",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
        }}
      >
        {currentElement === null ? (
          <div className="cf_workdflow_action_item_container">
            {actionType?.map((res) => {
              return viewActionList?.includes(res?.id) ? (
                <div
                  className="cf_workdflow_action_item"
                  onClick={() => {
                    if (res?.id === "IF_ELSE") {
                      handleAddAction("IF_ELSE");
                    } else {
                      setCurrentElement(res?.id);
                    }
                  }}
                  key={res?.id}
                >
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
              ) : (
                ""
              );
            })}
          </div>
        ) : (
          ""
        )}
        {currentElement === "DEPARTMENT_BASED_ACTION" && (
          <>
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
                style={{ color: "#64748b", fontWeight: "500" }}
              >
                Select Department
              </p>
              <MultiSelectInputDropDown
                loadAction={() => {
                  return true;
                }}
                displayFields={["name"]}
                options={{
                  inputType: "radio",
                  inputName: "DEPARTMENT",
                  name: "Department",
                }}
                suggestedData={departmentList?.filter(
                  (department) =>
                    !selectedDepartmentList.includes(department?.name)
                )}
                selectedData={
                  currentTriggerItem?.department
                    ? [currentTriggerItem?.department]
                    : []
                }
                handleSelection={handleSelectDepartment}
                parentStyle={{ maxWidth: "100%" }}
              />
            </div>
          </>
        )}
        {currentElement === "TRIGGER" && (
          <>
            <div
              className="cf_workdflow_cloud_license_item"
              style={{ flexDirection: "column", gap: "4px" }}
            >
              <p
                className="cf_sub_heading"
                style={{ color: "#64748b", fontWeight: "500" }}
              >
                Primary Application
              </p>
              <MultiSelectInputDropDown
                loadAction={() => {
                  return true;
                }}
                displayFields={["providerName"]}
                options={{
                  inputType: "radio",
                  inputName: "currentApplication",
                  name: "Primary Application",
                }}
                isCloudsList={true}
                suggestedData={cloudsList?.filter(
                  (cloud) =>
                    onBoardCloudsList.includes(cloud?.providerName) &&
                    !selectedApplicationList.includes(cloud?.providerName)
                )}
                selectedData={
                  currentTriggerItem?.currentApplication?.id
                    ? [
                        {
                          ...currentTriggerItem?.currentApplication,
                        },
                      ]
                    : []
                }
                handleSelection={handleSelectFromMultiList}
                parentStyle={{ maxWidth: "100%" }}
              />
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
                  loadAction={() => {
                    return true;
                  }}
                  displayFields={["name"]}
                  options={{
                    inputType: "radio",
                    inputName: "event",
                    name: "Event",
                  }}
                  suggestedData={triggerEvents}
                  selectedData={
                    currentTriggerItem?.event?.id
                      ? [
                          {
                            ...currentTriggerItem?.event,
                          },
                        ]
                      : []
                  }
                  handleSelection={handleSelectFromMultiList}
                  parentStyle={{ maxWidth: "160px", height: "35px" }}
                />
              </div>
            )}
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
              <MultiSelectInputDropDown
                loadAction={() => {
                  return true;
                }}
                displayFields={["providerName"]}
                options={{
                  inputType: "radio",
                  inputName: "currentApplication",
                  name: "Select Application To Onboard",
                  searchValue: "Search By Application Name",
                }}
                isCloudsList={true}
                suggestedData={cloudsList?.filter((cloud) => {
                  if (onBoardCloudsList.includes(cloud?.providerName)) {
                    if (currentDepartment) {
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
                })}
                selectedData={
                  currentTriggerItem?.currentApplication?.id
                    ? [
                        {
                          ...currentTriggerItem?.currentApplication,
                        },
                      ]
                    : []
                }
                handleSelection={handleSelectFromMultiList}
                parentStyle={{ maxWidth: "100%" }}
              />
            </div>
            {hasLicenseManagement && (
              <FlowLicenseSelector
                appName={currentTriggerItem?.currentApplication?.providerName}
                appId={currentTriggerItem?.currentApplication?.id}
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
                appName={currentTriggerItem?.currentApplication?.providerName}
                appId={currentTriggerItem?.currentApplication?.id}
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
          </>
        )}
      </div>
      <div className="cf_popup_container_footer">
        <span style={{ marginLeft: "auto" }}></span>
        <ActionButton
          customClass={`cf_newBox_Shadow `}
          customStyles={{
            backgroundColor: "#fff",
            color: "#fff",
            height: "35px",
          }}
          buttonType="button"
          buttonClickAction={handleAddAction}
        >
          <p style={{ color: "#64748b", fontWeight: "500", fontSize: "12px" }}>
            Add To Flow
          </p>
        </ActionButton>
      </div>
    </Popup>
  );
};

export default NewFlowActionPannel;
