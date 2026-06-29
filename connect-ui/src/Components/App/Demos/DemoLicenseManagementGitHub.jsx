import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { getUserId } from "../../helpers/utils";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import { getDemoLicensesList } from "./DemoActions/DemoActions";

const DemoLicenseManagementGitHub = ({
  selectedOrgData = { organization: "ALL" },
  setIsLicenseSync,
}) => {
  const navigate = useNavigate();
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [licensesList, setLicensesList] = useState([]);
  const { adminEmail, memberId, providerName, domainName } = {
    ...globalContext?.saasCloud,
  };

  const [selectedOrg, setSelectedOrg] = useState(null);
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
    setIsLicenseSync(true);
  }, []);

  useEffect(() => {
    if (selectedOrgData?.organization) {
      setLicensesList([]);
      setIsLoading(true);
      setSelectedOrg(selectedOrgData);
      getLicenses(selectedOrgData?.organization);
    }
  }, [selectedOrgData]);

  const getLicenses = async (orgName = selectedOrg?.organization) => {
    let res = await getDemoLicensesList(
      memberId || adminEmail,
      providerName,
      orgName
    );
    if (res?.status === "OK" && res?.res) {
      if (providerName === "GITHUB" || providerName === "MICROSOFT_TEAMS") {
        let list = [];
        res?.res?.map((data) => {
          list.push({
            ...data,
            seatsAvailable: data?.seatsAvailable + data?.seatsUsed,
          });
        });

        setLicensesList(res?.res?.filter((data) => data?.licenses));
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
      <div className="cf_licenses_container_table">
        <div className="cf_licenses_container_table_header">
          <span>Total Licenses: {licensesList?.length}</span>
          {/* <ActionButton
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
              <p style={{ fontSize: "12px", fontWeight: "500" }}>Add License</p>
            </div>
          </ActionButton> */}
        </div>
        <table className="cf_licenses_table">
          <thead>
            <tr>
              <th style={{ width: "25%" }}>Name</th>
              <th style={{ width: "25%" }}>Used Licenses </th>
              <th style={{ width: "25%" }}>Cost per License</th>
              <th style={{ width: "10%" }}>Total Cost</th>
              {/* <th style={{ width: "25%" }}></th> */}
            </tr>
          </thead>
          <tbody>
            {licensesList?.map((data) => {
              return data?.licenses ? (
                <tr key={data?.planId}>
                  <td>
                    <div
                      className="CF_d-flex ai-center"
                      style={{ gap: "10px" }}
                    >
                      <div className="cf_license_img_placer">
                        <img
                          src={cloudImageMapper(
                            data?.licenses === "business"
                              ? "GITHUB_COPILOT"
                              : data?.licenses === "emu_user"
                              ? "GITHUB"
                              : providerName
                          )}
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
                          {data?.licenses === "business"
                            ? "GitHub Copilot Business"
                            : data?.licenses === "emu_user"
                            ? "Github Enterprise"
                            : data?.licenses?.replaceAll("_", " ")}
                        </p>
                        <span style={{ fontSize: "10px" }}>
                          {/* {data?.workspace} */}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <p
                      style={{
                        fontWeight: "500",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {data?.usersCount}
                    </p>
                  </td>
                  <td>
                    <p
                      style={{
                        fontWeight: "500",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ${Math.ceil(data?.cost / data?.usersCount)}
                    </p>
                  </td>
                  <td>
                    <p
                      style={{
                        fontWeight: "500",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ${data?.cost}
                    </p>
                  </td>

                  {/* <td></td> */}
                </tr>
              ) : (
                ""
              );
            })}
          </tbody>
        </table>
        {isLoading ? getCFTextLoader() : ""}
      </div>
      <Popup
        options={{
          isOpen: isVisible,
          title: `${
            newLicense?.id
              ? `Edit ${
                  newLicense?.planName?.replaceAll("_", " ") ||
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
                className={`cf_switch_text ${
                  !newLicense?.annualPlan ? "cf_switch_active" : ""
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
                className={`cf_switch_text ${
                  newLicense?.annualPlan ? "cf_switch_active" : ""
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

export default DemoLicenseManagementGitHub;
