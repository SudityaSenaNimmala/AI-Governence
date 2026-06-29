import { useState } from "react";
import Popup from "../../Resuables/Popup/Popup";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import { IoStopOutline } from "react-icons/io5";
import {
  getAppConfigurationList,
  saveAppConfiguration,
  sendOTPForUIConfig,
  validateOTPForUIConfig,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { getCloudName, integrationsList } from "../../helpers/helpers";
import { getMaxChar, notifyToast } from "../../helpers/utils";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";

const AppConfiguration = () => {
  const [searchInput, setSearchInput] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [appConfigurationList, setAppConfigurationList] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [authCredentials, setAuthCredentials] = useState({
    emailId: "",
    otp: "",
    isOTPSent: false,
    otpTimeStamp: "",
    isLoading: false,
  });

  const validateUser = async () => {
    if (authCredentials.isOTPSent) {
      let res = await validateOTPForUIConfig(
        authCredentials.emailId,
        authCredentials.otp
      );
      if (res?.status === "OK") {
        setAuthCredentials({
          ...authCredentials,
          isOTPSent: false,
          otpTimeStamp: res?.res,
        });
        setIsAuthorized(true);
        getConfig();
      } else {
        notifyToast("error", res?.message);
      }
    } else {
      let res = await sendOTPForUIConfig(authCredentials.emailId);
      if (res?.status === "OK") {
        setAuthCredentials({ ...authCredentials, isOTPSent: true });
      } else {
        notifyToast("error", res?.message);
      }
    }
  };

  const getConfig = async () => {
    setIsLoading(true);
    let res = await getAppConfigurationList();
    if (res?.status === "OK") {
      setIsLoading(false);
      setAppConfigurationList(res?.res);
    } else {
      setIsLoading(false);
      notifyToast("error", res?.message);
    }
  };

  const saveConfig = async () => {
    setIsLoading(true);
    let res = await saveAppConfiguration(
      appConfigurationList,
      authCredentials.emailId,
      "" + authCredentials?.otpTimeStamp
    );
    if (res?.status === "OK") {
      setIsLoading(false);
      setIsAuthorized(false);
      notifyToast("success", res?.message);
    } else {
      setIsLoading(false);
      setIsAuthorized(false);
      notifyToast("error", res?.message);
    }
  };

  return !isAuthorized ? (
    <Popup
      options={{
        isOpen: true,
        title: `Authenticate`,
        popupWidth: "700px",
        popupHeight: `fit-content`,
        popupTop: "150px",
      }}
      closeContent=" "
      toggleOpen={setIsVisible}
    >
      <div
        className="cf_popup_container_body"
        style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
      >
        {authCredentials.isOTPSent ? (
          <TextInput
            type="number"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={authCredentials.otp}
            inputName="otp"
            placeHolder={"OTP *"}
            getInputText={(val) =>
              setAuthCredentials({ ...authCredentials, otp: val })
            }
          />
        ) : (
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={authCredentials.emailId}
            inputName="name"
            placeHolder={"Email Id *"}
            getInputText={(val) =>
              setAuthCredentials({ ...authCredentials, emailId: val })
            }
          />
        )}
      </div>
      <div className="cf_popup_container_footer">
        <ButtonComponent
          customstyles={{ marginLeft: "auto" }}
          inputWidth="140px"
          isLoading={authCredentials.isLoading}
          isDisabled={
            authCredentials.isOTPSent
              ? authCredentials.otp?.length !== 6 || authCredentials.isLoading
              : !authCredentials.emailId?.includes("@") ||
                authCredentials.isLoading
          }
          buttonName={authCredentials.isOTPSent ? "Validate OTP" : "Send OTP"}
          buttonClickAction={() => validateUser()}
        />
      </div>
    </Popup>
  ) : (
    <>
      <div className="cf_main_container">
        <div className="cf_main_content_place" style={{ width: "100%" }}>
          <h3 style={{ fontWeight: "500" }}>App Configuration</h3>
          <div
            className="cf_main_content_place_main"
            style={{ padding: "10px 0", width: "100%" }}
          >
            <div className="cf_add_cloud_filter_div">
              <SearchComponent
                autoFocus={false}
                autoOpen={true}
                inputName="searchInput"
                inputPlaceHolder={`Search By Application Name`}
                onInputSearch={(e) => setSearchInput(e?.searchInput)}
              />
              <span style={{ marginLeft: "auto" }}></span>
              <ActionButton
                customClass={`changeButtonColorOnHover`}
                customStyles={{
                  backgroundColor: "#0062ff",
                  height: "35px",
                  padding: "0 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                buttonType="button"
                buttonClickAction={() => {
                  saveConfig();
                }}
              >
                <p style={{ color: "#fff", fontSize: "12px" }}>Save</p>
              </ActionButton>
            </div>
            <div className="cf_add_cloud_div">
              <div
                className={`cf_add_cloud_card`}
                role="link"
                tabIndex={0}
                style={{
                  animationDelay: `${1 * 0.02}s`,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "5px",
                    right: "5px",
                  }}
                >
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAppConfigurationList({
                          ...appConfigurationList,
                          applications: integrationsList()?.reduce(
                            (acc, curr) => {
                              acc.push(curr?.cloudName);
                              return acc;
                            },
                            []
                          ),
                        });
                      } else {
                        setAppConfigurationList({
                          ...appConfigurationList,
                          applications: [],
                        });
                      }
                    }}
                    checked={
                      appConfigurationList?.applications?.length ===
                      integrationsList()?.length
                    }
                  />
                </div>
                <div
                  className={`cf_add_cloud_card_image bg-CLOUDFUZE`}
                  cloudname={"CLOUDFUZE"}
                ></div>
                <p
                  className="cf_add_cloud_card_title"
                  title={getCloudName("CLOUDFUZE")}
                >
                  ALL
                </p>
              </div>
              {integrationsList()
                ?.sort((a, b) =>
                  appConfigurationList?.applications?.includes(a?.cloudName)
                    ? -1
                    : 1
                )
                ?.map((data, index) => {
                  return (
                    <>
                      <div
                        key={data?.cloudName}
                        className={`cf_add_cloud_card ${
                          appConfigurationList?.applications?.includes(
                            data?.cloudName
                          )
                            ? ""
                            : "cf_cloud_not_selected"
                        }`}
                        role="link"
                        tabIndex={0}
                        style={{
                          animationDelay: `${index * 0.02}s`,
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            top: "5px",
                            right: "5px",
                          }}
                        >
                          <input
                            type="checkbox"
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAppConfigurationList({
                                  ...appConfigurationList,
                                  applications: [
                                    ...(appConfigurationList?.applications ||
                                      []),
                                    data?.cloudName,
                                  ],
                                });
                              } else {
                                setAppConfigurationList({
                                  ...appConfigurationList,
                                  applications:
                                    appConfigurationList?.applications?.filter(
                                      (app) => app !== data?.cloudName
                                    ),
                                });
                              }
                            }}
                            checked={appConfigurationList?.applications?.includes(
                              data?.cloudName
                            )}
                          />
                        </div>
                        <div
                          className={`cf_add_cloud_card_image bg-${data?.cloudName}`}
                          cloudname={data?.cloudName}
                        ></div>
                        <p
                          className="cf_add_cloud_card_title"
                          title={getCloudName(data?.cloudName)}
                        >
                          {data?.cloudName === "MEMSE3"
                            ? getMaxChar(getCloudName(data?.cloudName), 30)
                            : getCloudName(data?.cloudName)}
                        </p>
                      </div>
                    </>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
      {isLoading ? getCFLoader() : ""}
    </>
  );
};

export default AppConfiguration;
