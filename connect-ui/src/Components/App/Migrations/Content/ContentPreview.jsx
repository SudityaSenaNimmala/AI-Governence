import React, { useContext, useEffect, useState } from "react";
import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import {
  getPreViewDetails,
  updateJob,
  updateRestrictions,
} from "./ContentActions/ContentActions";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";

const ContentPreview = (props) => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isPageLoding, setIsPageLoading] = useState(true);
  const [jobPreViewDetails, setJobPreViewDetails] = useState({});
  let jobDetails = globalContext?.jobDetails;
  const options = [
    {
      index: "1",
      key: "rootFolderPerms",
      name: "Root Folder Permissons",
    },
    {
      index: "2",
      key: "rootFilePerms",
      name: "Root File Permissions",
    },
    {
      index: "3",
      key: "version",
      name: "Version History",
    },
    {
      index: "4",
      key: "innerFolderPerms",
      name: "Box Notes",
    },
    {
      index: "5",
      key: "innerFilePerms",
      name: "External Shares",
    },
  ];

  useEffect(() => {
    if (props?.atPosition === 4) {
      doUpdateJob();
    }
  }, [props?.atPosition]);

  const doUpdateJob = async () => {
    let params = `jobName=${jobDetails?.jobName}&specialCharacter=-`;
    let options = "";
    jobDetails?.jobOptions?.map((data) => {
      return (options = `${options}&${data}=true`);
    });
    if (jobDetails.migrationType === "Delta") {
      options = `${options}&isDeltaMigration=true`;
    }

    await updateJob(jobDetails?.id, params + options);
    await updateRestrictions(jobDetails?.id, {
      emailValues: [],
      onlyPickExtension: [],
      notToMoveExtension: jobDetails?.notToMoveExtension,
    });
    let updateData = await getPreViewDetails(jobDetails?.id);
    if (updateData?.status === "OK") {
      setJobPreViewDetails(updateData?.res);
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  return (
    <>
      <div className="cf_content_migration_preview">
        <div className="cf_content_migration_preview_jobOptions">
          <div className="cf_content_mapping_title">
            <h4>Job Options</h4>
          </div>
          <div
            className="cf_content_premissionMapping_body"
            style={{ height: "calc(100% - 40px)" }}
          >
            <div
              className="cf_jobOptions_Options_Div"
              style={{ height: "40px" }}
            >
              <div className="cf_jobOptions_Options_Div_Key">
                <span>Job type </span>
                <span style={{ marginLeft: "auto" }}>:</span>
              </div>
              <div
                className="cf_jobOptions_Options_Div_Key"
                style={{ fontWeight: "400" }}
              >
                One Time
              </div>
            </div>
            <div
              className="cf_jobOptions_Options_Div"
              style={{ height: "40px" }}
            >
              <div className="cf_jobOptions_Options_Div_Key">
                <span>From Cloud </span>
                <span style={{ marginLeft: "auto" }}>:</span>
              </div>
              <div
                className="cf_jobOptions_Options_Div_Key"
                style={{ fontWeight: "400" }}
              >
                <div
                  className="CF_d-flex"
                  style={{ gap: "5px", width: "100%" }}
                >
                  <div className="cf_mapping_table_cloudIcon">
                    <img
                      src={cloudImageMapper(
                        globalContext?.sourceCloud?.cloudName
                      )}
                      alt="BOX_BUSINESS"
                    />
                  </div>
                  <div
                    className="CF_d-flex CF_flex-d-column"
                    style={{ width: "100%" }}
                  >
                    <span
                      className="cf_mapping_email"
                      title="Box Business"
                      style={{ fontWeight: "400" }}
                    >
                      {getCloudName(globalContext?.sourceCloud?.cloudName)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div
              className="cf_jobOptions_Options_Div"
              style={{ height: "40px" }}
            >
              <div className="cf_jobOptions_Options_Div_Key">
                <span>To Cloud </span>
                <span style={{ marginLeft: "auto" }}>:</span>
              </div>
              <div
                className="cf_jobOptions_Options_Div_Key"
                style={{ fontWeight: "400" }}
              >
                <div
                  className="CF_d-flex"
                  style={{ gap: "5px", width: "100%" }}
                >
                  <div className="cf_mapping_table_cloudIcon">
                    <img
                      src={cloudImageMapper(
                        globalContext?.destinationCloud?.cloudName
                      )}
                      alt="BOX_BUSINESS"
                    />
                  </div>
                  <div
                    className="CF_d-flex CF_flex-d-column"
                    style={{ width: "100%" }}
                  >
                    <span
                      className="cf_mapping_email"
                      title="OneDrive for Business"
                      style={{ fontWeight: "400" }}
                    >
                      {getCloudName(globalContext?.destinationCloud?.cloudName)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div
              className="cf_jobOptions_Options_Div"
              style={{ height: "40px" }}
            >
              <div className="cf_jobOptions_Options_Div_Key">
                <span>Replace Special Characters With </span>
                <span style={{ marginLeft: "auto" }}>:</span>
              </div>
              <div
                className="cf_jobOptions_Options_Div_Key"
                style={{ fontWeight: "400" }}
              >
                -
              </div>
            </div>
            <div
              className="cf_jobOptions_Options_Div"
              style={{ height: "40px" }}
            >
              <div className="cf_jobOptions_Options_Div_Key">
                <span>Migration Pairs </span>
                <span style={{ marginLeft: "auto" }}>:</span>
              </div>
              <div
                className="cf_jobOptions_Options_Div_Key"
                style={{ fontWeight: "400" }}
              >
                {jobDetails?.listOfMoveWorkspaceId?.length}
              </div>
            </div>
            <div
              className="cf_jobOptions_Options_Div"
              style={{ height: "40px" }}
            >
              <div className="cf_jobOptions_Options_Div_Key">
                <span>Exclude File Types </span>
                <span style={{ marginLeft: "auto" }}>:</span>
              </div>
              <div
                className="cf_jobOptions_Options_Div_Key"
                style={{ fontWeight: "400" }}
              >
                {jobDetails?.notToMoveExtension?.join(", ")}
              </div>
            </div>
          </div>
        </div>
        <div className="cf_content_migration_preview_jobOptions">
          <div className="cf_content_mapping_title">
            <h4>Migration Options</h4>
          </div>
          <div
            className="cf_content_premissionMapping_body"
            style={{ height: "calc(100% - 40px)" }}
          >
            {options?.map((data) => {
              return (
                <div
                  key={data?.index}
                  className="cf_jobOptions_Options_Div"
                  style={{ height: "40px" }}
                >
                  <div className="cf_jobOptions_Options_Div_Key">
                    <span>{data?.name}</span>
                    <span style={{ marginLeft: "auto" }}>:</span>
                  </div>
                  <div
                    className="cf_jobOptions_Options_Div_Key"
                    style={{ fontWeight: "400" }}
                  >
                    {jobPreViewDetails[data?.key] ? "Yes" : "No"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="cf_content_migration_options">
        <div className="cf_content_mapping_title">
          <h4>Migration Pairs</h4>
        </div>
        <div className="cf_content_premissionMapping_body">
          <table className="cf_mapping_table">
            <thead>
              <tr>
                <th>
                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                    <span className="fw-600">Source Users</span>
                  </div>
                </th>
                <th>
                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                    <span className="fw-600">Destination Users</span>
                  </div>
                </th>
                <th>
                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                    <span className="fw-600">Provision Status</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobPreViewDetails?.previewDetail?.map((data, index) => {
                return (
                  <tr key={`${index}_${data?.fromEmailId}`}>
                    <td>
                      <div className="CF_d-flex" style={{ gap: "5px" }}>
                        <div className="cf_mapping_table_cloudIcon">
                          <img
                            src={cloudImageMapper(
                              globalContext?.sourceCloud?.cloudName
                            )}
                            alt={globalContext?.sourceCloud?.cloudName}
                          />
                        </div>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email"
                            title="alex@filefuze.co"
                          >
                            {data?.fromEmailId}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="CF_d-flex" style={{ gap: "5px" }}>
                        <div className="cf_mapping_table_cloudIcon">
                          <img
                            src={cloudImageMapper(
                              globalContext?.destinationCloud?.cloudName
                            )}
                            alt={globalContext?.destinationCloud?.cloudName}
                          />
                        </div>
                        <div
                          className="CF_d-flex CF_flex-d-column"
                          style={{ width: "100%" }}
                        >
                          <span
                            className="cf_mapping_email"
                            title="alex@filefuze.co"
                          >
                            {data?.toEmailId}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div
                        className="CF_d-flex CF_flex-d-column"
                        style={{ width: "100%" }}
                      >
                        <span
                          className="cf_mapping_email"
                          style={{
                            color: data?.toProvision ? "green" : "red",
                          }}
                        >
                          {data?.toProvision
                            ? "Provisioned"
                            : "Not Provisioned"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {isPageLoding ? getCFLoader() : ""}
    </>
  );
};

export default ContentPreview;
