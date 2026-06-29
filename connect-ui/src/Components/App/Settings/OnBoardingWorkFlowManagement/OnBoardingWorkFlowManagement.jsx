import React, { useContext, useEffect, useState } from "react";
import { IoMdClose } from "react-icons/io";
import { IoTrashOutline } from "react-icons/io5";
import { MdOutlineEdit } from "react-icons/md";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../Resuables/Loaders/Loaders";
import Popup from "../../../Resuables/Popup/Popup";
import SelectDropDown from "../../../Resuables/SelectDropDown/SelectDropDown";
import { env, getMaxChar, notifyToast } from "../../../helpers/utils";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import CustomToolTip from "../../../Resuables/CustomToolTip/CustomToolTip";
import { getLicensesList } from "../../SaaSManagement/SaaSActions/SaaSActions";
import CustomCheckBox from "../../../Resuables/InputsComponents/CustomCheckBox";
import { getCloudName } from "../../../helpers/helpers";
import { Trash2 } from "lucide-react";
import { addRoles, getRoles } from "../SettingsActions/SettingsActions";
import SideNav from "../../../Resuables/Nav/SideNav";
import TopNav from "../../../Resuables/Nav/TopNav";

const OnBoardingWorkFlowManagement = () => {
  const { globalContext } = useContext(GlobalContext);
  const [selectedLicenceInfo, setSelectedLicenceInfo] = useState({
    cloudName: "",
    licencesList: [],
    isLicenceLoaded: false,
    selectedLicencesList: [],
  });
  const [licencePreviewList, setLicencePreviewList] = useState([]);
  const [fetchRolesList, setFetchRolesList] = useState([]);
  const [licencePopupVisible, setLicencePopupVisible] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [deleteObject, setDeleteObject] = useState({});
  const [isPageLoading, setIspageLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState({
    key: "SOFTWARE_ENGINEER",
    name: "Software Engineer",
  });
  const [rolesList] = useState([
    {
      key: "SOFTWARE_ENGINEER",
      name: "Software Engineer",
    },
    {
      key: "SENIOR_SOFTWARE_ENGINEER",
      name: "Senior Software Engineer",
    },
    {
      key: "MANAGER",
      name: "Manager",
    },
    {
      key: "ARCHITECT",
      name: "Architect",
    },
    {
      key: "HR",
      name: "Human Resources",
    },
    {
      key: "OTHER",
      name: "Other",
    },
  ]);
  const [usersList, setUsersList] = useState([]);
  const [updateUser, setUpdateUser] = useState({});

  const { cloudsList } = { ...globalContext };

  const onBoardingCloudsList = [
    "MICROSOFT_OFFICE_365",
    "MICROSOFT_TEAMS",
    "GOOGLE_WORKSPACE",
    "BOX_BUSINESS",
    "SHARE_FILE_BUSINESS",
    "GITHUB",
  ];

  const getListLicences = async (memberId, cloudName) => {
    setSelectedLicenceInfo({
      ...selectedLicenceInfo,
      cloudName: cloudName,
      isLicenceLoaded: false,
      licencesList: [],
      selectedLicencesList: [],
    });
    let res = await getLicensesList(memberId, cloudName);
    if (res?.status === "OK") {
      let licInfo = { ...selectedLicenceInfo };
      licInfo.cloudName = cloudName;
      licInfo.isLicenceLoaded = true;
      licInfo.licencesList = res?.res;
      licInfo.selectedLicencesList = [];
      setSelectedLicenceInfo({ ...licInfo });
    }
  };

  const saveSelectedLicences = () => {
    setLicencePreviewList({
      ...licencePreviewList,
      [selectedLicenceInfo?.cloudName]:
        selectedLicenceInfo?.selectedLicencesList,
    });
    setLicencePopupVisible(false);
  };

  const addRole = async () => {
    let body = [
      {
        role: selectedRole?.key,
        licenses: licencePreviewList,
      },
    ];
    let res = await addRoles(body);
    if (res?.status === "OK") {
      setLicencePreviewList({});
      getRole();
      notifyToast("success", "Role Added Successfully");
    }
  };

  const getRole = async () => {
    setIspageLoading(true);
    let res = await getRoles();
    if (res?.status === "OK") {
      setFetchRolesList(res?.res);
      setIspageLoading(false);
    } else {
      setIspageLoading(false);
    }
  };

  useEffect(() => {
    getRole();
  }, []);

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="User Management" />
        <div className="cf_main_content_place">
          <TopNav
            pageName="Manage Onboarding Workflows"
            backLink="/UserManagement"
          />
          <div
            className="cf_main_content_place_main"
            style={{ padding: "10px 0", gap: "15px" }}
          >
            <div
              className="cf_usermanagement_container_body"
              style={{ height: "100%" }}
            >
              <>
                <div
                  className="cf_usermanagement_container_body_part1"
                  style={{ overflow: "auto", width: "40%" }}
                >
                  <div
                    style={{
                      height: "50px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <h2 style={{ fontWeight: "500" }}>
                      Create OnBoarding Workflow
                    </h2>
                  </div>
                  <div>
                    <SelectDropDown
                      onSelect={(e) => setSelectedRole(e)}
                      placeHolder="Select Role"
                      defaultSelected={selectedRole}
                      dropDownContent={rolesList}
                    />
                  </div>
                  <div
                    className="CF_d-flex"
                    style={{ flexDirection: "column", gap: "10px" }}
                  >
                    <p style={{ fontWeight: "500" }}>Select Cloud:</p>
                    <div className="cf_onBoardingCloudSelector_Container">
                      {cloudsList
                        ?.filter((res) =>
                          onBoardingCloudsList.includes(res?.providerName)
                        )
                        ?.map((data) => {
                          return (
                            <div
                              key={data?.memberId}
                              className={`cf_onBoardingCloudSelector ${
                                Object.keys(licencePreviewList)?.includes(
                                  data?.providerName
                                )
                                  ? `cf_disabled`
                                  : ""
                              }`}
                              onClick={() => {
                                setLicencePopupVisible(true);
                                getListLicences(
                                  data?.memberId || data?.adminEmail,
                                  data?.providerName
                                );
                              }}
                            >
                              <div
                                className={`bg_35-${data?.providerName}`}
                              ></div>
                              <CustomToolTip title={data?.adminEmail}>
                                <p style={{ fontWeight: "600" }}>
                                  {getMaxChar(data?.adminEmail, 15)}
                                </p>
                              </CustomToolTip>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                  <div
                    className="CF_d-flex"
                    style={{
                      flexDirection: "column",
                      gap: "10px",
                      height: "136px",
                    }}
                  >
                    <p style={{ fontWeight: "500" }}>Preview:</p>
                    <div className="cf_onBoardingCloudSelector_Container">
                      {Object.keys(licencePreviewList)?.map((data) => {
                        return (
                          <div
                            key={data}
                            className="cf_onBoardingCloudSelector cf_onBoardingCloudSelectorPreview"
                          >
                            <div className={`bg_35-${data}`}></div>
                            <div
                              className="cf_onBoardingPreviewCount"
                              onClick={() => {
                                let cpySelectedList = { ...licencePreviewList };
                                cpySelectedList = delete cpySelectedList[data];
                                setLicencePreviewList(cpySelectedList);
                              }}
                            >
                              <Trash2 size={12} strokeWidth={3} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <ButtonComponent
                      isLoading={false}
                      isDisabled={false}
                      inputWidth={updateUser?.email ? "48%" : "100%"}
                      buttonName={"Create Workflow"}
                      buttonClickAction={() => addRole()}
                    />
                  </div>
                </div>
                <div
                  className="cf_usermanagement_container_body_part2"
                  style={{ overflow: "auto", width: "60%" }}
                >
                  {fetchRolesList
                    ? fetchRolesList?.map((_res) => {
                        return (
                          <div className="cf_fetchedRoles">
                            <div>
                              <p>
                                {" "}
                                Role:{" "}
                                <span style={{ fontWeight: "600" }}>
                                  {_res?.role?.replaceAll("_", " ")}
                                </span>
                              </p>
                            </div>
                            {_res?.licenses
                              ? Object.keys(_res?.licenses)?.map((data) => {
                                  return (
                                    <div className="cf_fetchedRoles_CloudsList">
                                      <div className={`bg_35-${data}`}></div>
                                      <div className="cf_licence_planName_container">
                                        {_res?.licenses[data]?.map((res) => {
                                          return (
                                            <div className="cf_licence_planName">
                                              {res?.planName}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })
                              : ""}
                          </div>
                        );
                      })
                    : ""}
                </div>
              </>
            </div>
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}

      <Popup
        options={{
          isOpen: licencePopupVisible,
          title: `Select ${getCloudName(
            selectedLicenceInfo?.cloudName
          )} Licence`,
          popupWidth: "30%",
          popupHeight: `fit-content`,
          popupTop: "150px",
        }}
        toggleOpen={setLicencePopupVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
        >
          {!selectedLicenceInfo?.isLicenceLoaded ? getCFTextLoader() : ""}
          {selectedLicenceInfo?.licencesList?.map((data) => {
            return (
              <div
                className="CF_d-flex ai-center cf_popuplicenceSelectDiv"
                style={{ width: "100%", gap: "10px", padding: "0 20px" }}
              >
                <CustomCheckBox
                  name={data?.planId}
                  customId={data?.planId}
                  labelTitle={data?.planName?.replaceAll("_", " ")}
                  handleChange={(e) => {
                    if (e) {
                      setSelectedLicenceInfo({
                        ...selectedLicenceInfo,
                        selectedLicencesList: [
                          ...selectedLicenceInfo.selectedLicencesList,
                          {
                            planName: data?.planName,
                            planId: data?.planId,
                          },
                        ],
                      });
                    } else {
                      let cpyList = [
                        ...selectedLicenceInfo?.selectedLicencesList,
                      ];
                      cpyList = cpyList?.filter((res) => {
                        return res?.planId !== data?.planId;
                      });
                      setSelectedLicenceInfo({
                        ...selectedLicenceInfo,
                        selectedLicencesList: cpyList,
                      });
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{
              marginLeft: "auto",
            }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={
              !(selectedLicenceInfo?.selectedLicencesList?.length > 0)
            }
            buttonName="Submit"
            buttonClickAction={() => saveSelectedLicences()}
          />
        </div>
      </Popup>
    </>
  );
};

export default OnBoardingWorkFlowManagement;
