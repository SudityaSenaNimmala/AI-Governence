import { RotateCw, CheckCircle2, Download } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import OrgSelector from "../../Resuables/OrgSelector/OrgSelector";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";

const DemoTabSwitcher = ({
  tabs = [],
  currentTab = {},
  setCurrentTab,
  orgData = [],
  handleOrgChange,
  isGroupSync = true,
  setCheckSync,
  isLicenseSync = true,
  isDownloadReportsLoading = false,
  isDownloadReportsReady = false,
  isLoadingCompleted = true,
  downloadDropboxReports = () => { }
}) => {
  const [activeTab, setActiveTab] = useState(currentTab);
  const { globalContext } = useContext(GlobalContext);
  const { saasCloud } = globalContext;
  useEffect(() => {
    if (currentTab?.key) {
      setActiveTab(currentTab);
      // setCurrentTab(currentTab);
    } else {
      setActiveTab(tabs[0]);
      // setCurrentTab(tabs[0]);
    }
  }, [currentTab]);

  console.log("isDownloadReportsLoading", isDownloadReportsLoading);

  return (
    <div className="CF_d-flex ai-center">
      <div className="cf_fulltab_switcher">
        {tabs?.map((tab, index) => (
          <button
            key={index}
            className={`cf_fulltab_switcher_button ${activeTab?.key === tab?.key
              ? "cf_fulltab_switcher_button_active"
              : ""
              } ${!isGroupSync &&
                ((activeTab?.key === "TEAMS_GROUPS" &&
                  tab?.key === "TEAMS_GROUPS") ||
                  (activeTab?.key === "ASSESSMENTS" &&
                    tab?.key === "ASSESSMENTS"))
                ? "PRE_MIG_LOADING"
                : ""
              } 
            ${!isLicenseSync &&
                activeTab?.key === "LICENSE_MANAGEMENT" &&
                tab?.key === "LICENSE_MANAGEMENT"
                ? "PRE_MIG_LOADING"
                : ""
              }
            ${isDownloadReportsLoading && tab?.key === "DOWNLOAD_REPORTS"
                ? "PRE_MIG_LOADING"
                : ""
              }
            ${tab?.key}`}
            onClick={() => {
              if (isDownloadReportsLoading && tab?.key === "DOWNLOAD_REPORTS") {
                return;
              }
              setActiveTab(tab);
              setCurrentTab(tab);
            }}
          >
            <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
              {
                (isDownloadReportsReady || isDownloadReportsLoading) && tab?.key === "DOWNLOAD_REPORTS" ? "" :
                  <p>{tab?.value}</p>
              }
              {!isGroupSync &&
                ((activeTab?.key === "TEAMS_GROUPS" &&
                  tab?.key === "TEAMS_GROUPS") ||
                  (activeTab?.key === "ASSESSMENTS" &&
                    tab?.key === "ASSESSMENTS")) ? (
                <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                  <p style={{ fontSize: "12px" }}>Syncing In Progress...</p>
                  <RotateCw
                    size={12}
                    onClick={() => setCheckSync(new Date().getTime())}
                    title="Check Status"
                  />
                </div>
              ) : (
                ""
              )}
              {!isLicenseSync &&
                activeTab?.key === "LICENSE_MANAGEMENT" &&
                tab?.key === "LICENSE_MANAGEMENT" ? (
                <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                  <p style={{ fontSize: "12px" }}>Syncing In Progress...</p>
                  <RotateCw
                    size={12}
                    onClick={() => setCheckSync(new Date().getTime())}
                    title="Check Status"
                  />
                </div>
              ) : (
                ""
              )}
              {isDownloadReportsLoading && tab?.key === "DOWNLOAD_REPORTS" ? (
                <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
                  <p style={{ fontSize: "12px" }}>Preparing Reports...</p>
                  <RotateCw
                    size={12}
                    onClick={() => setCheckSync(new Date().getTime())}
                    title="Check Status"
                    className={isLoadingCompleted ? "" : "cf_domainSpinner_na"}
                  />
                </div>
              ) : (
                ""
              )}
              {isDownloadReportsReady && tab?.key === "DOWNLOAD_REPORTS" ? (
                <div className="CF_d-flex ai-center" style={{ gap: "8px" }} onClick={() => downloadDropboxReports()}>
                  <p style={{ fontSize: "12px" }}>Reports Ready</p>
                  <Download size={12} title="Reports Ready" />
                </div>
              ) : (
                ""
              )}
            </div>
          </button>
        ))}
      </div>

      {orgData?.length > 0 && activeTab?.key !== "OVERVIEW" ? (
        (saasCloud?.providerName === "ASANA" || saasCloud?.providerName === "PANDADOC" || saasCloud?.providerName === "MAILTRAP") &&
          (activeTab?.key === "TEAMS_GROUPS" ||
            activeTab?.key === "LICENSE_MANAGEMENT") ? (
          ""
        ) : (
          <>
            {console.log("orgData", orgData)}
            <span className="cf_ml_auto"></span>
            <OrgSelector orgList={orgData} handleOrgChange={handleOrgChange} />
          </>
        )
      ) : (
        ""
      )}
    </div>
  );
};

export default DemoTabSwitcher;
