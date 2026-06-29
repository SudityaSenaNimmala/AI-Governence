import React, { useContext, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cloudImageMapper, getRandomArray } from "../../helpers/helpers";
import { getMaxChar, newImplementation } from "../../helpers/utils";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import {
  getLicensesUserList,
  getNewShadowAppsListForUser,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import CustomToolTip from "../../Resuables/CustomToolTip/CustomToolTip";
import { X } from "lucide-react";

const ShadowITAppsList = ({ userInfo, setUserForShadowIT }) => {
  const navigate = useNavigate();
  const { globalContext } = useContext(GlobalContext);
  const { memberId, email } = { ...userInfo };
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [appsList, setAppsList] = useState([]);
  const [scopesList, setScopesList] = useState([]);
  const { adminEmail, providerName, id } = {
    ...globalContext?.saasCloud,
  };

  useEffect(() => {
    if (Object.keys(userInfo).length > 0) {
      setIsVisible(true);
      fetchLicenseUsers();
    } else {
      setIsVisible(false);
    }
  }, [userInfo]);

  const fetchLicenseUsers = async (pageNo = 0, pageSize = 100) => {
    setIsLoading(true);
    let res = await getNewShadowAppsListForUser(
      id,
      providerName === "MICROSOFT_OFFICE_365" ? email : userInfo?.id
    );
    if (res?.status === "OK" && res?.res) {
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
        return (index === 0 || index === 1) &&
          (data?.scopeName || data?.scopeAccess) ? (
          <div
            className="cf_new_unverified_div CF_ChangeColor"
            key={`${index}_scopes_${
              providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
              providerName === "MICROSOFT_TEAMS" ||
              providerName === "MICROSOFT_OFFICE_365"
                ? data?.scopeAccess
                : data?.scopeName
            }`}
          >
            <CustomToolTip
              title={
                providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
                providerName === "MICROSOFT_TEAMS" ||
                providerName === "MICROSOFT_OFFICE_365"
                  ? data?.scopeAccess
                  : data?.scopeName
              }
            >
              <p style={{ color: "#000" }}>
                {getMaxChar(
                  providerName === "ONEDRIVE_BUSINESS_ADMIN" ||
                    providerName === "MICROSOFT_TEAMS" ||
                    providerName === "MICROSOFT_OFFICE_365"
                    ? data?.scopeAccess
                    : data?.scopeName,
                  15
                )}
              </p>
            </CustomToolTip>
          </div>
        ) : index === 2 ? (
          <div
            className="cf_new_unverified_div CF_Pointer CF_ChangeColor"
            onClick={() => setScopesList(scopes)}
            key={`${index}_scope2`}
          >
            <CustomToolTip title="Click To View The Scopes">
              <p style={{ color: "#000", zIndex: "-1" }}>
                + {scopes?.length - 2}
              </p>
            </CustomToolTip>
          </div>
        ) : (
          ""
        );
      });
  };

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${userInfo?.email} Shadow IT Applications`,
        popupWidth: "80%",
        type: "side",
        popupHeight: "calc(100% - 0px)",
        popupTop: "0px",
        maxHeight: "100%",
        overflowY: "auto",
        parentStyles: {
          justifyContent: "flex-end",
        },
      }}
      toggleOpen={setUserForShadowIT}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "0 15px 15px 15px",
          height: "100%",
          gap: "10px",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          //   flexDirection: "column",
          // gap: "10px",
        }}
      >
        <div
          className="cf_licenses_container_table"
          style={{
            height: "calc(100% - 0px)",
            overflow: "auto",
            width: scopesList?.length > 0 ? "70%" : "100%",
          }}
        >
          <table className="cf_licenses_table">
            <thead>
              <tr>
                <th style={{ width: "15%", textAlign: "left" }}>
                  Application Name
                </th>
                {providerName === "MICROSOFT_OFFICE_365" ? (
                  <th style={{ width: "15%", textAlign: "left" }}>Publisher</th>
                ) : (
                  ""
                )}
                <th style={{ width: "15%", textAlign: "left" }}>Scopes</th>
              </tr>
            </thead>
            <tbody>
              {appsList?.map((data, index) => {
                return (
                  <tr
                    style={{ animationDelay: `${index * 0.02}s` }}
                    key={`${index}_${data?.appName || data?.displayName}`}
                  >
                    <td className="cf_new_table_hide_text">
                      <div className="cf_ManageClouds_table_image_container">
                        <img
                          src={
                            data?.logoUrl
                              ? data?.logoUrl
                              : providerName === "TAILSCALE" && data?.os
                              ? cloudImageMapper(data?.os)
                              : cloudImageMapper("APPLICATION")
                          }
                          alt="SLACK"
                          style={
                            providerName === "TAILSCALE" && data?.os
                              ? {
                                  width: "20px",
                                  height: "20px",
                                  objectFit: "contain",
                                }
                              : { objectFit: "contain" }
                          }
                        />
                        <div className="cf_license_title">
                          <p>
                            {getMaxChar(
                              providerName === "TAILSCALE"
                                ? data?.hostname
                                : data?.appName || data?.displayName,
                              40
                            )}
                          </p>
                          {providerName === "TAILSCALE" && (
                            <span style={{ fontSize: "10px" }}>
                              {data?.version}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    {providerName === "MICROSOFT_OFFICE_365" ? (
                      <td className="cf_new_table_hide_text">
                        <p>{data?.publisherDomain}</p>
                      </td>
                    ) : (
                      ""
                    )}
                    <td className="cf_new_table_hide_text">
                      <div className="CF_d-flex" style={{ gap: "5px" }}>
                        {data?.scopes?.length > 0
                          ? displayScopes(data?.scopes)
                          : "-"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isLoading ? getCFTextLoader() : ""}
        </div>
        {scopesList?.length > 0 ? (
          <div
            className="cf_main_content_place_main CF_d-flex"
            style={{
              padding: "0 0 0px 0",
              width: scopesList?.length > 0 ? "30%" : "0%",
              position: "sticky",
              top: "00px",
              height: "100%",
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
                  {scopesList?.map((res, index) => {
                    return (
                      <tr key={`${index}_scope1`}>
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
                            <p
                              style={{
                                color: "#000",
                                padding: "0 5px",
                                fontWeight: "500",
                                textOverflow: "ellipsis",
                              }}
                              title={
                                providerName === "MICROSOFT_TEAMS" ||
                                providerName === "MICROSOFT_OFFICE_365"
                                  ? res?.adminConsentDescription
                                  : res?.scopeAccess
                              }
                            >
                              {getMaxChar(
                                providerName === "MICROSOFT_TEAMS" ||
                                  providerName === "MICROSOFT_OFFICE_365"
                                  ? res?.adminConsentDescription
                                  : res?.scopeAccess,
                                "44"
                              )}
                            </p>
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
    </Popup>
  );
};

export default ShadowITAppsList;
