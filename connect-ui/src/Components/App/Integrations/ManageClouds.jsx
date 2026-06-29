import { Copy, Key, Keyboard, Telescope, Trash2, X } from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SET_CLOUDS_LIST } from "../../../GlobalContext/action.types";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import {
  cloudImageMapper,
  getCloudName,
  integrationsList
} from "../../helpers/helpers";
import {
  checkForKeyExists,
  copyToClipboard,
  getCategoryForCloud,
  getCloudsList,
  getMaxChar,
  notifyToast,
  validateEmail,
} from "../../helpers/utils";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import TextInputUpdate from "../../Resuables/InputsComponents/TextInputUpdate";
import { getCFLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import SearchComponent from "../../Resuables/SearchComponent/SearchComponent";
import { deleteMessaegCloud } from "../Migrations/Message/MessageActions/MessageActions";
import { startOauth } from "../Oauth/OauthActions/OauthActions";
import {
  saveOauthCode,
  saveOauthKeys,
  updateAdminEmail,
  updateSaaSVendor,
} from "../Oauth/OauthActions/OauthApiActions";
import {
  deleteVendor,
  saveApiKey,
} from "./IntegrationActions/IntegrationActions";
import SSOIntegrations from "./SSOIntegrations";

const ManageClouds = () => {
  const navigation = useNavigate();
  const [selectedApp, setSelectedApp] = useState(null);
  const [startSSOApps, setStartSSOApps] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [orgId, setOrgId] = useState("");
  const [isVisible, setIsVisible] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchInputSSO, setSearchInputSSO] = useState("");
  const [deleteInfo, setDeleteInfo] = useState({
    vendorEmail: "",
    vendorName: "",
    vendorId: "",
  });
  const [isVisibleDelete, setIsVisibleDelete] = useState(false);
  const [isApiKeySaving, setIsApiKeySaving] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [cloudsList, setCloudsList] = useState([]);
  const [boardClouds] = useState([
    "LUCID",
    "MIRO",
    "MURAL",
    "SMARTSHEET",
    "JIRA",
  ]);
  const { user } = globalContext;
  const { hasApiAccess } = user;
  const [duplicateCloudsCount, setDuplicateCloudsCount] = useState({
    messageCloudsCount: 0,
  });
  const [isEmailEditable, setIsEmailEditable] = useState(null);
  useEffect(() => {
    getClouds();
  }, []);
  const getClouds = async () => {
    setIsPageLoading(true);
    let cloudsApiList = await getCloudsList("MIGRATION");

    if (cloudsApiList?.status === "OK") {
      setIsPageLoading(false);
      setCloudsList(cloudsApiList?.res);
      dispatch({
        type: SET_CLOUDS_LIST,
        payload: cloudsApiList?.res,
      });
    } else {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (cloudsList?.length > 0) {
      dispatch({
        type: SET_CLOUDS_LIST,
        payload: cloudsList,
      });
    }
  }, [cloudsList]);

  const deleteHandel = async () => {
    setIsVisibleDelete(false);
    setIsPageLoading(true);
    if (deleteInfo?.vendorName === "CURSOR_AI") {
      localStorage.removeItem("cursorInviteLink");
    }
    let res = await deleteVendor(
      deleteInfo?.vendorId,
      deleteInfo?.vendorName,
      deleteInfo?.id
    );
    if (res?.status === "OK") {
      if (deleteInfo?.vendorName === "SLACK") {
        globalContext?.cloudsList?.map(async (data) => {
          if (
            data?.cloudName === deleteInfo?.vendorName &&
            data?.emailId === deleteInfo?.vendorEmail
          ) {
            let resMess = await deleteMessaegCloud(data?.id);
            if (!resMess?.res?.includes("NO_CONTENT")) {
              notifyToast(
                "error",
                "Failed Deleting Application In Message Migration"
              );
            }
          }
        });
      }
      setIsPageLoading(false);
      notifyToast("success", "Application Deleted Successfully");
      getClouds();
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed Deleting Application");
    }
  };

  const startSaveApiKey = async () => {
    setIsApiKeySaving(true);
    let res;
    if (isVisible?.split("|")[1] === "ATLASSIAN") {
      res = await saveOauthCode(isVisible.split("|")[1], {
        code: `${apiKey}:${orgId}`,
        adminCloudId: isVisible.split("|")[0],
      });
    } else if (isVisible?.split("|")[1] === "CURSOR_AI") {
      let body = {
        ...selectedApp,
        deltaUsersUrl: apiKey?.trim(),
      };
      res = await updateSaaSVendor(body);
    } else {
      res = await saveApiKey(
        isVisible.split("|")[0],
        isVisible.split("|")[1],
        apiKey
      );
    }
    if (res?.status === "OK") {
      setApiKey("");
      setIsVisible("");
      setIsApiKeySaving(false);
      localStorage.setItem("cursorInviteLink", "true");
      notifyToast(
        "success",
        `${getCloudName(isVisible?.split("|")[1])} ${isVisible?.split("|")[1] === "CURSOR_AI" ? "Invite Link" : "API Key"
        } Saved Successfully`
      );
      getClouds();
    } else {
      setApiKey("");
      setIsVisible("");
      setIsApiKeySaving(false);
      notifyToast(
        "error",
        `${getCloudName(isVisible?.split("|")[1])} ${isVisible?.split("|")[1] === "CURSOR_AI" ? "Invite Link" : "API Key"
        } Failed To Save`
      );
    }
  };

  useEffect(() => {
    if (globalContext?.cloudsList?.length > 0) {
      let mapper = {};
      let mapper2 = {};
      let messageCloudsCount = 0;
      let contenClouds = 0;
      globalContext?.cloudsList
        ?.filter((data) => {
          return data?.providerName;
        })
        .map((data) => {
          mapper2[getCategoryForCloud(data?.providerName)] =
            mapper2[getCategoryForCloud(data?.providerName)] ?? [];
          mapper2[getCategoryForCloud(data?.providerName)].push(
            data?.providerName
          );
          return (mapper[getCategoryForCloud(data?.providerName)] =
            (mapper[getCategoryForCloud(data?.providerName)]
              ? mapper[getCategoryForCloud(data?.providerName)]
              : 0) + 1);
        });
      let count = 0;

      // if (messageCloudsCount > 1) {
      //   count = count + messageCloudsCount;
      // }

      // if (contenClouds > 1) {
      //   count = count + contenClouds;
      // }

      console.log(mapper2);

      let fnlCount = Object.keys(mapper)?.reduce(
        (a, b) => (mapper[b] > 1 ? mapper[b] + a : a),
        0
      );

      setDuplicateCloudsCount({
        ...duplicateCloudsCount,
        messageCloudsCount: fnlCount > 0 ? fnlCount : 0,
      });
    }
  }, [globalContext?.cloudsList]);

  const getSSOApps = (memberId) => {
    setStartSSOApps(memberId);
  };


  const saveAdminEmail = async (id, email) => {
    setIsPageLoading(true);
    setIsEmailEditable(null);
    let res = await updateAdminEmail(id, email);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      setIsEmailEditable(null);
      let cpyCloudsList = [...cloudsList];
      cpyCloudsList.map((data) => {
        if (data?.id === id) {
          data.adminEmail = email;
        }
      });
      setCloudsList(cpyCloudsList);
      dispatch({
        type: SET_CLOUDS_LIST,
        payload: cpyCloudsList,
      });
      notifyToast("success", "Admin Email Saved Successfully");
    } else {
      setIsEmailEditable(null);
      setIsPageLoading(false);
      notifyToast("error", "Failed To Save Admin Email");
    }
  };

  return (
    <>
      <div className="cf_new_tables_div">
        <div
          className="cf_userMenu_action_pannel"
          style={{ height: "50px", padding: "0 10px" }}
        >
          {duplicateCloudsCount?.messageCloudsCount > 0 ? (
            <div
              className="CF_d-flex ai-center viewMoveIN cf_make_link"
              style={{ gap: "10px" }}
            >
              <p style={{ fontWeight: "500" }}
                onClick={() => navigation("/AppConsolidationReport")}
              >
                Overlapping Apps: {duplicateCloudsCount?.messageCloudsCount}
              </p>
              {/* <MoveRight
                className="cf_newDashboard_OpenLink"
                size={16}
                color="#0062ff"
                strokeWidth={2.5}
              /> */}
            </div>
          ) : (
            ""
          )}
          <span style={{ marginLeft: "auto" }}></span>
          <SearchComponent
            autoOpen={true}
            boxShadows={true}
            inputName="searchInput"
            inputPlaceHolder={`Search By Application Name`}
            onInputSearch={(e) => setSearchInput(e?.searchInput)}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: "25%" }}>Application Name</th>
              <th style={{ width: "20%" }}>Domain</th>
              <th style={{ width: "40%" }}>Email</th>
              <th style={{ width: "15%" }}></th>
            </tr>
          </thead>
          <tbody>
            {globalContext?.cloudsList
              ?.filter((data) =>
                searchInput === ""
                  ? data
                  : getCloudName(data?.providerName === "OTHERS" ? data?.externalProviderName : data?.providerName)
                    ?.toLowerCase()
                    ?.includes(searchInput?.toLowerCase())
              )
              .map((data) => {
                return data?.providerName ? (
                  <>
                    <tr key={data?.id}>
                      <td>
                        <div className="cf_ManageClouds_table_image_container">
                          <img
                            src={data?.externalProviderName && data?.phoneNumber ? `https://cloudfuzehost.com/globalasserts/${data?.phoneNumber}` : cloudImageMapper(data?.providerName, data?.externalProviderName)}
                            alt={data?.providerName}
                          />
                          <div style={{ position: "relative" }}>
                            <p style={{ fontSize: "12px", fontWeight: "500" }}>
                              {data?.providerName === "OTHERS"
                                ? getCloudName(data?.externalProviderName)
                                : getCloudName(
                                  data?.providerName ?? data?.cloudName
                                )}
                            </p>
                            {
                              data?.providerName === "OTHERS" && (
                                <div className="cf_manage_integriation_tag" title="Manual Integration">
                                  <Keyboard size={14} color="#45454582" />
                                  {/* <img src={cloudImageMapper("HANDWRITTER")} alt="Manual Integration" /> */}
                                </div>
                              )
                            }
                          </div>
                        </div>
                      </td>
                      <td>
                        <p className="cf_ManageClouds_table_domain_name" style={{ fontSize: "12px", fontWeight: "500" }}>
                          {data?.domainName}
                        </p>
                      </td>
                      <td style={{ position: "relative" }}>
                        {
                          data?.providerName === "OTHERS" && data?.externalProviderName ? (
                            <>
                              {
                                isEmailEditable?.id === data?.id ? <TextInputUpdate
                                  defaultVal={isEmailEditable?.email}
                                  inputWidth="220px"
                                  inputHeight="40px"
                                  customActionStyles={{ top: "45px" }}
                                  closeAction={() => setIsEmailEditable(null)}
                                  saveAction={(value) => {
                                    if (validateEmail(value)) {
                                      saveAdminEmail(data?.id, value);
                                    } else {
                                      notifyToast("error", "Invalid Email");
                                    }
                                  }}
                                /> :
                                  <p
                                    className="cf_newFlow_trigger_pannel_header_name cf_newFlow_trigger_pannel_header_name_hoverEffect"
                                    onClick={() => setIsEmailEditable({
                                      id: data?.id,
                                      email: data?.adminEmail,
                                    })}
                                    style={{ cursor: "pointer", fontSize: "12px", fontWeight: "500" }}
                                  >
                                    {data?.adminEmail}
                                  </p>
                              }
                            </>
                          ) : (<p className="cf_ManageClouds_table_domain_name" style={{ fontSize: "12px", fontWeight: "500" }}>
                            {data?.adminEmail}
                          </p>)
                        }
                      </td>
                      <td>
                        <div className="cf_ManageClouds_table_Actions">
                          <span style={{ marginLeft: "auto" }}></span>
                          {data?.providerName === "ATLASSIAN" &&
                            data?.isViaSSO &&
                            !data?.memberId ? (
                            <ButtonComponent
                              customstyles={{
                                marginLeft: "auto",
                                fontSize: "12px",
                                height: "30px",
                                display: "flex",
                                gap: "5px",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              inputWidth="100px"
                              isDisabled={false}
                              buttonName="Authenticate"
                              buttonClickAction={() => {
                                setApiKey("");
                                setOrgId("");
                                setIsApiKeySaving(false);
                                setIsVisible(
                                  `${data?.id}|${data?.providerName}`
                                );
                              }}
                            >
                              {/* <Telescope size={14} /> */}
                            </ButtonComponent>
                          ) : (
                            ""
                          )}
                          {data?.providerName === "CURSOR_AI" &&
                            !data?.deltaUsersUrl ? (
                            <ButtonComponent
                              customstyles={{
                                marginLeft: "auto",
                                fontSize: "12px",
                                height: "30px",
                                display: "flex",
                                gap: "5px",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              inputWidth="120px"
                              isDisabled={false}
                              buttonName="Add Invite Link"
                              buttonClickAction={() => {
                                setApiKey("");
                                setIsApiKeySaving(false);
                                setSelectedApp(data);
                                setIsVisible(
                                  `${data?.memberId}|${data?.providerName}`
                                );
                              }}
                            />
                          ) : (
                            ""
                          )}
                          {data?.providerName === "ENTRA_SSO" ||
                            data?.providerName === "OKTA" ? (
                            <ButtonComponent
                              customstyles={{
                                marginLeft: "auto",
                                fontSize: "12px",
                                height: "30px",
                                display: "flex",
                                gap: "5px",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              inputWidth="160px"
                              isDisabled={false}
                              buttonName="Discover Applications"
                              buttonClickAction={() =>
                                getSSOApps(
                                  startSSOApps ===
                                    `${data?.memberId}|${data?.adminEmail}|${data?.providerName}|${data?.id}`
                                    ? null
                                    : `${data?.memberId}|${data?.adminEmail}|${data?.providerName}|${data?.id}`
                                )
                              }
                            >
                              <Telescope size={14} />
                            </ButtonComponent>
                          ) : (
                            ""
                          )}
                          {!data?.apiKey &&
                            data?.providerName === "MS_VIVA_ENGAGE" ? (
                            <ButtonComponent
                              customstyles={{
                                marginLeft: "auto",
                                fontSize: "12px",
                                height: "30px",
                              }}
                              inputWidth="160px"
                              isDisabled={false}
                              buttonName="Authenticate Graph API"
                              buttonClickAction={() => {
                                localStorage.setItem(
                                  "vivaAdminId",
                                  globalContext?.cloudsList?.filter(
                                    (data) =>
                                      data?.cloudName === "MS_VIVA_ENGAGE" &&
                                      data?.driveId === null
                                  )[0]?.id
                                );
                                startOauth("MS_VIVA_ENGAGE_GRAPH");
                              }}
                            />
                          ) : boardClouds?.includes(data?.providerName) &&
                            !data?.apiKey ? (
                            <button
                              className="cf_ManageClouds_table_Actions_button"
                              style={{ marginLeft: "auto" }}
                              title="Configure API Key"
                              onClick={() => {
                                setApiKey("");
                                setIsApiKeySaving(false);
                                setIsVisible(
                                  `${data?.memberId}|${data?.providerName}`
                                );
                              }}
                            >
                              {" "}
                              <Key size={14} />
                            </button>
                          ) : (
                            ""
                          )}
                          {/* <div className="cf_manage_integriation_tag" title={data?.providerName === "OTHERS" ? "Manual Integration" : "API Integration"}>
                            {data?.providerName !== "OTHERS" ? <Unplug size={14} /> : <Keyboard size={14} />}
                          </div> */}
                          {hasApiAccess && <button
                            className="cf_ManageClouds_table_Actions_button show_on_hover"
                            title="Copy Application Id"
                            onClick={() => {
                              copyToClipboard(data?.id, "Application ID For " + getCloudName(data?.providerName));
                            }}
                          >
                            <Copy size={14} color="#475569" />
                          </button>}
                          <button
                            className="cf_ManageClouds_table_Actions_button"
                            onClick={() => {
                              setIsVisibleDelete(true);
                              setDeleteInfo({
                                vendorEmail: data?.adminEmail,
                                vendorId: data?.memberId,
                                vendorName: data?.providerName,
                                id: data?.id,
                              });
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {`${startSSOApps}` ===
                      `${data?.memberId}|${data?.adminEmail}|${data?.providerName}|${data?.id}` ? (
                      <tr>
                        <td colSpan={4}>
                          <div
                            style={{ padding: "10px 0" }}
                            className="CF_d-flex ai-center"
                          >
                            <span style={{ marginLeft: "auto" }}></span>
                            <SearchComponent
                              autoOpen={true}
                              boxShadows={true}
                              inputName="searchInput"
                              inputPlaceHolder={`Search By Application Name`}
                              onInputSearch={(e) =>
                                setSearchInputSSO(e?.searchInput)
                              }
                            />
                          </div>
                          <div
                            className="CF_d-flex ai-center"
                            style={{
                              background: "#0062ff",
                              borderRadius: "5px 5px 0px 0px",
                              padding: "0 10px",
                            }}
                          >
                            <p
                              style={{
                                fontWeight: "500",
                                padding: "8px 5px",
                                fontSize: "14px",
                                color: "#fff",
                              }}
                            >
                              Integrate SSO Apps
                            </p>
                            <X
                              style={{
                                marginLeft: "auto",
                                cursor: "pointer",
                              }}
                              size={14}
                              color="#fff"
                              onClick={() => setStartSSOApps(null)}
                            />
                          </div>
                          <SSOIntegrations
                            getClouds={getClouds}
                            ssoId={startSSOApps?.split("|")[0]}
                            ssoEmail={startSSOApps?.split("|")[1]}
                            ssoProvider={startSSOApps?.split("|")[2]}
                            setStartSSOApps={setStartSSOApps}
                            setIsPageLoading={setIsPageLoading}
                            searchInputSSO={searchInputSSO}
                            adminCloudId={startSSOApps?.split("|")[3]}
                          />
                        </td>
                      </tr>
                    ) : (
                      ""
                    )}
                  </>
                ) : (
                  ""
                );
              })}
          </tbody>
        </table>
      </div>
      {isPageLoading ? getCFLoader() : ""}
      <Popup
        options={{
          isOpen: isVisible,
          title: `${getCloudName(isVisible?.split("|")[1])} ${isVisible?.split("|")[1] === "CURSOR_AI" ? "Invite Link" : "API Key"
            }`,
          popupWidth: "50%",
          popupHeight: "fit-content",
          popupTop: "130px",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "15px 10px", flexDirection: "column", gap: "20px" }}
        >
          <TextInput
            type="text"
            autoFocus={true}
            inputWidth="100%"
            defaultValue={apiKey}
            inputName="domainName"
            placeHolder={
              isVisible?.split("|")[1] === "CURSOR_AI"
                ? "Invite Link *"
                : "API Key *"
            }
            getInputText={(val) => setApiKey(val)}
          />
          {isVisible?.split("|")[1] === "ATLASSIAN" ? (
            <TextInput
              type="text"
              autoFocus={false}
              inputWidth="100%"
              defaultValue={orgId}
              inputName="orgId"
              placeHolder="Organization ID *"
              getInputText={(val) => setOrgId(val)}
            />
          ) : (
            ""
          )}
        </div>
        <div className="cf_popup_container_footer" style={{ gap: "10px" }}>
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={isApiKeySaving}
            isDisabled={
              isVisible?.split("|")[1] === "ATLASSIAN"
                ? orgId?.length === 0 || apiKey?.length === 0
                : apiKey?.length === 0 || isApiKeySaving
            }
            buttonName="Save"
            buttonClickAction={() => startSaveApiKey()}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: isVisibleDelete,
          title: `Delete Application`,
          popupWidth: "30%",
          popupHeight: `200px`,
          popupTop: "150px",
        }}
        toggleOpen={setIsVisibleDelete}
      >
        <div
          className="cf_popup_container_body"
          style={{ padding: "20px 10px", flexDirection: "column", gap: "30px" }}
        >
          <p style={{ fontWeight: "600" }}>
            Are you sure you want to delete the application ?{" "}
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
              setIsVisibleDelete(false);
            }}
          />
          <ButtonComponent
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName="Yes"
            buttonClickAction={() => deleteHandel()}
          />
        </div>
      </Popup>
      <Popup
        options={{
          isOpen: false,
          title: `Discovered Apps Through SSO`,
          popupWidth: "80%",
          popupHeight: `600px`,
          popupTop: "80px",
        }}
        toggleOpen={false}
      >
        <div
          className="cf_popup_container_body"
          style={{
            justifyContent: "flex-start",
            alignItems: "flex-start",
            padding: "10px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(9, 1fr)",
              gap: "20px",
            }}
          >
            {integrationsList()?.map((data, index) => {
              return index < 10 ? (
                <div
                  key={data?.cloudName}
                  className="cf_add_cloud_card"
                  role="link"
                  tabIndex={0}
                  // onClick={() => actionForOauth(data?.cloudName)}
                  style={{ animationDelay: `${index * 0.02}s` }}
                >
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
              ) : (
                ""
              );
            })}
          </div>
        </div>
        <div
          className="cf_popup_container_footer"
          style={{ gap: "10px", padding: "0 20px" }}
        >
          <span style={{ marginLeft: "auto" }}></span>
          <ButtonComponent
            inputWidth="100px"
            customstyles={{
              height: "40px",
            }}
            isLoading={false}
            isDisabled={false}
            buttonName="Integrate"
            buttonClickAction={() => deleteHandel()}
          />
        </div>
      </Popup>
    </>
  );
};

export default ManageClouds;
