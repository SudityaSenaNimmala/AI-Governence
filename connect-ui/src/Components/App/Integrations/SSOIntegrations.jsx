import React, { useContext, useEffect, useState } from "react";
import { getSaaSAppsData } from "../SaaSManagement/SaaSActions/SaaSActions";
import { notifyToast } from "../../helpers/utils";
import Popup from "../../Resuables/Popup/Popup";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { integrateSSOApp } from "./IntegrationActions/IntegrationActions";

const SSOIntegrations = ({
  ssoId,
  ssoEmail,
  ssoProvider,
  setStartSSOApps,
  setIsPageLoading,
  getClouds,
  searchInputSSO,
  adminCloudId,
}) => {
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [appsList, setAppsList] = useState([]);
  const [connectedList, setConnectedList] = useState([]);
  useEffect(() => {
    if (ssoId) {
      getAppsList();
    }
  }, [ssoId]);

  const getAppsList = async () => {
    setIsPageLoading(true);
    setAppsList([]);
    const res = await getSaaSAppsData(ssoId, ssoProvider, 1, 500);
    if (res?.status === "OK" && res?.res?.length > 0) {
      setAppsList(res?.res);
      setIsPageLoading(false);
    } else {
      setAppsList([]);
      setIsPageLoading(false);
      notifyToast("error", "No Apps Found");
    }
  };

  useEffect(() => {
    if (appsList?.length > 0) {
      let connected = [];
      appsList?.forEach((data) => {
        if (cloudsList?.find((cloud) => cloud?.ssoAppId === data?.appId)) {
          connected.push(data?.id);
        }
      });
      setConnectedList(connected);
    }
  }, [appsList]);

  const connectSSOApp = async (app) => {
    setIsPageLoading(true);
    app.adminCloudId = adminCloudId;
    let res = await integrateSSOApp(app, ssoProvider);
    if (res?.status === "OK") {
      setConnectedList([...connectedList, app?.id]);
      setIsPageLoading(false);
      notifyToast("success", "App Connected Successfully");
      getClouds();
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed to connect app");
    }
  };

  return (
    <div className="cf_new_tables_div" style={{ height: "calc(100% - 00px)" }}>
      <table>
        <thead>
          <tr style={{}}>
            <th style={{ width: "40%", textAlign: "left", zIndex: "9" }}>
              Cloud Name
            </th>
            <th style={{ width: "20%", textAlign: "left", zIndex: "9" }}>
              Status
            </th>
            <th style={{ width: "40%", zIndex: "9" }}></th>
          </tr>
        </thead>
        <tbody>
          {appsList
            ?.filter((app) =>
              getCloudName(app?.appName)
                ?.toLowerCase()
                ?.includes(searchInputSSO?.toLowerCase())
            )
            ?.map((app) => (
              <tr key={app?.id}>
                <td>
                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                    <div className={`cf_onboard_cloudSelect_img_wrapper_flow`}>
                      <img
                        src={
                          cloudImageMapper(app?.appName)?.includes("CF_LOGO")
                            ? cloudImageMapper("APPLICATION")
                            : cloudImageMapper(app?.appName)
                        }
                        alt={app?.appName}
                        style={{
                          width: "30px",
                          height: "30px",
                          objectFit: "contain",
                        }}
                      />
                    </div>
                    <p
                      className="cf_ManageClouds_table_domain_name"
                      style={{
                        fontSize: "12px",
                        fontWeight: "500",
                        color: "#454545",
                      }}
                    >
                      {getCloudName(app?.appName)}
                    </p>
                  </div>
                </td>
                <td>
                  <p
                    className="cf_ManageClouds_table_domain_name"
                    style={{
                      fontSize: "12px",
                      fontWeight: "500",
                      color: "#454545",
                    }}
                  >
                    {connectedList?.includes(app?.id)
                      ? "Connected"
                      : "Not Connected"}
                    {/* {cloudsList?.find(
                        (data) =>
                          data?.cloudName === app?.appName &&
                          data?.adminEmail === ssoEmail
                      )?.adminEmail
                        ? "Connected"
                        : "Not Connected"} */}
                  </p>
                </td>
                <td>
                  <div className="CF_d-flex ai-center">
                    {connectedList?.includes(app?.id) ? (
                      ""
                    ) : (
                      <ActionButton
                        customClass={`changeButtonColorOnHover cf_hideforTable`}
                        buttonType="button"
                        buttonClickAction={() => connectSSOApp(app)}
                        customStyles={{
                          backgroundColor: "#0022701a",
                          height: "30px",
                          fontSize: "12px",
                          fontWeight: "500",
                          marginLeft: "auto",
                          color: "#001a6f",
                        }}
                      >
                        Connect
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
};

export default SSOIntegrations;
