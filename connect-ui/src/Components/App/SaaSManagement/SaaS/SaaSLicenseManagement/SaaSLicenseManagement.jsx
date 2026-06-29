import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../../../helpers/helpers";
import {
  getCFLoader,
  getCFTextLoader,
} from "../../../../Resuables/Loaders/Loaders";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import {
  getLicensesList,
  saveAndUpdateLicense,
} from "../../SaaSActions/SaaSActions";
import ActionButton from "../../../../Resuables/InputsComponents/ActionButton";
import { Pencil, Plus } from "lucide-react";
import { getUserId, notifyToast } from "../../../../helpers/utils";
import Popup from "../../../../Resuables/Popup/Popup";
import TextInput from "../../../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import {
  getMicrosoftLicenseFeatures,
  isMicrosoftLicenseProvider,
} from "../../../Demos/microsoftLicenseFeatures";

const SaaSLicenseManagement = () => {
  const navigate = useNavigate();
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [licensesList, setLicensesList] = useState([]);
  const [licenseFeaturesPopup, setLicenseFeaturesPopup] = useState(null);
  const { adminEmail, memberId, providerName, domainName } = {
    ...globalContext?.saasCloud,
  };
  const [isVisible, setIsVisible] = useState(false);
  const [newLicense, setNewLicense] = useState({
    id: null,
    annualPlan: false,
    planName: "",
    purchasedDate: "",
    expiryDate: "",
    createdTime: "",
    planId: "",
    userId: getUserId(),
    adminMemberId: memberId,
    vendor: providerName,
    deleted: false,
    subscriberEmail: adminEmail,
    purchasedAmount: 0,
    domain: domainName,
    seatsAvailable: 0,
    seatsUsed: 0,
    totalSeat: 0,
    workspace: null,
  });

  const onlyUsedRequired = ["HUBSPOT", "CONFLUENCE", "ATLASSIAN", "JIRA"];

  useEffect(() => {
    setLicensesList([]);
    setIsLoading(true);
    getLicenses();
  }, [providerName]);

  const getLicenses = async () => {
    let res = await getLicensesList(memberId || adminEmail, providerName);
    if (res?.status === "OK" && res?.res) {
      if (providerName === "GITHUB" || providerName === "MICROSOFT_TEAMS") {
        let list = [];
        res?.res?.map((data) => {
          list.push({
            ...data,
            seatsAvailable: data?.seatsAvailable + data?.seatsUsed,
          });
        });

        console.log(list);
        setLicensesList(list);
      } else {
        setLicensesList(res?.res);
      }
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const handleEditLicense = async (name, value) => {
    setNewLicense({ ...newLicense, [name]: value });
  };

  const updateCostInfo = async () => {
    setIsPageLoading(true);
    setIsVisible(false);
    let res = await saveAndUpdateLicense([{ ...newLicense }]);
    if (res?.status === "OK" && res?.res) {
      getLicenses();
      notifyToast(
        "success",
        licensesList?.filter((data) => data?.planId === newLicense?.planId)
          ?.length > 0
          ? "License updated successfully"
          : "License added successfully"
      );
      setIsPageLoading(false);
    } else {
      notifyToast(
        "error",
        licensesList?.filter((data) => data?.planId === newLicense?.planId)
          ?.length > 0
          ? "Failed to update license"
          : "Failed to add license"
      );
      setIsPageLoading(false);
    }
  };

  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav
            pageName="License Management"
            backLink="/SaaSManagement/Menu"
          />

          <div
            className="cf_main_content_place_main cf_saas_options_contatiner"
            style={{ padding: "20px 0 20px 0" }}
          >
            <div className="cf_licenses_container_table">
              <div className="cf_licenses_container_table_header">
                <span>Total Licenses: {licensesList?.length}</span>
                <ActionButton
                  customClass={`changeButtonColorOnHover`}
                  customStyles={{
                    backgroundColor: "#f2f2f2",
                    // padding: "8px 12px",
                    height: "35px",
                    marginLeft: "auto",
                  }}
                  buttonType="button"
                  buttonClickAction={() => {
                    setIsVisible(true);
                    setNewLicense({
                      id: null,
                      planName: "",
                      purchasedDate: "",
                      expiryDate: "",
                      createdTime: "",
                      planId: "",
                      userId: getUserId(),
                      adminMemberId: memberId,
                      vendor: providerName,
                      deleted: false,
                      subscriberEmail: adminEmail,
                      purchasedAmount: 0,
                      domain: domainName,
                      seatsAvailable: 0,
                      seatsUsed: 0,
                      totalSeat: 0,
                      workspace: null,
                    });
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <p style={{ fontSize: "12px", fontWeight: "500" }}>
                      Add License
                    </p>
                  </div>
                </ActionButton>
              </div>
              <table className="cf_licenses_table">
                <thead>
                  <tr>
                    <th style={{ width: "20%", whiteSpace: "pre" }}>Name</th>
                    {/* {providerName === "JIRA" ? (
                      <th style={{ width: "25%" }}>Domain</th>
                    ) : (
                      ""
                    )} */}
                    {onlyUsedRequired.includes(providerName) ? (
                      <>
                        <th style={{ width: "15%", whiteSpace: "pre" }}>
                          Used Licenses{" "}
                        </th>
                      </>
                    ) : (
                      <>
                        <th style={{ width: "15%", whiteSpace: "pre" }}>
                          Available Licenses
                        </th>
                        <th style={{ width: "20%", whiteSpace: "pre" }}>
                          Assigned Licenses{" "}
                        </th>
                      </>
                    )}
                    {/* <th style={{ width: "10%", whiteSpace: "pre" }}>Cost</th> */}
                    <th style={{ width: "10%", whiteSpace: "pre" }}>
                      Recurring
                    </th>
                    <th style={{ width: "10%", whiteSpace: "pre" }}>Status</th>
                    <th style={{ width: "25%", whiteSpace: "pre" }}></th>
                    {/* <th></th> */}
                  </tr>
                </thead>
                <tbody>
                  {licensesList?.map((data) => {
                    return (
                      <tr key={data?.planId}>
                        <td>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "10px" }}
                          >
                            <div className="cf_license_img_placer">
                              <img
                                src={cloudImageMapper(providerName)}
                                alt={providerName}
                              />
                            </div>
                            <div className="cf_license_title">
                              <p
                                style={{
                                  fontWeight: "500",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {data?.planName?.replaceAll("_", " ") ||
                                  data?.planId?.replaceAll("_", " ") ||
                                  data?.domain?.replaceAll("_", " ")}
                              </p>
                              <span style={{ fontSize: "10px" }}>
                                {data?.workspace}
                              </span>
                            </div>
                          </div>
                        </td>
                        {/* {providerName === "JIRA" ? (
                          <td>
                            <p
                              style={{
                                fontWeight: "500",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {data?.planName?.split("- ")[1]}
                            </p>
                          </td>
                        ) : (
                          ""
                        )} */}
                        {onlyUsedRequired?.includes(providerName) ? (
                          providerName === "JIRA" ||
                            providerName === "ATLASSIAN" ||
                            providerName === "CONFLUENCE" ? (
                            <td>
                              <div
                                style={{
                                  fontSize: "12px",
                                  fontWeight: "500",
                                }}
                              >
                                {data?.seatsUsed}
                              </div>
                            </td>
                          ) : (
                            <td>
                              <div
                                className="cf_license_title cf_make_link"
                                onClick={() =>
                                  navigate(
                                    `/SaaS/License/${data?.planName ||
                                    data?.planId ||
                                    data?.domain
                                    }|${data?.seatsUsed && data?.freeSeat
                                      ? data?.seatsUsed + data?.freeSeat
                                      : data?.seatsUsed
                                        ? data?.seatsUsed
                                        : data?.freeSeat
                                    }/${data?.planId}`
                                  )
                                }
                              >
                                {data?.freeSeat ? (
                                  <>
                                    {data?.freeSeat}&nbsp;
                                    <span
                                      style={{
                                        fontSize: "10px",
                                      }}
                                    >
                                      Sales Seats,&nbsp;
                                    </span>
                                  </>
                                ) : (
                                  ""
                                )}
                                {data?.seatsUsed ? (
                                  <>
                                    {data?.seatsUsed}&nbsp;
                                    <span
                                      style={{
                                        fontSize: "10px",
                                      }}
                                    >
                                      Core Seats
                                    </span>
                                  </>
                                ) : (
                                  ""
                                )}
                              </div>
                            </td>
                          )
                        ) : (
                          <>
                            <td className="cf_license_title">
                              {data?.seatsAvailable - data?.seatsUsed < 0
                                ? 0
                                : data?.seatsAvailable - data?.seatsUsed}
                            </td>
                            <td>
                              <div
                                className="CF_d-flex ai-center"
                                style={{ gap: "10px" }}
                              >
                                <div className="cf_license_indicator">
                                  <div
                                    className="cf_license_indicator_filler"
                                    style={{
                                      width: `${(data?.seatsUsed /
                                        data?.seatsAvailable) *
                                        100
                                        }%`,
                                    }}
                                  ></div>
                                  <div
                                    className="cf_license_indicator_background"
                                    per={data?.seatsUsed / data?.seatsAvailable}
                                    style={{
                                      width: `${100 -
                                        (data?.seatsUsed /
                                          data?.seatsAvailable) *
                                        100
                                        }%`,
                                    }}
                                  ></div>
                                </div>
                                {providerName === "JIRA" ||
                                  providerName === "ATLASSIAN" ||
                                  providerName === "CONFLUENCE" ? (
                                  <div
                                    style={{
                                      fontSize: "12px",
                                      fontWeight: "500",
                                    }}
                                  >
                                    {data?.seatsUsed}/{data?.seatsAvailable}
                                  </div>
                                ) : (
                                  <div
                                    className="cf_license_title cf_make_link"
                                    onClick={() =>
                                      navigate(
                                        `/SaaS/License/${data?.planName || data?.planId
                                        }|${data?.seatsUsed}/${data?.planId}`
                                      )
                                    }
                                    style={{
                                      fontSize: "12px",
                                    }}
                                  >
                                    {data?.seatsUsed}/{data?.seatsAvailable}
                                  </div>
                                )}
                              </div>
                            </td>
                          </>
                        )}
                        {/* <td className="cf_license_title">
                          ${data?.totalAmount}
                        </td> */}
                        <td className="cf_license_title">
                          {data?.annualPlan ? "Yearly" : "Monthly"}
                        </td>
                        <td className="cf_license_title">
                          {data?.deleted ? "In-Active" : "Active"}
                        </td>
                        <td>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "10px" }}
                          >
                            {data?.purchasedDate && data?.expiryDate ? (
                              <div>
                                <div
                                  style={{
                                    whiteSpace: "pre",
                                  }}
                                >
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Assigned on:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {new Date(data?.purchasedDate)
                                      .toDateString()
                                      ?.split(" ")
                                      ?.splice(1, 4)
                                      ?.join(" ")}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    whiteSpace: "pre",
                                  }}
                                >
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Expires on:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {new Date(data?.expiryDate)
                                      .toDateString()
                                      ?.split(" ")
                                      ?.splice(1, 4)
                                      ?.join(" ")}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              ""
                            )}
                            <div
                              className="cf_dashboard_analytics_edit CF_Pointer"
                              style={{ marginLeft: "auto" }}
                              onClick={() => {
                                setIsVisible(true);
                                setNewLicense(data);
                              }}
                            >
                              <Pencil size={14} />
                            </div>
                          </div>
                        </td>
                        {/* <td></td> */}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {isLoading ? getCFTextLoader() : ""}
            </div>
          </div>
        </div>
      </div>
      <Popup
        options={{
          isOpen: isVisible,
          title: `${newLicense?.id
            ? `Edit ${newLicense?.planName?.replaceAll("_", " ") ||
            newLicense?.planId?.replaceAll("_", " ") ||
            newLicense?.domain?.replaceAll("_", " ")
            } License`
            : `Add License for ${getCloudName(providerName)}`
            }`,
          popupWidth: "30%",
          popupHeight: "fit-content",
          popupTop: "100px",
          maxHeight: "400px",
          overflowY: "auto",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "20px 10px",
            flexDirection: "column",
            gap: "30px",
          }}
        >
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={
              newLicense?.planName?.replaceAll("_", " ") ||
              newLicense?.planId?.replaceAll("_", " ")
            }
            inputName="domainName"
            placeHolder="Plan Name *"
            getInputText={(val) => handleEditLicense("planName", val)}
          />
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={newLicense?.planId?.replaceAll("_", " ")}
            inputName="domainName"
            placeHolder="Plan Id"
            getInputText={(val) => handleEditLicense("planId", val)}
          />
          <div
            className="CF_d-flex ai-center"
            style={{
              gap: "10px",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <TextInput
              type="number"
              autoFocus={true}
              inputWidth="48%"
              defaultValue={newLicense?.totalSeat}
              inputName="totalSeat"
              placeHolder="Total Seats*"
              getInputText={(val) => handleEditLicense("totalSeat", +val)}
            />
            {providerName === "HUBSPOT" ? (
              <TextInput
                type="number"
                autoFocus={true}
                inputWidth="48%"
                defaultValue={newLicense?.freeSeat}
                inputName="freeSeat"
                placeHolder="Free Seats*"
                getInputText={(val) => handleEditLicense("freeSeat", +val)}
              />
            ) : (
              <TextInput
                type="number"
                autoFocus={true}
                inputWidth="48%"
                defaultValue={newLicense?.seatsAvailable}
                inputName="seatsAvailable"
                placeHolder="Seats Available*"
                getInputText={(val) =>
                  handleEditLicense("seatsAvailable", +val)
                }
              />
            )}
          </div>
          <div
            className="CF_d-flex ai-center"
            style={{
              gap: "10px",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <TextInput
              type="number"
              autoFocus={true}
              inputWidth="48%"
              defaultValue={newLicense?.seatsUsed}
              inputName="seatsUsed"
              placeHolder="Seats Used*"
              getInputText={(val) => handleEditLicense("seatsUsed", +val)}
            />
            <TextInput
              type="number"
              autoFocus={true}
              inputWidth="48%"
              defaultValue={newLicense?.purchasedAmount}
              inputName="purchasedAmount"
              placeHolder="Purchased Amount*"
              getInputText={(val) => handleEditLicense("purchasedAmount", +val)}
            />
          </div>
          <div
            className="CF_d-flex ai-center"
            style={{
              gap: "10px",
              justifyContent: "space-between",
              width: "100%",
              marginTop: "-10px",
            }}
          >
            <div style={{ width: "48%" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "400",
                  padding: "0 5px",
                  color: "#0062ff",
                }}
              >
                Purchased Date*
              </span>
              <TextInput
                type="date"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newLicense?.purchasedDate?.split("T")[0]}
                inputName="domainName"
                placeHolder=""
                getInputText={(val) =>
                  handleEditLicense(
                    "purchasedDate",
                    new Date(val).toISOString()
                  )
                }
              />
            </div>
            <div style={{ width: "48%" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "400",
                  padding: "0 5px",
                  color: "#0062ff",
                }}
              >
                Expiry Date*
              </span>
              <TextInput
                type="date"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newLicense?.expiryDate?.split("T")[0]}
                inputName="domainName"
                placeHolder=""
                getInputText={(val) =>
                  handleEditLicense("expiryDate", new Date(val).toISOString())
                }
              />
            </div>
          </div>
          <div
            className="CF_d-flex ai-center"
            style={{ gap: "10px", justifyContent: "flex-start", width: "100%" }}
          >
            <div>Recurring :</div>
            <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
              <span
                className={`cf_switch_text ${!newLicense?.annualPlan ? "cf_switch_active" : ""
                  }`}
              >
                Monthly&nbsp;&nbsp;
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  id="splitChannels"
                  checked={newLicense?.annualPlan}
                  onChange={(e) =>
                    handleEditLicense("annualPlan", e.target.checked)
                  }
                />
                <span className="slider round" style={{ top: "6px" }}></span>
              </label>
              <span
                className={`cf_switch_text ${newLicense?.annualPlan ? "cf_switch_active" : ""
                  }`}
              >
                Yearly
              </span>
            </div>
          </div>
        </div>
        <div
          className="cf_popup_container_footer"
          style={{ padding: "0 20px", paddingBottom: "10px" }}
        >
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName={newLicense?.id ? "Update" : "Save"}
            buttonClickAction={() => updateCostInfo()}
          />
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default SaaSLicenseManagement;
