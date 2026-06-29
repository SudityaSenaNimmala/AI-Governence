import md5 from "md5";
import React, { useContext, useEffect, useState } from "react";
import { IoMdClose } from "react-icons/io";
import { IoTrashOutline } from "react-icons/io5";
import { MdOutlineEdit } from "react-icons/md";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import Popup from "../../../Resuables/Popup/Popup";
import SelectDropDown from "../../../Resuables/SelectDropDown/SelectDropDown";
import {
  env,
  notifyToast,
  validateEmail,
  validatePassword,
} from "../../../helpers/utils";
import {
  findUserByEmail,
  registerUser,
} from "../../Login/AuthActions/AuthActions";
import {
  deleteExistingUser,
  getDomainUsersList,
  getUserRoles,
  updateExistingUser,
} from "../SettingsActions/SettingsActions";
import MFA from "./MFA";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { SET_CF_USER } from "../../../../GlobalContext/action.types";

const UserManagement = (props) => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const { user } = globalContext;
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [deleteObject, setDeleteObject] = useState({});
  const [isPageLoading, setIspageLoading] = useState(false);
  const [rolesList, setRolesList] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [updateUser, setUpdateUser] = useState({});
  const [isMFAEnabled, setIsMFAEnabled] = useState(false);
  const [mfaUser, setMfaUser] = useState({});
  const [isMFAPopupOpen, setIsMFAPopupOpen] = useState(false);
  const [mfaStatus, setMfaStatus] = useState({
    isEnabled: false,
    isValid: false,
  });
  const [newUserForm, setNewUserForm] = useState({
    name: "",
    email: "",
    password: "",
    phoneNumber: "",
    domain:
      env === "DEV"
        ? JSON.parse(localStorage?.globalState)?.user?.domain
        : window.location.host.split(".")[0],
    role: "",
    employeeCount: "",
  });

  const [errorFileds, setErrorFields] = useState({});
  useEffect(() => {
    setIspageLoading(true);
    getAvailableRoles();
  }, []);

  const getAvailableRoles = async () => {
    let roles = await getUserRoles();
    if (roles?.status === "OK") {
      setRolesList(roles?.res);
      setIspageLoading(false);
    } else {
      notifyToast("error", "Failed To Get Roles");
      setIspageLoading(false);
    }
    getUserList();
  };

  const getUserList = async () => {
    setIspageLoading(true);
    let usersList = await getDomainUsersList();
    if (usersList?.status === "OK") {
      setUsersList(usersList?.res);
      setIspageLoading(false);
    } else {
      setIspageLoading(false);
      notifyToast("error", "Failed To Get Users List");
    }
  };

  const handleForm = (value, key) => {
    if (updateUser?.email) {
      setUpdateUser({ ...updateUser, [key]: value });
    } else {
      setErrorFields({ ...errorFileds, [key]: "" });
      setNewUserForm({ ...newUserForm, [key]: value });
    }
  };

  const createUser = async () => {
    setIsLoading(true);
    let pass = validatePassword(newUserForm?.password);
    let canProceed = true;
    let errObj = { ...errorFileds };
    if (!newUserForm?.name) {
      errObj.name = "Name is required...";
      canProceed = false;
    }

    if (pass) {
      errObj.password = pass;
      canProceed = false;
    }

    if (!validateEmail(newUserForm?.email)) {
      errObj.email = "Invalid Email...";
      canProceed = false;
    }
    setErrorFields({ ...errorFileds, ...errObj });
    if (canProceed) {
      setIsLoading(true);
      let checkUserExist = await findUserByEmail(newUserForm?.email);
      if (checkUserExist?.res === "User Email Does not Exists") {
        let copyUser = { ...newUserForm };
        copyUser.password = md5(copyUser.password);
        copyUser.role = copyUser?.role?.name;
        copyUser.hasContentSprawl = user?.hasContentSprawl === true;
        let newUser = await registerUser(copyUser);
        if (newUser?.status === "OK") {
          resetForm();
          getUserList();
          notifyToast("success", "User Created Successfully...");
        } else {
          resetForm();
          notifyToast("error", "Failed To Create User...");
        }
        setIsLoading(false);
      } else {
        setIsLoading(false);
        notifyToast("error", checkUserExist?.res);
      }
    } else {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setNewUserForm({
      name: "",
      email: "",
      password: "",
      phoneNumber: "",
      domain:
        env === "DEV"
          ? JSON.parse(localStorage?.globalState)?.user?.domain
          : window.location.host.split(".")[0],
      role: "",
      employeeCount: "",
    });
  };

  const updateExtUser = async (
    userObject = {},
    isTwoFaChange = false,
    value = false,
    currentIndex = 0,
    isMFAChange = false,
  ) => {
    setIspageLoading(true);
    let copyUpdateUser = { ...userObject };
    if (updateUser?.id) {
      copyUpdateUser = { ...updateUser };
    }
    if (isMFAChange) {
      copyUpdateUser.isTwoFaEnable = false;
      copyUpdateUser.mfaEnable = value;
      copyUpdateUser.contentUserId = value ? mfaStatus?.secretKey : null;
    } else if (isTwoFaChange) {
      copyUpdateUser.isTwoFaEnable = value;
      copyUpdateUser.mfaEnable = false;
      copyUpdateUser.contentUserId = null;
    } else {
      copyUpdateUser.roles = copyUpdateUser?.roles[0]?.name;
    }
    let newUpadate = await updateExistingUser(copyUpdateUser);
    if (newUpadate?.status === "OK") {
      setUpdateUser("");
      dispatch({ type: SET_CF_USER, payload: newUpadate?.res });
      if (isTwoFaChange) {
        let deUsers = [...usersList];
        deUsers[currentIndex] = newUpadate?.res;
        setUsersList(deUsers);
      } else {
        getUserList();
      }
      notifyToast("success", "User Updated Successfully...");
      setIspageLoading(false);
    } else {
      setIspageLoading(false);
      notifyToast("error", "Failed To Update User...");
    }
  };

  const deleteUser = async () => {
    setIspageLoading(true);
    setIsVisible(false);
    let res = await deleteExistingUser(deleteObject);
    if (res?.status === "OK") {
      let findIndex = usersList.findIndex(
        (data) => data?.id === deleteObject?.id
      );
      usersList.splice(findIndex, 1);
      setUsersList([...usersList]);
      notifyToast("success", "User Deleted Successfully...");
      setIspageLoading(false);
    } else {
      setIspageLoading(false);
      notifyToast("success", "User Deleted Successfully...");
    }
  };


  const enableMFA = async (isEnabled, data, index) => {
    setIsMFAPopupOpen(true);
    setMfaStatus({
      action: isEnabled ? "ENABLE" : "DISABLE",
      isEnabled: data?.mfaEnable,
      isValid: false,
      userIndex: index,
    })
  }

  useEffect(() => {
    if (mfaStatus?.isValid) {
      updateExtUser(user, false, mfaStatus?.action === "ENABLE", mfaStatus?.userIndex, true);
      setMfaStatus({
        action: "",
        isEnabled: false,
        isValid: false,
      });
      setIsMFAPopupOpen(false);
    }
  }, [mfaStatus]);


  return (
    <>
      <div className="cf_usermanagement_container">
        <div className="cf_usermanagement_container_title">
          <h2>User Management</h2>
          <div
            className="cf_usermanagement_close"
            onClick={() => props?.changeClick(false)}
          >
            <IoMdClose />
          </div>
        </div>
        <div className="cf_usermanagement_container_body">
          <>
            <div className="cf_usermanagement_container_body_part1">
              <div
                style={{
                  height: "50px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <h2 style={{ fontWeight: "500" }}>
                  {updateUser?.email ? "Update User" : "Create User"}
                </h2>
              </div>
              <div>
                <TextInput
                  type="text"
                  placeHolder="Name *"
                  inputName="name"
                  defaultValue={updateUser?.name ?? newUserForm?.name}
                  autoFocus={true}
                  errorData={errorFileds?.name}
                  inputWidth="100%"
                  getInputText={(val, name) => handleForm(val, name)}
                />
              </div>
              {updateUser?.email ? (
                ""
              ) : (
                <>
                  <div>
                    <TextInput
                      type="email"
                      placeHolder="Email *"
                      inputName="email"
                      autoFocus={false}
                      inputWidth="100%"
                      errorData={errorFileds?.email}
                      defaultValue={updateUser?.email ?? newUserForm?.email}
                      getInputText={(val, name) => handleForm(val, name)}
                    />
                  </div>
                  <div>
                    <TextInput
                      type="password"
                      placeHolder="Password *"
                      inputName="password"
                      autoFocus={false}
                      inputWidth="100%"
                      errorData={errorFileds?.password}
                      defaultValue={
                        updateUser?.password ?? newUserForm?.password
                      }
                      getInputText={(val, name) => handleForm(val, name)}
                    />
                  </div>
                </>
              )}
              <div>
                <SelectDropDown
                  onSelect={(e) => handleForm(e, "role")}
                  placeHolder="Select Role"
                  defaultSelected={
                    updateUser?.roles ? updateUser?.roles[0] : newUserForm?.role
                  }
                  dropDownContent={rolesList}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                {updateUser?.email ? (
                  <>
                    <ButtonComponent
                      isLoading={false}
                      isDisabled={false}
                      inputWidth="48%"
                      buttonName="Update User"
                      buttonClickAction={() => updateExtUser()}
                    />
                    <ButtonComponent
                      customstyles={{
                        background: "#f2f2f2",
                        color: "#000",
                        border: "1px solid #ddd",
                      }}
                      isLoading={false}
                      isDisabled={false}
                      inputWidth="48%"
                      buttonName="Cancel"
                      buttonClickAction={() => setUpdateUser("")}
                    />
                  </>
                ) : (
                  <ButtonComponent
                    isLoading={false}
                    isDisabled={false}
                    inputWidth={updateUser?.email ? "48%" : "100%"}
                    buttonName={
                      updateUser?.email ? "Update User" : "Create User"
                    }
                    buttonClickAction={() => createUser()}
                  />
                )}
              </div>
            </div>
            <div className="cf_usermanagement_container_body_part2">
              <table className="cf_message_table">
                <thead>
                  <tr>
                    <th style={{ width: "25%" }}>Name</th>
                    <th style={{ width: "30%" }}>Email</th>
                    <th style={{ width: "15%" }}>Role</th>
                    <th style={{ width: "15%" }}>2FA</th>
                    <th style={{ width: "15%" }}>MFA</th>
                    <th style={{ width: "10%" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList?.map((data, index) => {
                    return (
                      <tr key={data?.id}>
                        <td>{data?.name}</td>
                        <td>{data?.email}</td>
                        <td>{data?.roles ? data?.roles[0]?.name : "-"}</td>
                        <td>
                          <label className="switch">
                            <input
                              type="checkbox"
                              onChange={(e) =>
                                updateExtUser(
                                  data,
                                  true,
                                  e.target.checked,
                                  index
                                )
                              }
                              checked={data?.isTwoFaEnable}
                            />
                            <span className="slider round"></span>
                          </label>
                        </td>
                        <td style={{ cursor: user?.email === data?.email ? "auto" : "not-allowed" }}>
                          <label className={`switch ${user?.email === data?.email ? "" : "cf_disabled_switch"}`}>
                            <input
                              type="checkbox"
                              onChange={(e) => {
                                enableMFA(e.target.checked, data, index);
                              }
                              }
                              checked={data?.mfaEnable}
                            />
                            <span className="slider round"></span>
                          </label>
                        </td>
                        <td>
                          <div className="cf_users_action_pannel">
                            <div
                              onClick={() => {
                                setUpdateUser(data);
                              }}
                            >
                              <MdOutlineEdit />
                            </div>
                            <div
                              onClick={() => {
                                setUpdateUser({});
                                setDeleteObject(data);
                                setIsVisible(true);
                              }}
                            >
                              <IoTrashOutline />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: isVisible,
          title: `Delete User`,
          popupWidth: "30%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
        >
          <p style={{ fontWeight: "600" }}>
            Are you sure you want to delete the user ?{" "}
          </p>
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{
              marginLeft: "auto",
              background: "#f2f2f2",
              color: "#000",
              border: "1px solid #ddd",
            }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="No"
            buttonClickAction={() => {
              setIsVisible(false);
              setDeleteObject({});
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => deleteUser()}
          />
        </div>
      </Popup>
      {isMFAPopupOpen ? <MFA isPopupOpen={isMFAPopupOpen} onClose={() => setIsMFAPopupOpen(false)} mfaStatus={mfaStatus} setMfaStatus={setMfaStatus} /> : ""}
    </>
  );
};

export default UserManagement;
