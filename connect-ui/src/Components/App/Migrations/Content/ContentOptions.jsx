import React, { useContext, useEffect, useState } from "react";
import TextInput from "../../../Resuables/InputsComponents/TextInput";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { checkMultiUserPair, createJob } from "./ContentActions/ContentActions";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import { SET_JOB_DETAILS } from "../../../../GlobalContext/action.types";
import { notifyToast } from "../../../helpers/utils";
import { IoCloseCircleOutline } from "react-icons/io5";

const ContentOptions = (props) => {
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [isPageLoding, setIsPageLoading] = useState(true);
  const [migrationType, setMigrationType] = useState("Onetime");
  const [jobsParams, setJobsParams] = useState([]);
  const [jobDetails, setJobDetails] = useState({});
  const [fileTypes, setFileTypes] = useState({
    value: "",
    fileTypes: [],
  });
  const [types, setTypes] = useState("");
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
      key: "versioning",
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
    if (props?.atPosition === 3 && props?.previousPosition === 2) {
      handleCreateJob();
      setMigrationType("Onetime");
    }
  }, [props?.atPosition, props?.previousPosition]);

  useEffect(() => {
    if (jobDetails?.id) {
      dispatch({
        type: SET_JOB_DETAILS,
        payload: jobDetails,
      });
    }
  }, [jobDetails]);

  const handleCreateJob = async () => {
    let checkMultiUserPairs = [];
    let createObject = [];
    globalContext?.mappedPairs?.map((data) => {
      let newObj = {
        fromMailId: data?.fromMailId,
        fileName: data?.fromMailId,
        toMailId: data?.toMailId,
        fromCloudName: globalContext?.sourceCloud?.cloudName,
        toCloudName: globalContext?.destinationCloud?.cloudName,
      };

      checkMultiUserPairs.push(newObj);
      let newObj1 = {};
      console.log(data);

      if (data?.isCSV) {
        newObj1 = {
          fromCloudId: {
            id: data?.fromCloudId?.id,
          },
          toCloudId: {
            id: data?.toCloudId?.id,
          },
          isCSV: "true",
          sourceFolderPath:
            data?.data?.sourceCloudDetails?.folderPath === "null" ||
            data?.data?.sourceCloudDetails?.folderPath === "undefined"
              ? "/"
              : data?.data?.sourceCloudDetails?.folderPath,
          destFolderPath:
            data?.data?.destCloudDetails?.folderPath === "null" ||
            data?.data?.destCloudDetails?.folderPath === "undefined"
              ? "/"
              : data?.data?.destCloudDetails?.folderPath,
          destinationFolderName: "null",
        };
      } else if (
        data?.data?.destCloudDetails?.folderPath !== "/" ||
        data?.data?.sourceCloudDetails?.folderPath !== "/" ||
        data?.data?.csvId
      ) {
        newObj1 = {
          fromCloudId: {
            id: data?.fromCloudId?.id,
          },
          toCloudId: {
            id: data?.toCloudId?.id,
          },
          fromRootId: data?.fromRootId,
          toRootId: data?.toRootId,
          sourceFolderPath: data?.data?.sourceCloudDetails?.folderPath,
          destFolderPath: data?.data?.destCloudDetails?.folderPath,
          destinationFolderName: "null",
          folder: "true",
        };
      } else {
        newObj1 = {
          fromCloudId: {
            id: data?.fromCloudId?.id,
          },
          toCloudId: {
            id: data?.toCloudId?.id,
          },
          fromRootId: data?.fromRootId,
          toRootId: data?.toRootId,
        };
      }
      createObject.push(newObj1);
    });
    let checkMultiUser = await checkMultiUserPair(checkMultiUserPairs);
    if (checkMultiUser?.status === "OK") {
      let res = await createJob(createObject);
      if (res?.status === "OK") {
        setJobDetails({
          ...res?.res,
          jobName: `${migrationType}-${res?.res?.jobName}`,
        });
        setIsPageLoading(false);
      } else {
        setIsPageLoading(false);
      }
    } else {
      setIsPageLoading(false);
      notifyToast("error", "Failed to Verify Pairs");
    }
  };

  const handleJobOptions = (e, action) => {
    let cpyArr = [...jobsParams];
    if (action === "ALL") {
      cpyArr = [];
      if (e.target.checked) {
        options?.map((data) => {
          cpyArr.push(data?.key);
        });
      }
    } else {
      if (e.target.checked) {
        cpyArr.push(e.target.name);
      } else {
        cpyArr = cpyArr.filter((data) => {
          return data !== e.target.name;
        });
      }
    }

    setJobDetails({ ...jobDetails, jobOptions: cpyArr });
    setJobsParams(cpyArr);
  };

  const handleFileTypes = (e) => {
    let { value } = e.target;
    if (value?.includes(",")) {
      let cpyFileTypes = { ...fileTypes };
      cpyFileTypes = cpyFileTypes?.fileTypes;
      if (cpyFileTypes?.includes(value?.replace(",", ""))) {
        notifyToast("error", `${value?.replace(",", "")} is already entered.`);
        return setFileTypes({ ...fileTypes, value: "" });
      }
      cpyFileTypes = [
        ...cpyFileTypes,
        ...value.split(",")?.filter((data) => data !== ""),
      ];
      setFileTypes({ value: "", fileTypes: cpyFileTypes });
      setJobDetails({ ...jobDetails, notToMoveExtension: cpyFileTypes });
    } else {
      setFileTypes({ ...fileTypes, value: value });
    }
  };

  const deleteFileTypePairs = (fileType) => {
    let copyFileType = [...fileTypes?.fileTypes];
    copyFileType = copyFileType?.filter((data) => {
      return data !== fileType;
    });
    setFileTypes({ ...fileTypes, fileTypes: copyFileType });
  };

  useEffect(() => {
    setJobDetails({
      ...jobDetails,
      migrationType: migrationType,
      jobName: `${migrationType}-${
        jobDetails?.jobName?.split("-")[1]
          ? jobDetails?.jobName?.split("-")[1]
          : jobDetails?.jobName
      }`,
      jobOptions: [],
    });
  }, [migrationType]);

  return (
    <>
      <div className="cf_content_migration_options">
        <div className="cf_content_mapping_title">
          <h4>Migration Options</h4>
        </div>
        <div className="cf_content_migration_options_body">
          <div className="cf_content_migration_options_holder">
            <div className="cf_content_migration_options_input_holder">
              <div
                className="cf_content_migration_options_input_placer"
                style={{ background: "#f2f3ff" }}
              >
                <input
                  type="checkbox"
                  name="selectAllOptions"
                  id="selectAllOptions"
                  onChange={(e) => handleJobOptions(e, "ALL")}
                  checked={
                    jobDetails?.jobOptions?.length === options?.length &&
                    migrationType !== "Delta"
                  }
                  disabled={migrationType === "Delta"}
                />
                <span htmlFor="selectAllOptions">Select All</span>
              </div>
            </div>
            {options?.map((data) => {
              return (
                <div
                  className="cf_content_migration_options_input_holder"
                  key={data?.index}
                >
                  <div className="cf_content_migration_options_input_placer">
                    <input
                      type="checkbox"
                      id={data?.index}
                      name={data?.key}
                      onChange={(e) => handleJobOptions(e)}
                      checked={
                        jobDetails?.jobOptions?.includes(data?.key) &&
                        migrationType !== "Delta"
                      }
                      disabled={migrationType === "Delta"}
                    />
                    <span style={{ borderBottom: "2px lightgray dashed" }}>
                      {data?.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="cf_job_options_notes">
            <span>Note:</span> Selected Options in onetime migration reflect
            same for delta migration
          </div>
        </div>
      </div>
      <div className="cf_content_migration_options">
        <div className="cf_content_mapping_title">
          <h4>Job Options</h4>
        </div>
        <div
          className="cf_content_migration_options_body"
          style={{ padding: "0px" }}
        >
          <div className="cf_jobOptions_Options_Div">
            <div className="cf_jobOptions_Options_Div_Key">
              <span>Job Type</span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div className="cf_jobOptions_Options_Div_Key">
              <select
                name="jobTyp"
                id="jobType"
                className="cf_jobOptions_jobType"
                onChange={(e) => setMigrationType(e.target.value)}
                value={migrationType}
              >
                <option value="Onetime">One Time</option>
                <option value="Delta">Delta</option>
              </select>
            </div>
          </div>
          <div className="cf_jobOptions_Options_Div">
            <div className="cf_jobOptions_Options_Div_Key">
              <span>Job Name</span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div className="cf_jobOptions_Options_Div_Key">
              <TextInput
                type="text"
                placeHolder="Delta-BFB-ODFB-Jul.10.2024-8"
                inputName="userName"
                autoFocus={false}
                defaultValue={jobDetails?.jobName}
                inputHeight={"35px"}
                inputWidth={"350px"}
                inputFontSize={"12px"}
                isLableRequired={true}
                getInputText={(val, name) =>
                  setJobDetails({ ...jobDetails, jobName: val })
                }
              />
            </div>
          </div>
          {/* <div className="cf_jobOptions_Options_Div">
            <div className="cf_jobOptions_Options_Div_Key">
              <span>Replace special characters with </span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div className="cf_jobOptions_Options_Div_Key">
              <select
                name="jobTyp"
                id="jobType"
                style={{ width: "130px" }}
                className="cf_jobOptions_jobType"
              >
                <option value="onetime">Underscore ( _ )</option>
                <option value="delta">Hyphen ( - )</option>
              </select>
            </div>
          </div>
          <div className="cf_jobOptions_Options_Div">
            <div className="cf_jobOptions_Options_Div_Key">
              <span>Migration Range </span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div
              className="cf_jobOptions_Options_Div_Key"
              style={{ gap: "10px" }}
            >
              <select
                name="jobTyp"
                id="jobType"
                style={{ width: "130px" }}
                className="cf_jobOptions_jobType"
              >
                <option value="onetime">From Beginning</option>
                <option value="delta">Last 1 Year</option>
                <option value="delta">Last 2 Year</option>
                <option value="delta">Last 3 Year</option>
                <option value="delta">Last 4 Year</option>
                <option value="delta">Last 5 Year</option>
                <option value="delta">Custom</option>
              </select>
              <span>-</span>
              <select
                name="jobTyp"
                id="jobType"
                style={{ width: "130px" }}
                className="cf_jobOptions_jobType"
              >
                <option value="onetime">Today</option>
                <option value="delta">Custom</option>
              </select>
            </div>
          </div>
          <div className="cf_jobOptions_Options_Div">
            <div className="cf_jobOptions_Options_Div_Key">
              <span>Migration Size Range </span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div
              className="cf_jobOptions_Options_Div_Key"
              style={{ gap: "10px" }}
            >
              <select
                name="jobTyp"
                id="jobType"
                style={{ width: "130px" }}
                className="cf_jobOptions_jobType"
              >
                <option value="onetime">No Min</option>
                <option value="delta">1 MB</option>
                <option value="delta">10 MB</option>
                <option value="delta">100 MB</option>
                <option value="delta">500 MB</option>
                <option value="delta">1 GB</option>
                <option value="delta">5 GB</option>
                <option value="delta">Custom</option>
              </select>
              <span>-</span>
              <select
                name="jobTyp"
                id="jobType"
                style={{ width: "130px" }}
                className="cf_jobOptions_jobType"
              >
                <option value="onetime">No Max</option>
                <option value="delta">10 MB</option>
                <option value="delta">100 MB</option>
                <option value="delta">500 MB</option>
                <option value="delta">1 GB</option>
                <option value="delta">5 GB</option>
                <option value="delta">10 GB</option>
                <option value="delta">Custom</option>
              </select>
            </div>
          </div>
          <div
            className="cf_jobOptions_Options_Div"
            style={{
              height:
                types === "Include" || types === "Exclude" ? "120px" : "50px",
            }}
          >
            <div className="cf_jobOptions_Options_Div_Key">
              <span>File Types </span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div
              className="cf_jobOptions_Options_Div_Key"
              style={{ gap: "10px", width: "55%" }}
            >
              <select
                name="jobTyp"
                id="jobType"
                style={{ width: "80px" }}
                className="cf_jobOptions_jobType"
                onChange={(e) => setTypes(e.target.value)}
              >
                <option value="Select">Select</option>
                <option value="Include">Include</option>
                <option value="Exclude">Exclude</option>
              </select>
              {types === "Include" || types === "Exclude" ? (
                <>
                  <span>-</span>
                  <textarea
                    className="cf_textInput"
                    style={{
                      resize: "none",
                      width: "230px",
                      height: "12vh",
                      fontSize: "12px",
                      padding: "6px",
                    }}
                    placeholder="Enter file types seperated by comma (e.g. mp3,mp4,psd)"
                  />
                </>
              ) : (
                ""
              )}
            </div>
          </div> */}
          <div
            className="cf_jobOptions_Options_Div"
            style={{
              height: "fit-content",
              padding: "10px 0",
            }}
          >
            <div className="cf_jobOptions_Options_Div_Key">
              <span>Exclude File types</span>
              <span style={{ marginLeft: "auto" }}>:</span>
            </div>
            <div
              className="cf_jobOptions_Options_Div_Key CF_d-flex CF_flex-d-column"
              style={{ alignItems: "flex-start", gap: "10px", width: "55%" }}
            >
              <textarea
                className="cf_textInput"
                style={{
                  resize: "none",
                  width: "350px",
                  height: "12vh",
                  fontSize: "12px",
                  padding: "6px",
                }}
                onInput={handleFileTypes}
                value={fileTypes?.value}
                placeholder="Enter file types seperated by comma (e.g. mp3,mp4,psd)"
              />
              <div className="cf_list_excludeFileTypes">
                {fileTypes?.fileTypes?.map((data) => {
                  return (
                    <div key={data} className="cf_fileType_container">
                      <span>{data}</span>
                      <IoCloseCircleOutline
                        onClick={(e) => deleteFileTypePairs(data)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      {isPageLoding ? getCFLoader() : ""}
    </>
  );
};

export default ContentOptions;
