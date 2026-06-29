import { useContext, useEffect, useRef, useState } from "react";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import Popup from "../../../Resuables/Popup/Popup";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getSaaSRolesForApplication, getVendorSearch, manualTriggerWorkflow } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { getUniqueUsersList } from "../../Dashboard/DashboardActions/DashboardActions";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { notifyToast } from "../../../helpers/utils";
import CronExpressionBuilder from "../../../Resuables/CronExpressionBuilder/CronExpressionBuilder";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  displayName: "",
  email: "",
  department: "",
  location: "",
  jobTitle: "",
  division: "",
  phoneNumber: "",
};

const SuggestInput = ({ label, value, onChange, suggestions, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [filtered, setFiltered] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (val) => {
    onChange(val);
    const q = val.toLowerCase();
    setFiltered(suggestions.filter((s) => s.toLowerCase().includes(q)));
    setOpen(true);
  };

  const handleSelect = (item) => {
    onChange(item);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: "calc(50% - 5px)" }}>
      <label style={{ fontSize: "11px", fontWeight: "600", color: "#555", marginBottom: "4px", display: "block" }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder || label}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setFiltered(suggestions.filter((s) => !value || s.toLowerCase().includes(value.toLowerCase())));
          setOpen(true);
        }}
        style={{
          width: "100%",
          height: "36px",
          border: "1px solid #ddd",
          borderRadius: "5px",
          padding: "0 10px",
          fontSize: "12px",
          outline: "none",
          boxSizing: "border-box",
          background: "#fff",
        }}
      />
      {open && filtered.length > 0 && (
        <ul
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            maxHeight: "160px",
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: "5px",
            zIndex: 999,
            margin: 0,
            padding: 0,
            listStyle: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          {filtered.map((item) => (
            <li
              key={item}
              onMouseDown={() => handleSelect(item)}
              style={{
                padding: "8px 10px",
                fontSize: "12px",
                cursor: "pointer",
                borderBottom: "1px solid #f0f0f0",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const TextInput = ({ label, value, onChange, placeholder, type = "text", required = false }) => (
  <div style={{ flex: 1, minWidth: "calc(50% - 5px)" }}>
    <label style={{ fontSize: "11px", fontWeight: "600", color: "#555", marginBottom: "4px", display: "block" }}>
      {label}{required && <span style={{ color: "#e53e3e", marginLeft: "2px" }}>*</span>}
    </label>
    <input
      type={type}
      value={value}
      placeholder={placeholder || label}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        height: "36px",
        border: "1px solid #ddd",
        borderRadius: "5px",
        padding: "0 10px",
        fontSize: "12px",
        outline: "none",
        boxSizing: "border-box",
        background: "#fff",
      }}
    />
  </div>
);

const ManualTriggerComponent   = ({
  isManualTriggerOpen,
  setIsManualTriggerOpen,
  manualTriggerWorkFlow,
  setIsPageLoading = null,
}) => {
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [userMode, setUserMode] = useState(null); // null | "existing" | "new"
  const [userList, setUserList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [selectedUsersEmail, setSelectedUsersEmail] = useState([]);
  const [isScheduleForLater, setIsScheduleForLater] = useState(false);
  const [selectedCron, setSelectedCron] = useState({});
  const [selectedUserMap, setSelectedUserMap] = useState({});
  const [newUserForm, setNewUserForm] = useState(EMPTY_FORM);
  const [actionsList, setActionsList] = useState({ titles: [], locations: [], divisions: [], departMents: [] });

  useEffect(() => {
    if (manualTriggerWorkFlow) {
      setSearchInput("");
      setSelectedUsersEmail([]);
      setNewUserForm(EMPTY_FORM);
      setIsScheduleForLater(false);
      if (manualTriggerWorkFlow?.workFlowName === "OFFBOARD") {
        setUserMode("existing");
        getUserList();
      } else {
        setUserMode(null);
        setUserList([]);
      }
    }
  }, [manualTriggerWorkFlow]);

  const getUserList = async () => {
    setIsLoading(true);
    let res = await getUniqueUsersList(1, 20, "ALL");
    if (res?.status === "OK") {
      setUserList(res?.res?.data);
      setIsLoading(false);
    } else {
      setIsLoading(false);
      notifyToast("error", "Failed to get user list");
    }
  };

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

  const handleModeSelect = (mode) => {
    setUserMode(mode);
    if (mode === "existing") {
      getUserList();
    } else if (mode === "new") {
      let app = cloudsList?.find((cloud) => cloud?.primaryApp);
      const appName = app?.providerName;
      const adminCloudId = app?.id;
      if (appName) {
        getConfigurations(appName, adminCloudId);
      }
    }
  };

  const searchUsers = async (searchValue) => {
    setIsLoading(true);
    let res = await getVendorSearch(
      "UNIQUUSERSSEARCH",
      "unqusers",
      searchValue?.trim(),
      false,
      "ALL"
    );
    if (res?.status === "OK") {
      if (res?.res?.data?.length > 0) {
        setUserList(res?.res?.data);
      }
    }
    setIsLoading(false);
  };

  const searchDebounce = useRef(null);
  const searchWithThrottle = async (searchValue) => {
    if (searchDebounce.current) clearInterval(searchDebounce.current);
    if (searchValue.length > 0) {
      searchDebounce.current = setTimeout(() => searchUsers(searchValue), 500);
    } else {
      setIsLoading(true);
      getUserList();
      setIsLoading(false);
    }
  };

  const buildApiBody = () => {
    if (userMode === "existing") {
      return selectedUsersEmail.map((email) => ({
        ...manualTriggerWorkFlow,
        primaryEmail: email,
        adminCloudId: selectedUserMap[email],
      }));
    }
    return [
      {
        ...manualTriggerWorkFlow,
        primaryEmail: newUserForm.email?.trim(),
        onBoardUser: {
          email: newUserForm.email?.trim(),
          adminCloudId: null,
          firstName: newUserForm.firstName?.trim(),
          lastName: newUserForm.lastName?.trim(),
          name: `${newUserForm.firstName} ${newUserForm.lastName}`.trim(),
          displayName: newUserForm.displayName?.trim(),
          phonenumber: newUserForm.phoneNumber,
          location: newUserForm.location.trim() || null,
          jobTitle: newUserForm.jobTitle.trim() || null,
          department: newUserForm.department.trim() || null,
          division: newUserForm.division.trim() || null,
        }
      },
    ];
  };

  const isFormValid = () => {
    if (userMode === "existing") return selectedUsersEmail.length > 0;
    return newUserForm.email.trim().length > 0;
  };

  const triggerWorkflow = async () => {
    setIsPageLoading(true);
    let res = await manualTriggerWorkflow(buildApiBody());
    setIsPageLoading(false);
    setIsManualTriggerOpen(false);
    if (res?.status === "OK") {
      notifyToast("success", "Workflow triggered successfully");
    } else {
      notifyToast("error", "Failed to trigger workflow");
    }
  };

  const handleCronClose = () => {
    setSelectedCron({});
    setIsScheduleForLater(false);
  };

  const handleCronSave = async (cronExpression) => {
    setSelectedCron({});
    setIsPageLoading(true);
    const body = buildApiBody().map((item) => ({
      ...item,
      cronExpression,
      reccuring: false,
    }));
    let res = await manualTriggerWorkflow(body);
    setIsPageLoading(false);
    setIsManualTriggerOpen(false);
    if (res?.status === "OK") {
      notifyToast("success", "Workflow triggered successfully");
    } else {
      notifyToast("error", "Failed to trigger workflow");
    }
  };

  const setField = (field) => (val) => setNewUserForm((prev) => ({ ...prev, [field]: val }));

  const renderModeSelector = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px", padding: "10px 0" }}>
      {[
        {
          mode: "existing",
          label: "Choose From Existing User",
          desc: "Select a user from your existing user list.",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          ),
        },
        {
          mode: "new",
          label: "Create A New User",
          desc: "Fill in details to onboard a new user.",
          icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          ),
        },
      ].map(({ mode, label, desc, icon }) => (
        <div
          key={mode}
          onClick={() => handleModeSelect(mode)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "16px 14px",
            cursor: "pointer",
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: "8px",
            marginBottom: "8px",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#001a6f";
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,26,111,0.1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#e8e8e8";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              minWidth: "44px",
              borderRadius: "8px",
              background: "#001a6f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: "600", color: "#1a1a1a" }}>{label}</p>
            <p style={{ margin: "3px 0 0 0", fontSize: "11px", color: "#888" }}>{desc}</p>
          </div>
        </div>
      ))}
    </div>
  );

  const renderExistingUsers = () => (
    <>
      <div className="CF_d-flex ai-center" style={{ marginBottom: "10px", gap: "10px" }}>
        <SearchComponent
          defaultVal={searchInput}
          autoOpen={true}
          boxShadows={true}
          inputName="searchInput"
          inputPlaceHolder="Search By Email"
          onInputSearch={(e) => searchWithThrottle(e?.searchInput)}
        />
      </div>
      <div className="cf_new_tables_div" style={{ height: "fit-content" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: "1%", textAlign: "center" }}></th>
              <th style={{ width: "60%", textAlign: "left" }}>Email</th>
            </tr>
          </thead>
          <tbody>
            {userList?.map((user) => (
              <tr key={user?.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedUsersEmail.includes(user?.email)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedUserMap((prev) => ({
                          ...prev,
                          [user?.email]: user?.vendorAdminCloudId?.length > 0
                            ? user?.vendorAdminCloudId[0]?.split(":")[1]
                            : null,
                        }));
                        setSelectedUsersEmail((prev) => [...prev, user?.email]);
                      } else {
                        setSelectedUserMap((prev) => {
                          const next = { ...prev };
                          delete next[user?.email];
                          return next;
                        });
                        setSelectedUsersEmail((prev) => prev.filter((e) => e !== user?.email));
                      }
                    }}
                  />
                </td>
                <td style={{ fontWeight: "500", textAlign: "left" }}>
                  <p style={{ position: "relative" }}>
                    <span style={{ fontWeight: "500" }}>{user?.email ?? "-"}</span>
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const renderNewUserForm = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "10px" }}>
      <div style={{ borderBottom: "1px solid #eee", paddingBottom: "10px", marginBottom: "2px" }}>
        <p style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#001a6f" }}>New User Creation</p>
        <p style={{ margin: "3px 0 0 0", fontSize: "11px", color: "#888" }}>Fill in the details to onboard a new user into this workflow.</p>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <TextInput label="First Name" value={newUserForm.firstName} onChange={setField("firstName")} required />
        <TextInput label="Last Name" value={newUserForm.lastName} onChange={setField("lastName")} required />
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <TextInput label="Display Name" value={newUserForm.displayName} onChange={setField("displayName")} required />
        <TextInput label="Preferred Email" value={newUserForm.email} onChange={setField("email")} type="email" required />
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <SuggestInput
          label="Department"
          value={newUserForm.department}
          onChange={setField("department")}
          suggestions={actionsList.departMents}
        />
        <SuggestInput
          label="Location"
          value={newUserForm.location}
          onChange={setField("location")}
          suggestions={actionsList.locations}
        />
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <SuggestInput
          label="Job Title"
          value={newUserForm.jobTitle}
          onChange={setField("jobTitle")}
          suggestions={actionsList.titles}
        />
        <SuggestInput
          label="Division"
          value={newUserForm.division}
          onChange={setField("division")}
          suggestions={actionsList.divisions}
        />
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <TextInput
          label="Phone Number"
          value={newUserForm.phoneNumber}
          onChange={(val) => setNewUserForm((prev) => ({ ...prev, phoneNumber: val.replace(/[^0-9+]/g, "") }))}
          type="tel"
        />
        <div style={{ flex: 1, minWidth: "calc(50% - 5px)" }} />
      </div>
    </div>
  );

  return (
    <Popup
      options={{
        isOpen: isManualTriggerOpen,
        title: "Manual Trigger Workflow",
        popupWidth: "40%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "00px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: { justifyContent: "flex-end" },
      }}
      toggleOpen={setIsManualTriggerOpen}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "calc(100% - 50px)",
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
            height: "100%",
            overflowY: "auto",
          }}
        >
          {isScheduleForLater ? (
            <CronExpressionBuilder
              defaultValue={selectedCron?.cronExpression}
              onClose={handleCronClose}
              onSave={handleCronSave}
              isOnlyOnce={true}
            />
          ) : (
            <>
              {!userMode && renderModeSelector()}
              {userMode === "existing" && renderExistingUsers()}
              {userMode === "new" && renderNewUserForm()}
            </>
          )}
        </div>
        {isLoading ? getCFTextLoader() : ""}
      </div>

      <div className="cf_popup_container_footer" style={{ gap: "20px" }}>
        {!isScheduleForLater && userMode && (
          <>
            {userMode && (
              <ActionButton
                buttonType="button"
                customClass="changeButtonColorOnHover"
                customStyles={{
                  marginRight: "auto",
                  padding: "0 10px",
                  height: "40px",
                  borderRadius: "5px",
                  backgroundColor: "rgb(242, 242, 242)",
                }}
                buttonClickAction={() => {
                  setUserMode(null);
                  setSelectedUsersEmail([]);
                  setNewUserForm(EMPTY_FORM);
                }}
              >
                <p style={{ fontSize: "12px", fontWeight: "500" }}>Back</p>
              </ActionButton>
            )}
            <ActionButton
              buttonType="button"
              customClass={`changeButtonColorOnHover ${!isFormValid() ? "cf_button_disabled" : ""}`}
              customStyles={{
                marginLeft: "auto",
                padding: "0 10px",
                height: "40px",
                borderRadius: "5px",
                backgroundColor: "rgb(242, 242, 242)",
              }}
              buttonClickAction={() => isFormValid() && setIsScheduleForLater(true)}
            >
              <p style={{ fontSize: "12px", fontWeight: "500" }}>Schedule For Later</p>
            </ActionButton>
            <ActionButton
              buttonType="button"
              customClass={`changeButtonColorOnHover ${!isFormValid() ? "cf_button_disabled" : ""}`}
              customStyles={{
                padding: "0 10px",
                height: "40px",
                borderRadius: "5px",
                backgroundColor: "rgb(242, 242, 242)",
              }}
              buttonClickAction={() => isFormValid() && triggerWorkflow()}
            >
              <p style={{ fontSize: "12px", fontWeight: "500" }}>Run Workflow</p>
            </ActionButton>
          </>
        )}
      </div>
    </Popup>
  );
};

export default ManualTriggerComponent;
