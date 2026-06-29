import { Plus } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
  isGroupUserManagementExist,
  newImplementation,
  notifyToast,
} from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import Popup from "../../../Resuables/Popup/Popup";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import {
  addMemebersToAGroup,
  removeMembersFromAGroup,
} from "../../SaaSManagement/SaaSActions/SaaSActions";
import { getGitHubUsersList } from "../DemoActions/DemoActions";

const SaaSManageGroupMembers = (props) => {
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [isAddMember, setIsAddMember] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const restrictHeaders = {
    noName: ["GOOGLE_WORKSPACE"],
  };

  const [newUsersList, setNewUsersList] = useState([]);
  const [selectedUsersList, setSelectedUsersList] = useState([]);
  const [addUsersSearchInput, setAddUsersSearchInput] = useState("");
  const [searchUsersListAPI, setSearchUsersListAPI] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [groupUsers, setGroupUsers] = useState([]);
  const [removeUsersList, setRemoveUsersList] = useState([]);
  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName, id, ssoIdpCloudId } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    if (props?.usersList?.length > 0) {
      setGroupUsers(props?.usersList);
      setRemoveUsersList([]);
    }
  }, [props?.usersList]);

  useEffect(() => {
    setSelectedUsersList([]);
    setNewUsersList([]);
  }, []);

  const searchDebounce = useRef(null);

  const searchUsersList = async (e) => {
    setUsersList([]);
    setAddUsersSearchInput(e?.searchInput);
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (e?.searchInput?.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        fetchSaaSUsersList(1, 100, "ALL", "ALL", "ALL", e?.searchInput);
      }, 500);
    } else {
      fetchSaaSUsersList(1, 100, "ALL", "ALL", "ALL", "");
    }
  };

  const fetchSaaSUsersList = async (
    pageNo = 1,
    pageSize = 100,
    orgName = "ALL",
    userType = "ALL",
    activeStatus = "ALL",
    searchValue = ""
  ) => {
    setIsLoading(true);
    let users = await getGitHubUsersList(
      props?.team?.externalSynced ? ssoIdpCloudId : id,
      pageNo,
      pageSize,
      orgName,
      providerName,
      userType,
      activeStatus,
      searchValue
    );
    if (users?.status === "OK" && users?.res) {
      if (users?.res?.data?.length > 0) {
        setUsersList(users?.res?.data);
      } else {
        notifyToast("error", "No Users Found", "top-left");
      }
      setIsLoading(false);
    } else {
      setIsLoading(false);
      notifyToast("error", "No Users Found", "top-left");
    }
  };

  const handleSelectUser = (e, user) => {
    if (e?.target?.checked) {
      setNewUsersList([...newUsersList, user]);
      setSelectedUsersList((prev) => [...prev, user?.email]);
    } else {
      setNewUsersList(newUsersList?.filter((u) => u?.email !== user?.email));
      setSelectedUsersList(selectedUsersList?.filter((u) => u !== user?.email));
    }
  };

  const addMembers = async () => {
    props?.setIsPageLoading(true);
    let res = await addMemebersToAGroup(
      props?.team?.groupId,
      id,
      providerName,
      false,
      newUsersList
    );
    if (
      res?.status === "OK" &&
      res?.res?.toLowerCase() !== "failure" &&
      res?.res?.toLowerCase() !== "failed"
    ) {
      props?.setIsPageLoading(false);

      let totalTeamsList = props?.currentGroupsList;
      let emailsList = newUsersList?.map((user) => user?.email);
      totalTeamsList?.map((team) => {
        if (team?.groupId === props?.team?.groupId) {
          team.members = [...team?.members, ...emailsList];
          props?.setCurrentTeam(team);
        }
      });
      props?.setTeamsList(totalTeamsList);
      setGroupUsers([...groupUsers, ...emailsList]);
      setNewUsersList([]);
      setSelectedUsersList([]);
      setUsersList([]);
      setAddUsersSearchInput("");
      notifyToast("success", "Members Added Successfully", "top-left");
      setIsAddMember(false);
    } else {
      setNewUsersList([]);
      setSelectedUsersList([]);
      setUsersList([]);
      setAddUsersSearchInput("");
      props?.setIsPageLoading(false);
      notifyToast("error", "Failed to Add Members", "top-left");
    }
  };

  const handleSelectUserRemove = (e, user) => {
    if (e?.target?.checked) {
      setRemoveUsersList([...removeUsersList, user]);
    } else {
      setRemoveUsersList(removeUsersList?.filter((u) => u !== user));
    }
  };

  const removeMembers = async () => {
    props?.setIsPageLoading(true);
    let removeUserListNew = [];

    removeUsersList?.map((user) => {
      removeUserListNew.push({
        email: user,
        adminCloudId: id,
      });
    });

    let res = await removeMembersFromAGroup(
      props?.team?.groupId,
      id,
      providerName,
      false,
      removeUserListNew
    );
    if (res?.status === "OK" && res?.res?.toLowerCase() !== "failure") {
      props?.setIsPageLoading(false);
      let totalTeamsList = props?.currentGroupsList;
      let newGroupUsers = groupUsers?.filter(
        (user) => !removeUsersList?.includes(user)
      );
      totalTeamsList?.map((team) => {
        if (team?.groupId === props?.team?.groupId) {
          team.members = newGroupUsers;
          props?.setCurrentTeam(team);
        }
      });
      props?.setTeamsList(totalTeamsList);
      setGroupUsers(newGroupUsers);
      setRemoveUsersList([]);
      notifyToast("success", "Members Removed Successfully", "top-left");
    } else {
      setRemoveUsersList([]);
      props?.setIsPageLoading(false);
      notifyToast("error", "Failed to Remove Members", "top-left");
    }
  };

  return (
    <>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          height: "fit-content",
          overflowY: "auto",
        }}
      >
        <div
          className="CF_d-flex ai-center"
          style={{ marginBottom: "10px", gap: "10px" }}
        >
          {providerName === "GUSTO" ||
          (props?.type === "Members" &&
            isGroupUserManagementExist?.includes(providerName)) ? (
            <>
              <ActionButton
                // customClass={`changeButtonColorOnHover`}
                customStyles={{
                  backgroundColor: "#f2f2f2",
                  padding: "8px 12px",
                  height: "40px",
                }}
                buttonType="button"
                buttonClickAction={() => {
                  setIsAddMember(true);
                  fetchSaaSUsersList();
                  setNewUsersList([]);
                  setSelectedUsersList([]);
                  setUsersList([]);
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <Plus size={14} />
                  <span style={{ fontSize: "12px" }}>
                    Add{" "}
                    {props?.type === "Members"
                      ? providerName === "GUSTO"
                        ? "Contractors"
                        : "Members"
                      : providerName === "GUSTO"
                      ? "Employees"
                      : "Owners"}
                  </span>
                </div>
              </ActionButton>
              {props?.type === "Members" && removeUsersList?.length > 0 && (
                <ActionButton
                  // customClass={`changeButtonColorOnHover`}
                  customStyles={{
                    backgroundColor: "#f2f2f2",
                    padding: "8px 12px",
                    height: "40px",
                  }}
                  buttonType="button"
                  buttonClickAction={() => {
                    removeMembers();
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    {/* <Plus size={14} /> */}
                    <span style={{ fontSize: "12px" }}>
                      Remove {props?.type}
                    </span>
                  </div>
                </ActionButton>
              )}
            </>
          ) : (
            ""
          )}

          <span style={{ marginLeft: "auto" }}></span>
          <SearchComponent
            autoOpen={true}
            boxShadows={true}
            inputName="searchInput"
            inputPlaceHolder={`Search By Email`}
            onInputSearch={(e) => setSearchInput(e?.searchInput)}
          />
        </div>
        <div className="cf_new_tables_div" style={{ height: "fit-content" }}>
          <table>
            <thead>
              <tr>
                {props?.type === "Members" &&
                isGroupUserManagementExist?.includes(providerName) ? (
                  <th style={{ width: "1%", textAlign: "center" }}></th>
                ) : (
                  ""
                )}
                {!newImplementation.includes(props?.vendorName) && (
                  <th style={{ width: "35%", textAlign: "left" }}>Name</th>
                )}
                <th style={{ width: "60%", textAlign: "left" }}>
                  {props?.vendorName === "BITBUCKET" ? `Name` : `Email`}
                </th>
              </tr>
            </thead>
            <tbody>
              {groupUsers
                ?.filter(
                  (user) =>
                    user?.email
                      ?.toLowerCase()
                      ?.includes(searchInput?.toLowerCase()) ||
                    user?.toLowerCase()?.includes(searchInput?.toLowerCase())
                )
                ?.map((user) => (
                  <tr>
                    {props?.type === "Members" &&
                    isGroupUserManagementExist?.includes(providerName) ? (
                      <td>
                        <input
                          type="checkbox"
                          onChange={(e) => handleSelectUserRemove(e, user)}
                          checked={removeUsersList?.includes(user)}
                        />
                      </td>
                    ) : (
                      ""
                    )}
                    {!newImplementation.includes(props?.vendorName) && (
                      <td style={{ fontWeight: "500" }}>{user?.displayName}</td>
                    )}
                    <td style={{ fontWeight: "500", textAlign: "left" }}>
                      {newImplementation.includes(props?.vendorName)
                        ? user
                        : user?.email ?? "-"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <Popup
        options={{
          isOpen: isAddMember,
          title: `Add  ${
            props?.type === "Members"
              ? providerName === "GUSTO"
                ? "Contractors"
                : "Members"
              : providerName === "GUSTO"
              ? "Employees"
              : "Owners"
          }`,
          popupWidth: "60%",
          type: "side",
          popupHeight: "calc(100% - 00px)",
          popupTop: "00px",
          maxHeight: "100%",
          overflowY: "auto",
          titleCustomStyles: {
            fontSize: "16px",
            fontWeight: "600",
          },
          parentStyles: {
            justifyContent: "flex-end",
          },
        }}
        toggleOpen={setIsAddMember}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "0 15px 15px 15px",
            height: "100%",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              padding: "10px 0 0 0",
              flexDirection: "column",
              height: "fit-content",
              overflowY: "auto",
            }}
          >
            <div
              className="CF_d-flex ai-center"
              style={{ marginBottom: "10px" }}
            >
              <SearchComponent
                autoOpen={true}
                boxShadows={true}
                inputName="searchInput"
                customStyles={{
                  width: "100%",
                }}
                customSearchButtonStyles={{
                  width: "40px",
                  marginLeft: "auto",
                }}
                inputPlaceHolder={`Search For User`}
                defaultValue={addUsersSearchInput}
                onInputSearch={(e) => searchUsersList(e)}
              />
            </div>

            <div
              className="cf_new_tables_div"
              style={{ height: "fit-content" }}
            >
              <table>
                <thead>
                  <tr>
                    {/* <th style={{ width: "5%", textAlign: "center" }}></th> */}
                    {!newImplementation.includes(props?.vendorName) && (
                      <th style={{ width: "35%", textAlign: "left" }}>Name</th>
                    )}
                    <th style={{ width: "5%", textAlign: "center" }}></th>
                    <th style={{ width: "60%", textAlign: "left" }}>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={2}>{getCFTextLoader()}</td>
                    </tr>
                  ) : (
                    ""
                  )}
                  {usersList?.map(
                    (user) =>
                      user?.email && (
                        <tr>
                          <td style={{ width: "5px", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              onChange={(e) => handleSelectUser(e, user)}
                              checked={selectedUsersList?.includes(user?.email)}
                              disabled={
                                providerName === "MONGODBATLAS"
                                  ? !user?.isActive
                                  : providerName === "GUSTO"
                                  ? props?.type === "Owners" &&
                                    user?.userType === "CONTRACTOR"
                                    ? true
                                    : props?.type === "Members" &&
                                      user?.userType === "EMPLOYEE"
                                    ? true
                                    : false || groupUsers?.includes(user?.email)
                                  : groupUsers?.includes(user?.email)
                              }
                              title={
                                providerName === "MONGODBATLAS"
                                  ? !user?.isActive
                                    ? "User is inactive"
                                    : ""
                                  : groupUsers?.includes(user?.email)
                                  ? "User Already Exists in Group"
                                  : ""
                              }
                            />
                          </td>
                          <td style={{ fontWeight: "500", textAlign: "left" }}>
                            <p style={{ position: "relative" }}>
                              {user?.email ?? "-"}
                              {user?.userType === "CONTRACTOR" ? (
                                <span
                                  style={{
                                    color: "#0062ff",
                                    fontSize: "8px",
                                    position: "absolute",
                                    top: "-1px",
                                    fontWeight: "600",
                                  }}
                                >
                                  &nbsp; Contractor
                                </span>
                              ) : (
                                ""
                              )}
                            </p>
                          </td>
                        </tr>
                      )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div
          className="cf_popup_container_footer"
          style={{ gap: "10px", paddingBottom: "5px" }}
        >
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={isPageLoading}
            isDisabled={newUsersList?.length === 0 && !isPageLoading}
            buttonName="Add"
            buttonClickAction={() => addMembers("add")}
          />
        </div>
      </Popup>
      {/* {isPageLoading ? getCFLoader() : ""} */}
    </>
  );
};

export default SaaSManageGroupMembers;
