import { Building, MapPin, Plus, Trash2, User, TriangleAlert, Pencil } from "lucide-react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { calculateWidth } from "../utils/workflowUtils";

// Hardcoded colors for each type
const typeColors = {
  DEPARTMENT: { dull: "#FFDFC8", dark: "#B2562B" },
  ROLE: { dull: "#E8D9FF", dark: "#5A2E8A" },
  LOCATION: { dull: "#FFD6E7", dark: "#9E2A5C" },
  APPLICATION: { dull: "#CFE8F3", dark: "#1E5673" },
};

const RecursiveTemplate = ({
  workFlowJSON = {},
  level = 0,
  parentType = null,
  parentKey = null,
  type = null,
  data = null,
  index = 0,
  onDelete = () => { },
  onAddAction = () => { },
  waitingForDragging = null,
  onDrop = () => { },
  currentRole = null,
  setCurrentRole = () => { },
  currentLocation = null,
  setCurrentLocation = () => { },
  setEnableOptionsList = () => { },
  setWaitingForDragging = () => { },
  viewMode = false,
  createTemplate = false,
  scale = 1,
  editAction = null,
  departmentName = null,
  locationName = null,
  deleted = false,
}) => {
  console.log("deleted", workFlowJSON);
  const renderPanel = (
    type,
    data,
    key,
    colorIndex,
    roleKeyForDelete = null,
    locationKey,
    isDeleted = false
  ) => {
    // Get hardcoded color for the type
    const colors = typeColors[type] || { dull: "#E5E5E5", dark: "#666666" };

    const getIcon = () => {
      // If deleted, show TriangleAlert icon for all types
      if (isDeleted) {
        return <TriangleAlert size={22} color="#ff4c4c" />;
      }

      switch (type) {
        case "DEPARTMENT":
          return <Building size={22} color={colors.dark} />;
        case "ROLE":
          return <User size={22} color={colors.dark} />;
        case "LOCATION":
          return <MapPin size={22} color={colors.dark} />;
        case "APPLICATION":
          return (
            <div className="CF_d-flex ai_center">
              <img
                src={cloudImageMapper(data?.currentApplication?.providerName)}
                style={{
                  width: "30px",
                  height: "30px",
                  objectFit: "contain",
                }}
              />
            </div>
          );
        default:
          return null;
      }
    };

    const getDisplayName = () => {
      if (type === "APPLICATION") {
        return (
          getCloudName(data?.currentApplication?.providerName) || "Application"
        );
      }
      return data;
    };

    const isDepartment = type === "DEPARTMENT";

    return (
      <div
        className={`cf_newFlow_trigger_pannel cf_action_trigger_dottedParent ${isDeleted ? "cf_action_panel_deleted" : ""
          }`}
        id={`cf_roleLevel_container_${type}_${index}_${key}`}
        style={{
          marginTop: "60px",
          backgroundColor: isDeleted
            ? "#E5E5E5"
            : colors.dull,
          border: `2px solid ${isDeleted ? "#ff4c4c" : colors.dark}`,
          opacity: 1,
          position: "relative",
        }}
        key={`${key}_${type}`}
      >
        {type === "APPLICATION" && !deleted && editAction ? (
          <div
            className="cf_newFlow_trigger_pannel_action_icon"
            style={{ right: "30px" }}
            onClick={() => {
              editAction({
                application: data,
                location: currentLocation,
                role: currentRole,
                department: departmentName,
                type: type,
              });
            }}
          >
            <Pencil size={10} />
          </div>
        ) : (
          ""
        )}
        <div
          className="cf_newFlow_trigger_pannel_action_icon cf_newFlow_trigger_pannel_action_icon_trash"
          style={{
            right: type === "APPLICATION" ? "0px" : undefined,
          }}
          onClick={() =>
            onDelete(key, type, roleKeyForDelete, {
              application: data,
              location: currentLocation,
              role: currentRole,
              department: departmentName,
              type: type,
            })
          }
        >
          <Trash2 size={10} />
        </div>

        <div className="cf_newFlow_trigger_pannel_header">
          <div className="cf_newFlow_trigger_pannel_header_icon">
            {getIcon()}
          </div>
          {isDepartment ? (
            <p
              className="cf_newFlow_trigger_pannel_header_name"
              style={{
                fontWeight: "500",
                fontSize: "16px",
              }}
            >
              {getDisplayName()}
            </p>
          ) : type === "APPLICATION" ? (
            <div
              className="CF_d-flex"
              style={{
                flexDirection: "column",
                width: "calc(100% - 50px)",
              }}
            >
              <p
                className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                style={{
                  width: "calc(100% - 0px)",
                  fontWeight: "500",
                }}
                title={`Onboard User to ${getDisplayName()}`}
              >
                {isDeleted ? "Application Deleted" : "Onboard User to"}
              </p>
              <p
                className="cf_newFlow_trigger_pannel_header_name cf_mapping_domain_name"
                style={{
                  fontWeight: "400",
                  color: "#64748b",
                }}
              >
                {getDisplayName()}
              </p>
            </div>
          ) : (
            <p
              className="cf_newFlow_trigger_pannel_header_name"
              style={{
                fontWeight: "500",
                fontSize: "16px",
              }}
              title={getDisplayName()}
            >
              {getDisplayName()}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderDropZone = (waitingKey, dropText, additionalKeys = []) => {
    const keysToCheck = [waitingKey, ...additionalKeys];
    if (!keysToCheck.includes(waitingForDragging)) return null;

    return (
      <div
        className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent cf_action_drop_pannel"
        style={{
          marginTop: "60px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={onDrop}
      >
        <p>{dropText}</p>
      </div>
    );
  };

  const renderPlusButton = (onClick, customClass = "", id = "") => {
    if (viewMode) return null;
    if (waitingForDragging) return null;

    return (
      <div
        className={`cf_action_trigger cf_action_triggerV3 ${customClass}`}
        id={id}
      >
        <ActionButton
          customClass={`changeButtonColorOnHover cf_newBox_Shadow`}
          customStyles={{
            backgroundColor: "#fff",
            height: "35px",
            width: "35px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
          }}
          buttonType="button"
          isDisabled={false}
          buttonClickAction={onClick}
        >
          <Plus size={16} />
        </ActionButton>
      </div>
    );
  };

  if (level === 0) {
    const hasRoles = workFlowJSON?.rolesList?.length > 0;
    const hasLocations = (workFlowJSON?.locationsList?.length || 0) > 0;
    const hasApplications = (workFlowJSON?.applicationsList?.length || 0) > 0;
    const departmentWaitingKey = "SELECT_DEPARTMENT_LOCATION";
    const totalItems =
      (hasRoles ? workFlowJSON.rolesList.length : 0) +
      (hasLocations ? workFlowJSON.locationsList.length : 0);

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {workFlowJSON?.departMentName &&
          renderPanel(
            "DEPARTMENT",
            workFlowJSON.departMentName,
            workFlowJSON.departMentName,
            0,
            null,
            null,
            false
          )}
        {hasRoles || hasLocations ? (
          <div
            className={
              totalItems > 1 || createTemplate
                ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                : ""
            }
          >
            {(totalItems > 1 || createTemplate) && (
              <div
                className="cf_department_based_action_container_dottedLine_role"
                style={{
                  width: `calc(100% - ${calculateWidth("ROLES", scale)}px)`,
                }}
              />
            )}
            {hasRoles &&
              workFlowJSON.rolesList.map((role, roleIndex) => (
                <RecursiveTemplate
                  editAction={editAction}
                  scale={scale}
                  key={`role_${role}`}
                  workFlowJSON={workFlowJSON}
                  level={1}
                  parentType={
                    workFlowJSON?.departMentName ? "DEPARTMENT" : null
                  }
                  parentKey={workFlowJSON?.departMentName || null}
                  type="ROLE"
                  data={role}
                  index={roleIndex + 1}
                  onDelete={onDelete}
                  onAddAction={onAddAction}
                  waitingForDragging={waitingForDragging}
                  onDrop={onDrop}
                  currentRole={currentRole || role}
                  setCurrentRole={setCurrentRole}
                  currentLocation={currentLocation}
                  setCurrentLocation={setCurrentLocation}
                  setEnableOptionsList={setEnableOptionsList}
                  setWaitingForDragging={setWaitingForDragging}
                  viewMode={viewMode}
                  createTemplate={createTemplate}
                  departmentName={workFlowJSON?.departMentName}
                />
              ))}
            {hasLocations &&
              workFlowJSON.locationsList.map((location, locationIndex) => (
                <RecursiveTemplate
                  editAction={editAction}
                  scale={scale}
                  key={`location_${location}`}
                  workFlowJSON={workFlowJSON}
                  level={1}
                  parentType="DEPARTMENT"
                  parentKey={workFlowJSON?.departMentName}
                  type="LOCATION"
                  data={location}
                  index={locationIndex + 1}
                  onDelete={onDelete}
                  onAddAction={onAddAction}
                  waitingForDragging={waitingForDragging}
                  onDrop={onDrop}
                  currentRole={currentRole}
                  setCurrentRole={setCurrentRole}
                  currentLocation={currentLocation || location}
                  setCurrentLocation={setCurrentLocation}
                  setEnableOptionsList={setEnableOptionsList}
                  setWaitingForDragging={setWaitingForDragging}
                  viewMode={viewMode}
                  createTemplate={createTemplate}
                  departmentName={workFlowJSON?.departMentName}
                />
              ))}
            {renderDropZone(
              "SELECT_ROLE",
              "Drag and drop here to add a Title or Location",
              [departmentWaitingKey]
            )}
            {renderPlusButton(
              () => {
                onAddAction("GLOBAL");
                setEnableOptionsList([
                  "ROLE_BASED_ACTION",
                  "LOCATION_BASED_ACTION",
                ]);
                setWaitingForDragging("SELECT_ROLE");
              },
              "cf_action_trigger_for_department",
              "SELECT_ROLE"
            )}
          </div>
        ) : hasApplications ? (
          <div
            className={
              workFlowJSON?.applicationsList?.length > 1 || createTemplate
                ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                : ""
            }
          >
            {(workFlowJSON?.applicationsList?.length > 1 || createTemplate) && (
              <div className="cf_department_based_action_container_dottedLine"></div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              {workFlowJSON.applicationsList.map((app, appIndex) => (
                <RecursiveTemplate
                  editAction={editAction}
                  scale={scale}
                  key={`application_${app?.id || app?.currentApplication?.id}`}
                  workFlowJSON={workFlowJSON}
                  level={3}
                  parentType="DEPARTMENT"
                  parentKey={workFlowJSON?.departMentName}
                  type="APPLICATION"
                  data={{
                    currentApplication: app?.currentApplication || app,
                    LICENSES: app?.LICENSES || [],
                    GROUPS: app?.GROUPS || [],
                  }}
                  index={appIndex + 1}
                  onDelete={onDelete}
                  onAddAction={onAddAction}
                  waitingForDragging={waitingForDragging}
                  onDrop={onDrop}
                  currentRole={currentRole}
                  setCurrentRole={setCurrentRole}
                  currentLocation={currentLocation}
                  setCurrentLocation={setCurrentLocation}
                  setEnableOptionsList={setEnableOptionsList}
                  setWaitingForDragging={setWaitingForDragging}
                  viewMode={viewMode}
                  createTemplate={createTemplate}
                  departmentName={workFlowJSON?.departMentName}
                  deleted={app?.deleted || false}
                />
              ))}
              {renderDropZone(
                "SELECT_DEPARTMENT_APPLICATION",
                "Drag and drop here to add"
              )}
              {renderPlusButton(() => {
                onAddAction("DEPT_APP_SELECT");
                setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
                setWaitingForDragging("SELECT_DEPARTMENT_APPLICATION");
              }, "cf_action_trigger_for_department")}
            </div>
          </div>
        ) : (
          <>
            {workFlowJSON?.departMentName ? (
              <>
                {renderDropZone(
                  departmentWaitingKey,
                  "Drag and drop here to add"
                )}
                {renderPlusButton(() => {
                  onAddAction("GLOBAL");
                  setEnableOptionsList([
                    "ROLE_BASED_ACTION",
                    "LOCATION_BASED_ACTION",
                  ]);
                  setWaitingForDragging(departmentWaitingKey);
                }, "")}
              </>
            ) : (
              <>
                {renderDropZone(
                  "SELECT_ROLE",
                  "Drag and drop here to add a Title"
                )}
                {renderPlusButton(() => {
                  onAddAction("GLOBAL");
                  setEnableOptionsList([
                    "ROLE_BASED_ACTION",
                    "LOCATION_BASED_ACTION",
                  ]);
                  setWaitingForDragging("SELECT_ROLE");
                }, "cf_action_trigger_for_department")}
              </>
            )}
          </>
        )}
      </div>
    );
  } else if (level === 0 && workFlowJSON?.rolesList?.length === 0) {
    return (
      <>
        {renderDropZone("SELECT_ROLE", "Drag and drop here to add a Title")}
        {renderPlusButton(() => {
          onAddAction("GLOBAL");
          setEnableOptionsList(["ROLE_BASED_ACTION", "LOCATION_BASED_ACTION"]);
          setWaitingForDragging("SELECT_ROLE");
        }, "cf_action_trigger_for_department")}
      </>
    );
  }

  if (
    level === 1 &&
    type === "ROLE" &&
    (parentType === "DEPARTMENT" || parentType === null)
  ) {
    const role = data;
    const roleData = workFlowJSON?.actions?.[role];
    const locationsList = roleData?.locationsList || [];
    const applicationsList = roleData?.applicationsList || [];
    const hasLocations = locationsList.length > 0;
    const hasApplications = applicationsList.length > 0;
    const waitingKey = `SELECT_DEPARTMENT_${role}`;
    const totalItems =
      (hasLocations ? locationsList.length : 0) +
      (hasApplications ? applicationsList.length : 0);

    return (
      <div
        className={`CF_d-flex current_role_${index}`}
        id="cf_roleLevel_container"
        style={{
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
        }}
      >
        {renderPanel(
          "ROLE",
          role,
          role,
          index,
          null,
          currentRole,
          false
        )}
        {hasLocations || hasApplications ? (
          <div
            className={
              totalItems > 1 || createTemplate
                ? "cf_department_based_action_container cf_action_trigger_dottedParent"
                : ""
            }
          >
            {(totalItems > 1 || createTemplate) && hasLocations && (
              <div className="cf_department_based_action_container_dottedLine"></div>
            )}
            {hasLocations &&
              locationsList.map((location) => (
                <RecursiveTemplate
                  editAction={editAction}
                  scale={scale}
                  key={`location_${location}`}
                  workFlowJSON={workFlowJSON}
                  level={2}
                  parentType="ROLE"
                  parentKey={role}
                  type="LOCATION"
                  data={location}
                  index={index}
                  onDelete={onDelete}
                  onAddAction={onAddAction}
                  waitingForDragging={waitingForDragging}
                  onDrop={onDrop}
                  currentRole={currentRole}
                  setCurrentRole={setCurrentRole}
                  currentLocation={currentLocation || location}
                  setCurrentLocation={setCurrentLocation}
                  setEnableOptionsList={setEnableOptionsList}
                  setWaitingForDragging={setWaitingForDragging}
                  viewMode={viewMode}
                  createTemplate={createTemplate}
                  departmentName={departmentName}
                />
              ))}
            {hasApplications && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                {applicationsList.map((app) => (
                  <RecursiveTemplate
                    editAction={editAction}
                    scale={scale}
                    key={`application_${app?.id || app?.currentApplication?.id
                      }`}
                    workFlowJSON={workFlowJSON}
                    level={3}
                    parentType="ROLE"
                    parentKey={role}
                    type="APPLICATION"
                    data={{
                      currentApplication: app?.currentApplication || app,
                      LICENSES: app?.LICENSES || [],
                      GROUPS: app?.GROUPS || [],
                    }}
                    index={index}
                    onDelete={onDelete}
                    onAddAction={onAddAction}
                    waitingForDragging={waitingForDragging}
                    onDrop={onDrop}
                    currentRole={currentRole}
                    setCurrentRole={setCurrentRole}
                    currentLocation={currentLocation}
                    setCurrentLocation={setCurrentLocation}
                    setEnableOptionsList={setEnableOptionsList}
                    setWaitingForDragging={setWaitingForDragging}
                    viewMode={viewMode}
                    createTemplate={createTemplate}
                    departmentName={departmentName}
                    deleted={app?.deleted || false}
                  />
                ))}
                {renderDropZone(waitingKey, "Drag and drop here to add")}
                {renderPlusButton(() => {
                  onAddAction("DEPT_APP_SELECT");
                  setCurrentRole(role);
                  setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
                  setWaitingForDragging(waitingKey);
                }, "")}
              </div>
            )}
            {!hasApplications && (
              <>
                {renderDropZone(waitingKey, "Drag and drop here to add")}
                {renderPlusButton(() => {
                  onAddAction("DEPT_APP_SELECT");
                  setCurrentRole(role);
                  setEnableOptionsList([
                    "ONBOARD_TO_APPLICATIONS",
                    "LOCATION_BASED_ACTION",
                  ]);
                  setWaitingForDragging(waitingKey);
                }, "cf_action_trigger_for_department")}
              </>
            )}
          </div>
        ) : (
          <>
            {renderDropZone(waitingKey, "Drag and drop here to add")}
            {renderPlusButton(() => {
              onAddAction("DEPT_APP_SELECT");
              setCurrentRole(role);
              setEnableOptionsList([
                "ONBOARD_TO_APPLICATIONS",
                "LOCATION_BASED_ACTION",
              ]);
              setWaitingForDragging(waitingKey);
            })}
          </>
        )}
      </div>
    );
  }

  if (level === 1 && type === "LOCATION" && parentType === "DEPARTMENT") {
    const location = data;
    const waitingKey = `SELECT_LOCATION_${location}`;
    let appList = [];
    let rolesList = [];
    let hasApplications = false;
    let hasRoles = false;

    appList = workFlowJSON?.locationActions?.[location] || [];
    hasApplications = appList.length > 0;

    const totalItems =
      (hasApplications ? appList.length : 0) +
      (hasRoles ? rolesList.length : 0);

    return (
      <div
        className="CF_d-flex"
        style={{
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
        }}
      >
        {renderPanel(
          "LOCATION",
          location,
          location,
          index,
          parentKey,
          currentRole,
          false
        )}
        {hasApplications || hasRoles ? (
          <div className={totalItems > 1 || createTemplate ? "" : ""}>
            {(totalItems > 1 || createTemplate) && ""}

            {hasRoles &&
              rolesList.map((role) => (
                <RecursiveTemplate
                  editAction={editAction}
                  scale={scale}
                  key={`role_${role}`}
                  workFlowJSON={workFlowJSON}
                  level={2}
                  parentType="LOCATION"
                  parentKey={location}
                  type="ROLE"
                  data={role}
                  index={index}
                  onDelete={onDelete}
                  onAddAction={onAddAction}
                  waitingForDragging={waitingForDragging}
                  onDrop={onDrop}
                  currentRole={currentRole}
                  setCurrentRole={setCurrentRole}
                  currentLocation={currentLocation}
                  setCurrentLocation={setCurrentLocation}
                  setEnableOptionsList={setEnableOptionsList}
                  setWaitingForDragging={setWaitingForDragging}
                  viewMode={viewMode}
                  createTemplate={createTemplate}
                />
              ))}
            {/* Render all applications */}
            {hasApplications && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                {appList?.map((res) => (
                  <RecursiveTemplate
                    editAction={editAction}
                    scale={scale}
                    key={`application_${res?.currentApplication?.id}`}
                    workFlowJSON={workFlowJSON}
                    level={3}
                    parentType="LOCATION"
                    parentKey={location}
                    type="APPLICATION"
                    data={res}
                    index={index}
                    onDelete={onDelete}
                    onAddAction={onAddAction}
                    waitingForDragging={waitingForDragging}
                    onDrop={onDrop}
                    currentRole={currentRole}
                    setCurrentRole={setCurrentRole}
                    currentLocation={currentLocation}
                    setCurrentLocation={setCurrentLocation}
                    setEnableOptionsList={setEnableOptionsList}
                    setWaitingForDragging={setWaitingForDragging}
                    viewMode={viewMode}
                    createTemplate={createTemplate}
                    deleted={res?.deleted || false}
                  />
                ))}
                {renderDropZone(waitingKey, "Drag and drop here to add")}
                {renderPlusButton(() => {
                  onAddAction("DEPT_APP_SELECT");
                  setCurrentLocation(location);
                  setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
                  setWaitingForDragging(waitingKey);
                }, "cf_action_trigger_for_department")}
              </div>
            )}
            {!hasApplications && (
              <>
                {renderDropZone(waitingKey, "Drag and drop here to add")}
                {renderPlusButton(() => {
                  onAddAction("DEPT_APP_SELECT");
                  setCurrentLocation(location);
                  setEnableOptionsList([
                    "ONBOARD_TO_APPLICATIONS",
                    "ROLE_BASED_ACTION",
                  ]);
                  setWaitingForDragging(waitingKey);
                }, "cf_action_trigger_for_department")}
              </>
            )}
          </div>
        ) : (
          <>
            {renderDropZone(waitingKey, "Drag and drop here to add")}
            {renderPlusButton(() => {
              onAddAction("DEPT_APP_SELECT");
              setCurrentLocation(location);
              setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
              setWaitingForDragging(waitingKey);
            })}
          </>
        )}
      </div>
    );
  }

  if (level === 2 && type === "LOCATION") {
    const location = data;
    const waitingKey =
      parentType === "ROLE"
        ? `SELECT_LOCATION_${parentKey}_${location}`
        : `SELECT_LOCATION_${location}`;
    let appList = [];
    let rolesList = [];
    let hasApplications = false;
    let hasRoles = false;

    if (parentType === "ROLE") {
      const roleName = parentKey;
      appList = workFlowJSON?.actions?.[roleName]?.actions?.[location] || [];
      hasApplications = appList.length > 0;
    } else if (parentType === "DEPARTMENT") {
      appList = workFlowJSON?.locationActions?.[location] || [];
      hasApplications = appList.length > 0;
    }

    const totalItems =
      (hasApplications ? appList.length : 0) +
      (hasRoles ? rolesList.length : 0);

    const locationsList = workFlowJSON?.locationsList || [];

    return (
      <div
        className="CF_d-flex"
        style={{
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
        }}
      >
        {renderPanel(
          "LOCATION",
          location,
          location,
          index,
          parentKey,
          currentRole,
          false
        )}
        {hasApplications || hasRoles ? (
          <div className={totalItems > 1 || createTemplate ? "" : ""}>
            {(totalItems > 1 || createTemplate) && ""}
            {totalItems > 1 && locationsList?.length > 1 ? (
              <div className="cf_department_based_action_container_dottedLine"></div>
            ) : (
              ""
            )}
            {hasRoles &&
              parentType === "DEPARTMENT" &&
              rolesList.map((role) => (
                <RecursiveTemplate
                  editAction={editAction}
                  scale={scale}
                  key={`role_${role}`}
                  workFlowJSON={workFlowJSON}
                  level={3}
                  parentType="LOCATION"
                  parentKey={location}
                  type="ROLE"
                  data={role}
                  index={index}
                  onDelete={onDelete}
                  onAddAction={onAddAction}
                  waitingForDragging={waitingForDragging}
                  onDrop={onDrop}
                  currentRole={currentRole}
                  setCurrentRole={setCurrentRole}
                  currentLocation={currentLocation}
                  setCurrentLocation={setCurrentLocation}
                  setEnableOptionsList={setEnableOptionsList}
                  setWaitingForDragging={setWaitingForDragging}
                  viewMode={viewMode}
                  createTemplate={createTemplate}
                  departmentName={departmentName}
                />
              ))}
            {hasApplications && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                {appList?.map((res) => (
                  <RecursiveTemplate
                    editAction={editAction}
                    key={`application_${res?.currentApplication?.id}`}
                    workFlowJSON={workFlowJSON}
                    level={3}
                    parentType="LOCATION"
                    parentKey={location}
                    type="APPLICATION"
                    data={res}
                    index={index}
                    onDelete={onDelete}
                    onAddAction={onAddAction}
                    waitingForDragging={waitingForDragging}
                    onDrop={onDrop}
                    currentRole={currentRole}
                    setCurrentRole={setCurrentRole}
                    currentLocation={currentLocation}
                    setCurrentLocation={setCurrentLocation}
                    setEnableOptionsList={setEnableOptionsList}
                    setWaitingForDragging={setWaitingForDragging}
                    viewMode={viewMode}
                    createTemplate={createTemplate}
                    departmentName={departmentName}
                    deleted={res?.deleted || false}
                  />
                ))}
                {renderDropZone(waitingKey, "Drag and drop here to add")}
                {renderPlusButton(
                  () => {
                    onAddAction("DEPT_APP_SELECT");
                    if (parentType === "ROLE") {
                      setCurrentRole(parentKey);
                    }
                    setCurrentLocation(location);
                    if (parentType === "DEPARTMENT") {
                      setEnableOptionsList([
                        "ONBOARD_TO_APPLICATIONS",
                        "ROLE_BASED_ACTION",
                      ]);
                    } else {
                      setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
                    }
                    setWaitingForDragging(waitingKey);
                  },
                  parentType === "DEPARTMENT"
                    ? "cf_action_trigger_for_department"
                    : ""
                )}
              </div>
            )}
            {!hasApplications && (
              <>
                {renderDropZone(waitingKey, "Drag and drop here to add")}
                {renderPlusButton(
                  () => {
                    onAddAction("DEPT_APP_SELECT");
                    if (parentType === "ROLE") {
                      setCurrentRole(parentKey);
                    }
                    setCurrentLocation(location);
                    if (parentType === "DEPARTMENT") {
                      setEnableOptionsList([
                        "ONBOARD_TO_APPLICATIONS",
                        "ROLE_BASED_ACTION",
                      ]);
                    } else {
                      setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
                    }
                    setWaitingForDragging(waitingKey);
                  },
                  parentType === "DEPARTMENT"
                    ? "cf_action_trigger_for_department"
                    : ""
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {renderDropZone(waitingKey, "Drag and drop here to add")}
            {renderPlusButton(() => {
              onAddAction("DEPT_APP_SELECT");
              if (parentType === "ROLE") {
                setCurrentRole(parentKey);
              }
              setCurrentLocation(location);
              if (parentType === "DEPARTMENT") {
                setEnableOptionsList([
                  "ONBOARD_TO_APPLICATIONS",
                  "ROLE_BASED_ACTION",
                ]);
              } else {
                setEnableOptionsList(["ONBOARD_TO_APPLICATIONS"]);
              }
              setWaitingForDragging(waitingKey);
            })}
          </>
        )}
      </div>
    );
  }

  if (level === 3 && type === "APPLICATION") {
    const application = data;
    const appId = application?.currentApplication?.id || application?.id;
    const waitingKey = `SELECT_APPLICATION_${appId}`;

    return (
      <div>
        {renderPanel(
          "APPLICATION",
          application,
          appId,
          index,
          parentKey,
          null,
          deleted
        )}
      </div>
    );
  }

  return null;
};

export default RecursiveTemplate;
