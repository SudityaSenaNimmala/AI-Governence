import React, { useContext, useEffect, useState } from "react";

import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { getCFTextLoader } from "../../../../Resuables/Loaders/Loaders";
import { cloudImageMapper } from "../../../../helpers/helpers";
import { getMaxChar } from "../../../../helpers/utils";
import moment from "moment";
import { Check, X } from "lucide-react";
import CustomToolTip from "../../../../Resuables/CustomToolTip/CustomToolTip";
import SideNav from "../../../../Resuables/Nav/SideNav";
import TopNav from "../../../../Resuables/Nav/TopNav";
import { getShadowItAppsList } from "../../SaaSActions/SaaSActions";

const ShadowIT = () => {
  const { globalContext } = useContext(GlobalContext);
  const { memberId, providerName } = { ...globalContext?.saasCloud };
  const [isLoading, setIsLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [appsList, setAppsList] = useState([]);
  const [scopesList, setScopesList] = useState([]);

  useEffect(() => {
    fetchShadowItApps();
  }, []);

  const fetchShadowItApps = async () => {
    setIsLoading(true);
    let res = await getShadowItAppsList(memberId, providerName);
    if (res?.status === "OK") {
      setAppsList(res?.res);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const displayScopes = (scopes) => {
    return scopes
      ?.filter((res) => res?.scopeName || res?.scopeAccess !== "")
      .map((data, index) => {
        return index === 0 && (data?.scopeName || data?.scopeAccess) ? (
          <div
            className="cf_new_unverified_div CF_ChangeColor"
            key={`${index}_scopes_${
              providerName === "MICROSOFT_TEAMS" ||
              providerName === "MICROSOFT_OFFICE_365"
                ? data?.scopeAccess
                : data?.scopeName
            }`}
          >
            <CustomToolTip
              title={
                providerName === "MICROSOFT_TEAMS" ||
                providerName === "MICROSOFT_OFFICE_365"
                  ? data?.scopeAccess
                  : data?.scopeName
              }
            >
              <p style={{ color: "#000" }}>
                {getMaxChar(
                  providerName === "MICROSOFT_TEAMS" ||
                    providerName === "MICROSOFT_OFFICE_365"
                    ? data?.scopeAccess
                    : data?.scopeName,
                  15
                )}
              </p>
            </CustomToolTip>
          </div>
        ) : index === 1 ? (
          <div
            className="cf_new_unverified_div CF_Pointer CF_ChangeColor"
            onClick={() => setScopesList(scopes)}
          >
            <CustomToolTip title="Click To View The Scopes">
              <p style={{ color: "#000", zIndex: "-1" }}>
                + {scopes?.length - 1}
              </p>
            </CustomToolTip>
          </div>
        ) : (
          ""
        );
      });
  };
  return (
    <>
      <div className="cf_main_container">
        <SideNav activeTab="SaaS Management" />
        <div className="cf_main_content_place">
          <TopNav pageName="Shadow IT" backLink="/SaaSManagement/Menu" />
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              gap: "10px",
              padding: "10px 0 0 0",
              height: "calc(100% - 60px)",
            }}
          >
            <div
              className="cf_main_content_place_main CF_d-flex"
              style={{
                padding: "0 0 10px 0",
                flexDirection: "column",
                height: "calc(100%)",
                width: scopesList?.length === 0 ? "100%" : "70%",
              }}
            >
              <div
                className="cf_new_tables_div"
                style={{
                  height: "calc(100% - 00px)",
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "200px" }}>App Name</th>
                      {providerName !== "SLACK" &&
                      providerName !== "GOOGLE_WORKSPACE" ? (
                        <>
                          <th style={{ width: "200px" }}>Organization</th>
                          <th style={{ width: "200px" }}>Created At</th>
                        </>
                      ) : (
                        ""
                      )}
                      {providerName !== "SLACK" ? (
                        <>
                          <th style={{ width: "200px" }}>App Type</th>
                          <th style={{ width: "200px" }}>Scopes</th>
                        </>
                      ) : (
                        ""
                      )}
                      <th style={{ width: "200px" }}>Status</th>
                      {/* <th>Actions</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <>
                        <tr>
                          <td colSpan={6}>{getCFTextLoader()}</td>
                        </tr>
                        <tr style={{ visibility: "hidden" }}>
                          <td className="cf_new_table_hide_text">
                            <div className="cf_ManageClouds_table_image_container">
                              <img
                                src={cloudImageMapper(providerName)}
                                alt="SLACK"
                              />
                              <p>Omnichannel for C...RM ClientApp Primary</p>
                            </div>
                          </td>
                          <td className="cf_new_table_hide_text">
                            <p>AzureADMultipleOrgs</p>
                          </td>
                          <td className="cf_new_table_hide_text">
                            <p>Microsoft Services</p>
                          </td>

                          <td className="cf_new_table_hide_text">
                            <p>21st Jan 2025</p>
                          </td>
                          <td className="cf_new_table_hide_text">
                            <p>OAUTH2</p>
                          </td>
                          <td
                            className="cf_new_table_hide_text"
                            style={{ width: "15%" }}
                          >
                            <div className="cf_new_unverified_div">
                              <p>Unverified</p>
                            </div>
                          </td>
                          <td
                            className="cf_new_table_hide_text"
                            style={{ width: "15%" }}
                          >
                            <div className="cf_new_unverified_div">
                              <p>Unverified</p>
                            </div>
                          </td>
                        </tr>
                      </>
                    ) : (
                      appsList?.map((data, index) => {
                        return (
                          <tr
                            style={{ animationDelay: `${index * 0.02}s` }}
                            key={`${index}_${
                              data?.appName || data?.displayName
                            }`}
                          >
                            <td className="cf_new_table_hide_text">
                              <div className="cf_ManageClouds_table_image_container">
                                <img
                                  src={
                                    data?.logoUrl
                                      ? data?.logoUrl
                                      : cloudImageMapper(providerName)
                                  }
                                  alt="SLACK"
                                />
                                <p>
                                  {getMaxChar(
                                    data?.appName || data?.displayName,
                                    40
                                  )}
                                </p>
                              </div>
                            </td>
                            {providerName !== "SLACK" &&
                            providerName !== "GOOGLE_WORKSPACE" ? (
                              <>
                                <td className="cf_new_table_hide_text">
                                  <p>
                                    {data?.signIn ||
                                      data?.signInAudience ||
                                      "-"}
                                  </p>
                                </td>
                                <td className="cf_new_table_hide_text">
                                  <p>
                                    {data?.createdTime
                                      ? moment(data?.createdTime).format(
                                          "Do MMM YYYY"
                                        )
                                      : "-"}
                                  </p>
                                </td>
                              </>
                            ) : (
                              ""
                            )}
                            {providerName !== "SLACK" ? (
                              <>
                                <td className="cf_new_table_hide_text">
                                  <p>{data?.oauth2 ? "OAUTH2" : "-"}</p>
                                </td>
                                <td className="cf_new_table_hide_text">
                                  <div
                                    className="CF_d-flex"
                                    style={{ gap: "5px" }}
                                  >
                                    {data?.scopes?.length > 0
                                      ? displayScopes(data?.scopes)
                                      : "-"}
                                  </div>
                                </td>
                              </>
                            ) : (
                              ""
                            )}

                            <td className="cf_new_table_hide_text">
                              {data?.verified ? (
                                <div className="cf_new_verified_div">
                                  <Check
                                    size={16}
                                    strokeWidth={3}
                                    color="#166534"
                                  />
                                  <p>Verified</p>
                                </div>
                              ) : (
                                <div className="cf_new_unverified_div">
                                  <p>Unverified</p>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {scopesList?.length > 0 ? (
              <div
                className="cf_main_content_place_main CF_d-flex"
                style={{
                  padding: "0 0 10px 0",
                  width: scopesList?.length > 0 ? "30%" : "0%",
                  height: "101.5%",
                }}
              >
                <div
                  className="cf_new_tables_div"
                  style={{
                    height: "calc(100% - 10px)",
                  }}
                >
                  <table>
                    <thead>
                      <tr>
                        <th
                          style={{
                            width: "100%",
                            fontSize: "14px",
                            padding: "0 5px",
                          }}
                        >
                          <div className="CF_d-flex ai-center cf_scopesTitle">
                            <p>Scopes List</p>
                            <X
                              size={15}
                              className="CF_Pointer"
                              onClick={() => setScopesList([])}
                            />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopesList?.map((res) => {
                        return (
                          <tr>
                            <td>
                              <div
                                style={{
                                  width: "100%",
                                  flexDirection: "column",
                                  gap: "8px",
                                  overflow: "hidden",
                                }}
                                className="CF_d-flex"
                              >
                                <div
                                  className="cf_new_unverified_div CF_ChangeColor"
                                  style={{ background: "#0022701a" }}
                                >
                                  <p style={{ color: "#000" }}>
                                    {providerName === "MICROSOFT_TEAMS" ||
                                    providerName === "MICROSOFT_OFFICE_365"
                                      ? res?.scopeAccess
                                      : res?.scopeName}
                                  </p>
                                </div>
                                <CustomToolTip
                                  title={
                                    providerName === "MICROSOFT_TEAMS" ||
                                    providerName === "MICROSOFT_OFFICE_365"
                                      ? res?.adminConsentDescription
                                      : res?.scopeAccess
                                  }
                                  customWidth={true}
                                >
                                  <p
                                    style={{
                                      color: "#000",
                                      padding: "0 5px",
                                      fontWeight: "500",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {getMaxChar(
                                      providerName === "MICROSOFT_TEAMS" ||
                                        providerName === "MICROSOFT_OFFICE_365"
                                        ? res?.adminConsentDescription
                                        : res?.scopeAccess,
                                      "56"
                                    )}
                                  </p>
                                </CustomToolTip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              ""
            )}
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default ShadowIT;
