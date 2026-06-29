import React, { useEffect, useState } from "react";
import { FaCheckCircle, FaRegTimesCircle } from "react-icons/fa";
import { useSearchParams } from "react-router-dom";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import "./css/Oauth.css";
import { startOauth } from "./OauthActions/OauthActions";
import {
  authenticateSlackUser,
  authenticateTeamsUser,
  saveOauthCode,
} from "./OauthActions/OauthApiActions";

const AddCloud = () => {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("In Progress");
  const [isLoading, setIsLoading] = useState(false);
  const [domainName, setDomainName] = useState("");
  const [tenentName, setTenentName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const state = searchParams.get("state");
  const addCloudNew = searchParams.get("addCloud");
  const code = searchParams.get("code");
  const oauthstatus = searchParams.get("oauthstatus");
  const cloudName = state?.split("~")[0];
  const authClouds = ["slackAuth", "Teams", "Viva"];
  const [isEnterprise, setIsEnterprise] = useState(
    addCloudNew === "GITHUB" && !code ? false : true
  );

  useEffect(() => {
    let splitState = state?.split("~");
    if (state?.includes("slackAuth") && state.split("_")?.length === 4) {
      let domain = state.split("_")[state.split("_")?.length - 1];
      let dumState = state.split("_").splice(0, 3).join("_");
      window.location.href = `${window.location.protocol}//${domain}.${window.location.host}/CloudFuze?state=${dumState}&code=${code}&oauthstatus=PROCESSING`;
    } else if (state?.includes("slackAuth") && state.split("_")?.length === 3) {
      let splitState = state.split("_");
      authenticateSlack(splitState[1], splitState[2], code);
    } else if (
      (state?.includes("Teams") || state?.includes("Viva")) &&
      state.split("_")?.length === 5
    ) {
      let domain = state.split("_")[state.split("_")?.length - 2];
      let dumState = state.split("_");
      let nDumState = `${dumState[0]}_${dumState[1]}_${dumState[2]}_${dumState[4]}`;
      window.location.href = `${window.location.protocol}//${domain}.${window.location.host}/CloudFuze?state=${nDumState}&code=${code}&oauthstatus=PROCESSING`;
    } else if (
      (state?.includes("Teams") || state?.includes("Viva")) &&
      state.split("_")?.length === 4
    ) {
      let splitState = state.split("_");
      authenticateTeams(
        splitState[3],
        splitState[1],
        splitState[2],
        code,
        state?.includes("Teams") ? "Teams" : "Viva"
      );
    } else if (state && splitState?.length === 2) {
      if (code) {
        window.location.href = `${window.location.protocol}//${splitState[1]}/CloudFuze?state=${splitState[0]}&code=${code}&oauthstatus=PROCESSING`;
      } else {
        setStatus("Failed");
        window.location.href = `${window.location.protocol}//${splitState[1]}/CloudFuze?state=${splitState[0]}&oauthstatus=FAILED`;
      }
    } else if (splitState?.length === 1) {
      if (oauthstatus === "FAILED") {
        setStatus("Failed");
        closePopup("Failed");
      } else if (code) {
        addCloud();
      }
    }
  }, [state]);

  const authenticateSlack = async (userId, adminCloudId, code) => {
    let res = await authenticateSlackUser(userId, adminCloudId, code);
    if (res?.status === "OK") {
      if (res?.res?.error_description) {
        setError(res?.res?.error_description);
        setStatus("Failed");
        setTimeout(() => {
          if (!localStorage.oauthDebug) {
            return window.close();
          }
        }, 5000);
        localStorage.removeItem("stateInfo");
        return false;
      } else {
        setStatus("Success");
        setTimeout(() => {
          if (!localStorage.oauthDebug) {
            return window.close();
          }
        }, 1200);
        localStorage.removeItem("stateInfo");
      }
    } else {
      setStatus("Failed");
      setTimeout(() => {
        if (!localStorage.oauthDebug) {
          return window.close();
        }
      }, 1200);
      localStorage.removeItem("stateInfo");
    }
  };

  const authenticateTeams = async (
    clientId,
    userId,
    cloudId,
    code,
    cloudName
  ) => {
    let res = await authenticateTeamsUser(
      clientId,
      userId,
      cloudId,
      code,
      cloudName
    );
    if (res?.status === "OK") {
      setStatus("Success");
      setTimeout(() => {
        if (!localStorage.oauthDebug) {
          return window.close();
        }
      }, 1200);
      localStorage.removeItem("stateInfo");
    } else {
      setStatus("Failed");
      setTimeout(() => {
        if (!localStorage.oauthDebug) {
          return window.close();
        }
      }, 1200);
      localStorage.removeItem("stateInfo");
    }
  };

  const addCloud = async () => {
    let body = {
      code:
        cloudName === "UIPATH" || cloudName === "MAILCHIMP"
          ? `${localStorage.stateInfo}:${code}`
          : code,
    };
    if (cloudName === "GITHUB" && localStorage.stateInfo !== "undefined") {
      body = {
        code: `${code}:${localStorage.stateInfo}`,
      };
    }
    
    if (cloudName === "AZURE_DEVOPS" || cloudName === "EGNYTE_ADMIN") {
      body = {
        code: `${code}`,
        subDomain: localStorage.stateInfo,
      };
    }

    if (
      (cloudName === "JIRA" ||
        cloudName === "ATLASSIAN" ||
        cloudName === "CONFLUENCE" ||
        cloudName === "FIGMA" ||
        cloudName === "ZENDESK") &&
      localStorage.stateInfo
    ) {
      if (cloudName === "FIGMA") {
        let splitText = localStorage.stateInfo?.split(":")
        body = {
          code: `${code}`,
          subDomain: splitText[0],
          adminCloudId: splitText[1]
        };
      } else {
        body = {
          code: `${code}:${localStorage.stateInfo}`,
        };
      }
    }

    if (cloudName === "BAMBOOHR" || cloudName === "DYNAMICS_365_SALES" || cloudName === "AHA") {
      body = {
        code: `${code}`,
        subDomain: localStorage.stateInfo,
      };
    }

    if (cloudName === "AIRTABLE") {
      body = {
        code: `${localStorage.stateInfo}:${await getUserId()}`,
      };
    }
    if (cloudName === "MS_VIVA_ENGAGE_GRAPH") {
      // cloudName = "MS_VIVA_ENGAGE";
      body = {
        code: `${code}:${localStorage.vivaAdminId}`,
      };
      localStorage.removeItem("vivaAdminId");
    }

    if (cloudName === "SERVICENOW") {
      let splitState = localStorage.stateInfo;
      let subDomain = splitState?.split(":")[0];
      let adminCloudId = splitState?.split(":")[1];
      body = {
        code: code,
        subDomain: subDomain,
        adminCloudId: adminCloudId,
      };
    }

    if (cloudName === "WORKDAY") {
      let splitState = localStorage.stateInfo;
      let domain = splitState?.split(":")[0];
      let tenentName = splitState?.split(":")[1];
      let adminEmail = splitState?.split(":")[2];
      body = {
        code: `${code}`,
        subDomain: domain,
        adminCloudId: tenentName,
        clientSecret: adminEmail,
      };
    }

    let res = await saveOauthCode(
      cloudName === "MS_VIVA_ENGAGE_GRAPH" ? "MS_VIVA_ENGAGE" : cloudName,
      body
    );
    if (res?.status === "OK") {
      if (res?.res === "Cloud already present") {
        setError(
          "This Account is already registered. Please use a different Account."
        );
        setStatus("Failed");
        closePopup("AlreadyExist");
      } else {
        if (res?.res?.error_description) {
          setError(res?.res?.error_description);
          setStatus("Failed");
          setTimeout(() => {
            if (!localStorage.oauthDebug) {
              return window.close();
            }
          }, 5000);
          localStorage.removeItem("stateInfo");
          return false;
        } else {
          closePopup("Success");
          localStorage.removeItem("stateInfo");
        }
      }
    } else {
      closePopup("Failed");
      localStorage.removeItem("stateInfo");
    }
  };

  const closePopup = (nstatus) => {
    setStatus(nstatus);
    localStorage.setItem("oauthStatus", nstatus);
    let mess = "Account added successfully.";
    if (nstatus === "Failed") {
      mess = "Failed registering .Please try once again.";
    }
    setTimeout(() => {
      if (!localStorage.oauthDebug) {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "oauthStatus",
            newValue: nstatus,
          })
        );
        // window.opener.postMessage({ status: nstatus, message: mess }, "*");
        return window.close();
      }
    }, 500);
  };

  return (
    <div className="cf_oauth_div">
      <div className="cf_oauth_div_container">
        <div className="cf_oauth_div_container_title">
          <img src={cloudImageMapper("")} alt="CF Logo" />
        </div>
        <div className="cf_oauth_div_container_body">
          {addCloudNew ? (
            <div className="CF_OAUTH_REGISTERY_DIV">
              <div className="CF_OAUTH_REGISTERY_TITLE">
                <h3>{getCloudName(addCloudNew)} Authentication</h3>
              </div>
              {isEnterprise ? (
                <>
                  <div
                    className="CF_OAUTH_REGISTERY_BODY"
                    style={{
                      height: "fit-content",
                      gap: "15px",
                      flexWrap: "wrap",
                      padding: "15px 10px",
                    }}
                  >
                    <TextInput
                      type="text"
                      placeHolder={
                        addCloudNew === "WORKDAY"
                          ? "Subdomain *"
                          : addCloudNew === "JIRA" ||
                            addCloudNew === "ATLASSIAN" ||
                            addCloudNew === "FIGMA" ||
                            addCloudNew === "CONFLUENCE"
                            ? `SCIM API key *`
                            : addCloudNew === "UIPATH"
                              ? `Organization Name*`
                              : `Domain Name*`
                      }
                      inputWidth="100%"
                      inputName="domainName"
                      autoFocus={true}
                      getInputText={(val) => setDomainName(val)}
                    />
                    {addCloudNew === "UIPATH" ||
                      addCloudNew === "ATLASSIAN" ||
                      addCloudNew === "WORKDAY" ||
                      addCloudNew === "FIGMA" ? (
                      <TextInput
                        type="text"
                        placeHolder={`${addCloudNew === "FIGMA" ? "Tenent ID" : addCloudNew === "ATLASSIAN"
                          ? "Organization Id"
                          : "Tenent Name"
                          } *`}
                        inputWidth="100%"
                        inputName="tenentName"
                        autoFocus={false}
                        getInputText={(val) => setTenentName(val)}
                      />
                    ) : (
                      ""
                    )}
                    {addCloudNew === "WORKDAY" ? (
                      <TextInput
                        type="text"
                        placeHolder={`Admin Email *`}
                        inputWidth="100%"
                        inputName="tenentName"
                        autoFocus={false}
                        getInputText={(val) => setAdminEmail(val)}
                      />
                    ) : (
                      ""
                    )}
                  </div>
                  <div className="CF_OAUTH_REGISTERY_FOOTER">
                    <ButtonComponent
                      isLoading={isLoading}
                      isDisabled={domainName?.length === 0}
                      buttonName="Continue"
                      inputWidth="100%"
                      buttonClickAction={() => {
                        setIsLoading(true);
                        startOauth(
                          addCloudNew,
                          addCloudNew === "WORKDAY"
                            ? `${domainName}:${tenentName}:${adminEmail}`
                            : addCloudNew === "UIPATH" ||
                              addCloudNew === "ATLASSIAN" ||
                              addCloudNew === "FIGMA"
                              ? `${domainName}:${tenentName}`
                              : domainName
                        );
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="CF_OAUTH_REGISTERY_BODY"
                    style={{
                      gap: "15px",
                      alignItems: "center",
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    <p style={{ fontWeight: "500", fontSize: "15px" }}>
                      Do You Want To Add Github Account With Enterprise Account
                      ?
                    </p>
                  </div>
                  <div
                    className="CF_OAUTH_REGISTERY_FOOTER CF_d-flex"
                    style={{ gap: "15px", padding: "0 15px" }}
                  >
                    <span style={{ marginLeft: "auto" }}></span>
                    <ButtonComponent
                      isLoading={isLoading}
                      isDisabled={false}
                      buttonName="No"
                      inputWidth="100px"
                      customstyles={{
                        height: "40px",
                      }}
                      buttonClickAction={() => {
                        startOauth(addCloudNew);
                      }}
                    />
                    <ButtonComponent
                      isLoading={isLoading}
                      isDisabled={false}
                      buttonName="Yes"
                      inputWidth="100px"
                      customstyles={{
                        height: "40px",
                      }}
                      buttonClickAction={() => {
                        setIsEnterprise(true);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <h2>
                {state?.includes("slackAuth")
                  ? `Your Slack Authentication Is ${status}`
                  : state?.includes("Teams")
                    ? `Your Microsoft Teams Authentication Is ${status}`
                    : status === "Failed"
                      ? `Failed Adding ${getCloudName(state?.split("~")[0])}`
                      : `${getCloudName(state?.split("~")[0])} Oauth Is ${status}`}
              </h2>
              {status === "Failed" ? (
                error ? (
                  <div
                    className="cf_failed_oauth"
                    style={{
                      width: "fit-content",
                      color: "red",
                      padding: "0 25px",
                      fontSize: "16px",
                      fontWeight: "500",
                    }}
                  >
                    <p>{error}</p>
                  </div>
                ) : (
                  <div className="cf_failed_oauth">
                    <FaRegTimesCircle />
                  </div>
                )
              ) : status === "Success" ? (
                <div className="cf_success_oauth">
                  <FaCheckCircle />
                </div>
              ) : (
                <div className="cf_custom_loader"></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddCloud;
