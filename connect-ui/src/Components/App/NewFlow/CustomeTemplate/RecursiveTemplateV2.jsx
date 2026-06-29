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

const RecursiveTemplateV2 = ({
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
                role: currentRole || data?.roles,
                commonName: data?.commonName || null,
                department: departmentName,
                type: type,
                parentType: parentType,
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
              parentType: parentType,
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
                gap: "2px",
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
              {(currentRole || currentLocation || data?.roles?.length > 0 || data?.commonName) && (
                <div
                  className="CF_d-flex"
                  style={{
                    flexDirection: "column",
                    fontSize: "11px",
                    color: "#64748b",
                    marginTop: "2px",
                  }}
                >
                  {/* {currentRole && (
                    <span title="Title/Role">Title: {currentRole}</span>
                  )}
                  {currentLocation && (
                    <span title="Location">Location: {currentLocation}</span>
                  )}
                  {data?.roles?.length > 0 && (
                    <span title="Application roles">Roles: {data.roles.length} selected</span>
                  )}
                  {data?.commonName && (
                    <span title="Custom role">Custom: {data.commonName}</span>
                  )} */}
                </div>
              )}
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
        {/* <p>{dropText}</p> */}
        <p>Drag and drop here</p>
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
        {/* {workFlowJSON?.departMentName && (
          <div
            style={{
              width: "2px",
              height: "60px",
              backgroundColor: "hsla(217, 100%, 50%, 1)",
              opacity: 0.5,
              margin: "0 auto",
              flexShrink: 0,
            }}
            aria-hidden
          />
        )} */}
        {workFlowJSON?.departMentName ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            {/* Empty state: only department selected - single plus, single drop zone */}
            {!hasApplications && !hasRoles && !hasLocations ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",

                }}
              >
                {renderDropZone(
                  departmentWaitingKey,
                  "Drag and drop here to add Title, Location or Application",
                  ["SELECT_DEPARTMENT_APPLICATION"]
                )}
                {renderPlusButton(() => {
                  onAddAction("GLOBAL");
                  setEnableOptionsList([
                    "ROLE_BASED_ACTION",
                    // "LOCATION_BASED_ACTION",
                    "ONBOARD_TO_APPLICATIONS",
                    "EXISTING_TEMPLATE",
                  ]);
                  setWaitingForDragging(departmentWaitingKey);
                }, "")}
              </div>
            ) : (
              <>
                {/* Only applications (no roles/locations): single plus, no side line */}
                {hasApplications && !hasRoles && !hasLocations ? (
                  <div
                    style={{
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",

                    }}
                  >
                    {workFlowJSON.applicationsList.map((app, appIndex) => (
                      <RecursiveTemplateV2
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
                          roles: app?.roles || [],
                          commonName: app?.commonName || null,
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
                      departmentWaitingKey,
                      "Drag and drop here to add Title, Location or Application",
                      ["SELECT_DEPARTMENT_APPLICATION"]
                    )}
                    {renderPlusButton(() => {
                      onAddAction("GLOBAL");
                      setEnableOptionsList([
                        "ROLE_BASED_ACTION",
                        // "LOCATION_BASED_ACTION",
                        "ONBOARD_TO_APPLICATIONS",
                        "EXISTING_TEMPLATE",
                      ]);
                      setWaitingForDragging(departmentWaitingKey);
                    }, "")}
                  </div>
                ) : (
                  <>
                    {/* Department-level Applications (no plus when role is selected) */}
                    {(hasApplications || createTemplate) && (
                      <div
                        style={{
                          width: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          marginTop: hasApplications ? "0" : undefined,
                        }}
                      >
                        {hasApplications &&
                          workFlowJSON.applicationsList.map((app, appIndex) => (
                            <RecursiveTemplateV2
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
                                roles: app?.roles || [],
                                commonName: app?.commonName || null,
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
                        {/* Only show add-application drop/plus when no roles/locations yet */}
                        {!hasRoles && !hasLocations && (
                          <>
                            {renderDropZone(
                              "SELECT_DEPARTMENT_APPLICATION",
                              "Drag and drop here to add Application"
                            )}
                            {renderPlusButton(() => {
                              onAddAction("DEPT_APP_SELECT");
                              setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
                              setWaitingForDragging("SELECT_DEPARTMENT_APPLICATION");
                            }, "cf_action_trigger_for_department")}
                          </>
                        )}
                      </div>
                    )}
                    {/* {hasApplications && (hasRoles || hasLocations) && (
                      <div
                        style={{
                          width: "2px",
                          height: "60px",
                          backgroundColor: "hsla(217, 100%, 50%, 1)",
                          opacity: 0.5,
                          margin: "0 auto",
                          flexShrink: 0,
                        }}
                        aria-hidden
                      />
                    )} */}
                    {/* Roles in one row, plus at end; locations and drop zone below */}
                    {(hasRoles || hasLocations || createTemplate) && (
                      <div
                        style={{
                          width: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",

                        }}
                      >
                        {/* Roles in one row with add-role plus at the end */}
                        <div
                          className={(!viewMode || viewMode && workFlowJSON.rolesList?.length > 1) ?`cf_department_based_action_container cf_action_trigger_dottedParent`:"cf_action_trigger_dottedParent"}
                        >
                          {viewMode && workFlowJSON.rolesList?.length > 1 ?
                          <div
                          className="cf_department_based_action_container_dottedLine_role"
                          style={{
                            width: `calc(100% - ${calculateWidth("ROLES", scale)}px)`,
                          }}
                          />
                        :""}
                          {!viewMode ?
                          <div
                          className="cf_department_based_action_container_dottedLine_role"
                          style={{
                            width: `calc(100% - ${calculateWidth("ROLES", scale)}px)`,
                          }}
                          />
                        :""}
                          {hasRoles &&
                            workFlowJSON.rolesList.map((role, roleIndex) => (
                              <RecursiveTemplateV2
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
                          {renderDropZone(
                            "SELECT_ROLE",
                            "Drag and drop here to add a Title or Location",
                            [departmentWaitingKey]
                          )}
                        </div>
                        {hasLocations &&
                          workFlowJSON.locationsList.map((location, locationIndex) => (
                            <RecursiveTemplateV2
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

                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
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
        {/* {(hasLocations || hasApplications) && (
          <div
            style={{
              width: "2px",
              height: "60px",
              backgroundColor: "hsla(217, 100%, 50%, 1)",
              opacity: 0.5,
              margin: "0 auto",
              flexShrink: 0,
            }}
            aria-hidden
          />
        )} */}
        {hasLocations || hasApplications ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div className={!viewMode  || viewMode && locationsList?.length > 1 ?`cf_department_based_action_container cf_action_trigger_dottedParent`:"cf_action_trigger_dottedParent"}>
              {!viewMode && <div
                className="cf_department_based_action_container_dottedLine_role"
              />}
              {(viewMode && locationsList?.length > 1) && <div
                className="cf_department_based_action_container_dottedLine_role"
              />}
              {hasLocations &&
                locationsList.map((location) => (
                  <RecursiveTemplateV2
                    editAction={editAction}
                    scale={scale}
                    key={`location`}
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
                    <RecursiveTemplateV2
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
                        roles: app?.roles || [],
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
                    setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
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
                      "LOCATION_BASED_ACTION",
                    ]);
                    setWaitingForDragging(waitingKey);
                  }, "cf_action_trigger_for_department")}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {renderDropZone(waitingKey, "Drag and drop here to add")}
            {renderPlusButton(() => {
              onAddAction("DEPT_APP_SELECT");
              setCurrentRole(role);
              setEnableOptionsList([
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
                <RecursiveTemplateV2
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
                  <RecursiveTemplateV2
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
                  setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
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
                    "EXISTING_TEMPLATE",
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
              setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
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
                <RecursiveTemplateV2
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
                  <RecursiveTemplateV2
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
                        "EXISTING_TEMPLATE",
                        "ROLE_BASED_ACTION",
                      ]);
                    } else {
                      setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
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
                        "EXISTING_TEMPLATE",
                        "ROLE_BASED_ACTION",
                      ]);
                    } else {
                      setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
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
                  "EXISTING_TEMPLATE",
                  "ROLE_BASED_ACTION",
                ]);
              } else {
                setEnableOptionsList(["ONBOARD_TO_APPLICATIONS", "EXISTING_TEMPLATE"]);
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

export default RecursiveTemplateV2;
