import { cloudImageMapper } from "../../helpers/helpers";
import { getCFTextLoader } from "../../Resuables/Loaders/Loaders";

const FlowLicenseSelector = ({
  appName = "",
  appId = "",
  licenseMap = [],
  isLicenseLoaded = false,
  handleLicenseSelection = () => { },
  selectedLicenses = [],
  isTitleVisible = true,
}) => {
  return (
    <div
      className="cf_workdflow_cloud_license_item_container"
      style={{ marginTop: "20px" }}
    >
      {isTitleVisible && <p
        className="cf_sub_heading"
        style={{
          color: "#64748b",
          fontWeight: "500",
          fontSize: "16px",
        }}
      >
        Select License To Assign
      </p>}
      {!isLicenseLoaded && licenseMap?.length === 0 ? <p style={{ padding: "10px", textAlign: "center", fontWeight: "500", fontSize: "12px", color: "#64748b" }}>No license found</p> : isLicenseLoaded
        ? getCFTextLoader()
        : licenseMap?.map((res) => (
          !res?.manualEntry && (() => {
            const isChecked = selectedLicenses?.find(
              (license) => (license?.id === res?.id || license?.subscriptionId === res?.id)
            );
            return (
              <div
                className="cf_workdflow_cloud_license_item_license"
                key={res?.id}
                onClick={(e) => {
                  if (e.target.type !== "checkbox") {
                    handleLicenseSelection(
                      { target: { checked: !isChecked } },
                      res,
                      `${appName}|${appId}`
                    );
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <img src={cloudImageMapper(appName)} alt={appName} />
                <p>
                  {res?.planName?.replaceAll("_", " ")}{" "}
                  {res?.organization ? (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: "500",
                      }}
                    >
                      ({res?.organization})
                    </span>
                  ) : (
                    ""
                  )}
                </p>
                <span style={{ marginLeft: "auto" }}></span>
                <input
                  type="checkbox"
                  onChange={(e) => {
                    handleLicenseSelection(e, res, `${appName}|${appId}`);
                  }}
                  checked={!!isChecked}
                />
              </div>
            );
          })()))}
    </div>
  );
};

export default FlowLicenseSelector;
