import { ChevronDown, ChevronLeft, GripVertical } from "lucide-react";
import { cloudImageMapper } from "../../helpers/helpers";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { useMemo, useState } from "react";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { getMaxChar } from "../../helpers/utils";
import { ACTION_TYPES } from "./constants/workflowConstants";

const FlowGroupsSelector = ({
  appName = "",
  appId = "",
  groupsList = [],
  isGroupsLoaded = false,
  searchGroupsList = [],
  searchValue = "",
  searchTeamsGroupsList = () => { },
  handleGroupsSelection = () => { },
  selectedGroups = [],
  currentApplication = null,
  viewType = "application",
  setGroupView = () => { },
}) => {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [userSearchValue, setUserSearchValue] = useState("");

  const filteredOwners = selectedGroup?.owners?.filter((owner) =>
    owner?.toLowerCase().includes(userSearchValue?.toLowerCase() || "")
  ) || [];

  const filteredMembers = selectedGroup?.members?.filter((member) =>
    member?.toLowerCase().includes(userSearchValue?.toLowerCase() || "")
  ) || [];

  const handleDragStart = (e, data) => {
    e.dataTransfer.setData("json", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
  };

  const displayGroups = useMemo(() => {
    const list =
      searchValue !== null || searchValue?.length > 0
        ? searchGroupsList || []
        : groupsList?.groupDtos || [];
    const selectedIds = new Set(selectedGroups?.map((g) => g?.groupId));
    const listById = new Map((list || []).map((g) => [g?.groupId, g]));

    // Keep every selected group at top (even if not in current page/search results)
    const selectedAtTop = (selectedGroups || [])
      .filter((g) => g?.groupId)
      .map((sg) => listById.get(sg.groupId) || sg);

    const unselected = (list || []).filter((g) => !selectedIds.has(g?.groupId));

    return [...selectedAtTop, ...unselected];
  }, [searchValue, searchGroupsList, groupsList?.groupDtos, selectedGroups]);

  return (
    <div
      className="cf_workdflow_cloud_license_item_container"
      style={{ marginTop: "20px" }}
    >
      <div className="CF_d-flex ai-center CF_Pointer" style={{ gap: "10px" }}>
        {viewType === "group" ? <div className="CF_d-flex ai-center CF_Pointer" onClick={() => {
          setGroupView(false);
        }}>
          <ChevronLeft size={20} color="#64748b" />
        </div> : ""}
        <p
          className="cf_sub_heading"
          style={{
            color: "#64748b",
            fontWeight: "500",
            fontSize: "16px",
          }}
        >
          Select Groups To Assign
        </p>
      </div>
      {(!searchValue && !isGroupsLoaded && (groupsList?.groupDtos?.length === 0 || !groupsList?.groupDtos)) ? <p style={{ padding: "10px", textAlign: "center", fontWeight: "500", fontSize: "12px", color: "#64748b" }}>No groups found</p> : <>
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
          defaultValue={searchValue}
          inputPlaceHolder={`Search By GroupName`}
          onInputSearch={(e) => searchTeamsGroupsList(e.searchInput)}
        />
        {(!isGroupsLoaded && ((groupsList?.groupDtos?.length === 0 || !groupsList?.groupDtos) || (searchValue?.length > 2 && searchGroupsList?.length === 0))) ? <p style={{ padding: "10px", textAlign: "center", fontWeight: "500", fontSize: "12px", color: "#64748b" }}>No groups found  </p> :
          isGroupsLoaded ? getCFTextLoader()
            : displayGroups?.map((res) => (
              viewType === "group" ?
                <div
                  draggable={true}
                  onDragStart={(e) => {
                    handleDragStart(e, {
                      action: ACTION_TYPES.SELECT_GROUP,
                      group: res,
                      currentApplication: currentApplication,
                    });
                  }}
                  key={res?.id + "TRIGGER"}
                  className="cf_workdflow_app_container"
                >
                  <div className="cf_workdflow_app_header">
                    <GripVertical
                      size={20}
                      color="#64748b"
                      className="cf_workdflow_app_header_grip"
                    />
                    <img
                      src={cloudImageMapper(appName)}
                      alt="cloud"
                    />
                    <div>
                      <p style={{ fontWeight: "500", fontSize: "12px" }}>
                        {res?.groupName}
                      </p>
                    </div>
                    <div
                      style={{ marginLeft: "auto" }}
                      className="CF_d-flex ai-center CF_Pointer"
                      onClick={() => {
                        if (selectedGroup?.groupId === res?.groupId) {
                          setSelectedGroup(null);
                          setUserSearchValue("");
                        } else {
                          setSelectedGroup(res);
                          setUserSearchValue("");
                        }
                      }}
                    >
                      <ChevronDown
                        size={20}
                        color="#64748b"
                        style={{
                          transform:
                            selectedGroup?.groupId === res?.groupId
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                          transition: "all 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                  {selectedGroup?.groupId === res?.groupId && (
                    <>
                      <SearchComponent
                        autoOpen={true}
                        boxShadows={true}
                        inputName="userSearchInput"
                        customStyles={{ width: "100%", height: "40px", marginBottom: "10px" }}
                        customButtonStyles={{
                          background: "transparent",
                          color: "rgb(255, 255, 255)",
                          fontWeight: "bolder",
                          height: "35px",
                        }}
                        defaultValue={userSearchValue}
                        inputPlaceHolder={`Search By Email`}
                        onInputSearch={(e) => setUserSearchValue(e.userSearchInput || "")}
                      />
                      <div
                        className="cf_new_tables_div"
                        style={{ height: "fit-content", marginBottom: "10px" }}
                      >
                        <table className="cf_new_tables_div">
                          <thead>
                            <tr>
                              <th style={{ width: "80%", textAlign: "left" }}>Email</th>
                              <th style={{ width: "20%", textAlign: "left" }}>Role</th>
                            </tr>
                          </thead>
                          <tbody>

                            {filteredOwners?.map((owner) => (
                              <tr key={owner}>
                                <td title={owner} style={{ fontWeight: "500" }}>
                                  {getMaxChar(`${owner}`, 35)}</td>
                                <td style={{ fontWeight: "500" }}>Owner</td>
                              </tr>
                            ))}
                            {filteredMembers?.map((member) => (
                              <tr key={member}>
                                <td style={{ fontWeight: "500" }}>{getMaxChar(`${member}`, 35)}</td>
                                <td style={{ fontWeight: "500" }}>Member</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
                :
                <>
                  <div
                    className="cf_workdflow_cloud_license_item_license"
                    key={res?.groupId}
                    onClick={(e) => {
                      if (e.target.type !== "checkbox") {
                        handleGroupsSelection(
                          {
                            target: {
                              checked: selectedGroups?.find(
                                (group) => group?.groupId === res?.groupId
                              ) ? false : true
                            }
                          },
                          res,
                          `${appName}|${appId}`
                        );
                      }
                    }}
                  >
                    <img src={cloudImageMapper(appName)} alt={appName} />
                    <p>{res?.groupName}</p>
                    <span style={{ marginLeft: "auto" }}></span>
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        handleGroupsSelection(e, res, `${appName}|${appId}`);
                      }}
                      checked={selectedGroups?.find(
                        (group) => group?.groupId === res?.groupId
                      )}
                    />
                  </div>
                </>
            ))}
      </>}
    </div >
  );
};

export default FlowGroupsSelector;
