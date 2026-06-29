import { ArrowRight, RotateCcw } from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import {
  SET_SELECTED_CHANNELS_MAPPING,
  SET_SELECTED_DMS_MAPPING,
} from "../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { getCloudName } from "../../../helpers/helpers";
import {
  getSelectedDestinationCloudId,
  getSelectedSourceCloudId,
  notifyToast,
} from "../../../helpers/utils";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import {
  createProvisionMapping,
  getMessageAdminStatus,
  runChannelPreMigration,
  runDMsPreMigration,
  runUserPreMigration,
} from "./MessageActions/MessageActions";
import MessagePreMigrationChannels from "./MessagePreMigration/MessagePreMigrationChannels";
import MessagePreMigrationUser from "./MessagePreMigration/MessagePreMigrationUser";

const MessagePreMigration = () => {
  const [isPageLoading, setIspageLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [adminInfo, setAdminInfo] = useState([]);
  const [currentView, setCurrentView] = useState("SUMMARY");
  const [updatedTime, setUpdatedTime] = useState(new Date().toLocaleString());
  const [channelsPreMigrationInfo, setChannelsPreMigrationInfo] = useState([]);
  const [userPreMigrationInfo, setUserPreMigrationInfo] = useState([]);
  const [dmsPreMigrationInfo, setDmsPreMigrationInfo] = useState([]);
  useEffect(() => {
    fetchAdminCloudStatus();
    dispatch({
      type: SET_SELECTED_CHANNELS_MAPPING,
      payload: {
        public: [],
        export: [],
        private: [],
        exportIds: [],
        publicIds: [],
        privateIds: [],
      },
    });
    dispatch({
      type: SET_SELECTED_DMS_MAPPING,
      payload: {
        dms: [],
        dmIds: [],
      },
    });
    localStorage.setItem("privateExistingTeams", "false");
    localStorage.setItem("publicExistingTeams", "false");
  }, []);

  let apiRateLimit = 0;

  const fetchAdminCloudStatus = async () => {
    let adminStatus = await getMessageAdminStatus(getSelectedSourceCloudId());
    if (adminStatus.status === "OK") {
      setIspageLoading(false);
      if (adminStatus?.res?.length === 0) {
        setIspageLoading(true);
        apiRateLimit++;
        if (apiRateLimit < 2) {
          let createMapping = await createProvisionMapping(
            getSelectedSourceCloudId(),
            getSelectedDestinationCloudId(),
            1,
            50
          );
          if (createMapping.status === "OK") {
            setIspageLoading(false);
            fetchAdminCloudStatus();
          }
        } else {
          setIspageLoading(false);
        }
      } else {
        setAdminInfo(adminStatus?.res[0]);
        if (adminStatus?.res[0]?.processStatus !== "NOT_PROCESSED") {
          startRunPreMigration("CHECKING");
        } else {
          setIspageLoading(false);
        }
      }
    } else {
      setIspageLoading(false);
    }
  };

  const startRunPreMigration = async (action) => {
    try {
      setIspageLoading(true);

      const runChannelPreMigrationResponse = await runChannelPreMigration();
      if (runChannelPreMigrationResponse?.status !== "OK") {
        throw new Error("Channel PreMigration failed");
      } else {
        setChannelsPreMigrationInfo(runChannelPreMigrationResponse?.res);
      }

      const runDmPreMigrationResponse = await runDMsPreMigration();
      if (runDmPreMigrationResponse?.status !== "OK") {
        throw new Error("DM PreMigration failed");
      } else {
        setDmsPreMigrationInfo(runDmPreMigrationResponse?.res);
      }

      const userPreMigrationResponse = await runUserPreMigration();
      if (userPreMigrationResponse?.status !== "OK") {
        throw new Error("User PreMigration failed");
      } else {
        setUserPreMigrationInfo(userPreMigrationResponse?.res);
      }

      if (action !== "CHECKING") {
        const checkInitationStatus = await getMessageAdminStatus(
          getSelectedSourceCloudId()
        );
        if (checkInitationStatus?.status !== "OK") {
          throw new Error("Failed To Get Admin Status");
        } else {
          setAdminInfo(checkInitationStatus?.res[0]);
        }
      }

      if (action !== "CHECKING") {
        notifyToast("success", "PreMigration Initiated Successfully");
      }
    } catch (error) {
      console.error(error.message);
    } finally {
      setIspageLoading(false);
    }
  };

  return (
    <>
      {currentView === "SUMMARY" ? (
        <>
          {/* <div className="cf_message_premigration_title"> */}
          <div className="cf_userMenu_action_pannel" style={{ gap: "30px" }}>
            <h2>Pre Migration Summary</h2>
            <div className="cf_ml_auto"></div>
            {adminInfo?.processStatus === "NOT_PROCESSED" ? (
              ""
            ) : (
              // <ButtonComponent
              //   inputWidth="auto"
              //   customstyles={{ padding: "0 10px" }}
              //   buttonName="Run Pre-Migration"
              //   buttonClickAction={() => startRunPreMigration()}
              // />
              <>
                <div>
                  <p style={{ fontWeight: "300" }}>Updated: {updatedTime} </p>
                </div>
                <div>
                  <p>
                    Status:{" "}
                    <span className={adminInfo?.processStatus}>
                      {getCloudName(adminInfo?.processStatus)}
                    </span>
                  </p>
                </div>
                <ActionButton
                  customClass={`changeButtonColorOnHover`}
                  customStyles={{
                    backgroundColor: "#f2f2f2",
                    padding: "8px 12px",
                    height: "40px",
                  }}
                  buttonType="button"
                  buttonClickAction={() => {
                    fetchAdminCloudStatus();
                    startRunPreMigration();
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <RotateCcw
                      size={16}
                      style={{ transform: "rotateY(180deg)" }}
                    />
                  </div>
                </ActionButton>
              </>
            )}
          </div>
          <div className="cf_message_premigration_body">
            <div
              className={`cf_premigration_details_pannel ${
                adminInfo?.processStatus !== "NOT_PROCESSED" &&
                userPreMigrationInfo["Total Users"] === 0
                  ? `PRE_MIG_LOADING`
                  : ""
              }`}
            >
              <div
                className="cf_premigration_details_pannel_title"
                style={{ gap: "10px" }}
              >
                <span>Users</span>
                {userPreMigrationInfo["Total Users"] > 0 ? (
                  <ArrowRight
                    className="CF_Pointer"
                    size={18}
                    strokeWidth={3}
                    style={{ marginTop: "3px" }}
                    color="#0062ff"
                    onClick={() => setCurrentView("USERS")}
                  />
                ) : (
                  ""
                )}
              </div>
              <div
                className="cf_premigration_details_pannel_body"
                style={{ height: "calc(60% - 40px)" }}
              >
                <span>
                  {userPreMigrationInfo["Total Users"]
                    ? userPreMigrationInfo["Total Users"]
                    : 0}
                </span>
              </div>
              <div
                className="CF_d-flex ai-center"
                style={{
                  width: "100%",
                  height: "40%",
                  opacity: "0.6",
                  justifyContent: "space-evenly",
                }}
              >
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Active</span>
                  <span>
                    {userPreMigrationInfo["Active Users"]
                      ? userPreMigrationInfo["Active Users"]
                      : 0}
                  </span>
                </div>
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Inactive</span>
                  <span>
                    {userPreMigrationInfo["Inactive Users"]
                      ? userPreMigrationInfo["Inactive Users"]
                      : 0}
                  </span>
                </div>
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Deactivated</span>
                  <span>
                    {userPreMigrationInfo["Deactivated Users"]
                      ? userPreMigrationInfo["Deactivated Users"]
                      : 0}
                  </span>
                </div>
              </div>
              <p className="CF_PREMIG_LOADER_TEXT">Loading Data...</p>
            </div>
            <div
              className={`cf_premigration_details_pannel ${
                adminInfo?.processStatus !== "NOT_PROCESSED" &&
                channelsPreMigrationInfo?.processStatus !== "PROCESSED"
                  ? `PRE_MIG_LOADING`
                  : ""
              }`}
            >
              <div
                className="cf_premigration_details_pannel_title"
                style={{ gap: "10px" }}
              >
                <span>Channels</span>
                {channelsPreMigrationInfo?.totalChannels ? (
                  <ArrowRight
                    className="CF_Pointer"
                    size={18}
                    strokeWidth={3}
                    style={{ marginTop: "3px" }}
                    color="#0062ff"
                    onClick={() =>
                      setCurrentView(`CHANNELS|${channelsPreMigrationInfo?.id}`)
                    }
                  />
                ) : (
                  ""
                )}
              </div>
              <div
                className="cf_premigration_details_pannel_body"
                style={{ height: "calc(60% - 40px)" }}
              >
                <span>
                  {channelsPreMigrationInfo?.totalChannels
                    ? channelsPreMigrationInfo?.totalChannels
                    : 0}
                </span>
              </div>
              <div
                className="CF_d-flex ai-center"
                style={{
                  width: "100%",
                  height: "40%",
                  opacity: "0.6",
                  justifyContent: "space-evenly",
                }}
              >
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Public</span>
                  <span>
                    {channelsPreMigrationInfo?.totalPublicChannel
                      ? channelsPreMigrationInfo?.totalPublicChannel
                      : 0}
                  </span>
                </div>
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Private</span>
                  <span>
                    {channelsPreMigrationInfo?.totalPrivateChannel
                      ? channelsPreMigrationInfo?.totalPrivateChannel
                      : 0}
                  </span>
                </div>
              </div>
              <p className="CF_PREMIG_LOADER_TEXT">Loading Data...</p>
            </div>
            <div
              className={`cf_premigration_details_pannel ${
                adminInfo?.processStatus !== "NOT_PROCESSED" &&
                dmsPreMigrationInfo?.processStatus !== "PROCESSED"
                  ? `PRE_MIG_LOADING`
                  : ""
              }`}
            >
              <div
                className="cf_premigration_details_pannel_title"
                style={{ gap: "10px" }}
              >
                <span>Direct Messages</span>
                {dmsPreMigrationInfo?.totalDms ? (
                  <ArrowRight
                    className="CF_Pointer"
                    size={18}
                    strokeWidth={3}
                    style={{ marginTop: "3px" }}
                    color="#0062ff"
                    onClick={() =>
                      setCurrentView(`DM|${dmsPreMigrationInfo?.id}`)
                    }
                  />
                ) : (
                  ""
                )}
              </div>
              <div className="cf_premigration_details_pannel_body">
                <span>
                  {dmsPreMigrationInfo?.totalDms
                    ? dmsPreMigrationInfo?.totalDms
                    : 0}
                </span>
              </div>
              <p className="CF_PREMIG_LOADER_TEXT">Loading Data...</p>
            </div>
            <div
              className={`cf_premigration_details_pannel ${
                adminInfo?.processStatus !== "NOT_PROCESSED" &&
                dmsPreMigrationInfo?.processStatus !== "PROCESSED" &&
                channelsPreMigrationInfo?.processStatus !== "PROCESSED"
                  ? `PRE_MIG_LOADING`
                  : ""
              }`}
            >
              <div className="cf_premigration_details_pannel_title">
                <span>Total Messages</span>
              </div>
              <div
                className="cf_premigration_details_pannel_body"
                style={{ height: "calc(60% - 40px)" }}
              >
                <span>
                  {channelsPreMigrationInfo?.totalMessageInChannel +
                  dmsPreMigrationInfo?.totalMessageInChannel
                    ? channelsPreMigrationInfo?.totalMessageInChannel +
                      dmsPreMigrationInfo?.totalMessageInChannel
                    : 0}
                </span>
              </div>
              <div
                className="CF_d-flex ai-center"
                style={{
                  width: "100%",
                  height: "40%",
                  opacity: "0.6",
                  justifyContent: "space-evenly",
                }}
              >
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Channels</span>
                  <span>{channelsPreMigrationInfo?.totalMessageInChannel}</span>
                </div>
                <div
                  className="CF_d-flex ai-center CF_flex-d-column"
                  style={{ width: "49%" }}
                >
                  <span>Direct Messages</span>
                  <span>{dmsPreMigrationInfo?.totalMessageInChannel}</span>
                </div>
              </div>
              <p className="CF_PREMIG_LOADER_TEXT">Loading Data...</p>
            </div>
          </div>
          {/* <Calendar customDate={"02/14/2024"}/> */}
        </>
      ) : (
        ""
      )}
      {currentView === "USERS" ? (
        <MessagePreMigrationUser
          resetView={setCurrentView}
          setIspageLoading={setIspageLoading}
          userInfo={userPreMigrationInfo}
        />
      ) : (
        ""
      )}
      {currentView.split("|")[0] === "CHANNELS" ||
      currentView.split("|")[0] === "DM" ? (
        <MessagePreMigrationChannels
          resetView={setCurrentView}
          currentView={currentView}
          setIspageLoading={setIspageLoading}
          channelType={currentView.split("|")[0]}
          dmInfo={dmsPreMigrationInfo}
          preMigrationId={currentView.split("|")[1]}
          channelInfo={channelsPreMigrationInfo}
        />
      ) : (
        ""
      )}
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MessagePreMigration;
