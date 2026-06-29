import React, { useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BiFilterAlt } from "react-icons/bi";
import { FaRegTimesCircle } from "react-icons/fa";
import { IoTrashOutline } from "react-icons/io5";
import {
  RESET_MAPPING_PAIRS,
  SET_CSV_MAPPING_ID,
  SET_MAPPED_PAIRS,
} from "../../../../../GlobalContext/action.types";
import { GlobalContext } from "../../../../../GlobalContext/GlobalContext";
import { cloudImageMapper } from "../../../../helpers/helpers";
import { downloadGlobalCSV, notifyToast } from "../../../../helpers/utils";
import CustomDropDown from "../../../../Resuables/CustomDropDown/CustomDropDown";
import ButtonComponent from "../../../../Resuables/InputsComponents/ButtonComponent";
import TextInputUpdate from "../../../../Resuables/InputsComponents/TextInputUpdate";
import { getCFLoader } from "../../../../Resuables/Loaders/Loaders";
import {
  deleteExistingMappings,
  doAutoMap,
  downloadMappedCSV,
  downloadSampleCSV,
  getMappingCacheList,
  saveMappings,
  uploadCsvFile,
} from "../ContentActions/ContentActions";

const MappingPairs = () => {
  const fileUploadRef = useRef(null);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const location = useLocation();
  const sprawlUsers = location.state?.preSelectedUsers ?? [];
  const [editingSprawlId, setEditingSprawlId] = useState(undefined);
  const [sprawlDestMap, setSprawlDestMap] = useState(() => {
    // Pre-map the first sprawl user as a demo (remaining show NOT MATCHED)
    const first = sprawlUsers[0];
    if (!first) return {};
    const key = first.id ?? "sprawl_0";
    const username = first.email?.split("@")[0] ?? "user";
    return { [key]: `${username}@gajha.com` };
  });
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [selectedPairs, setSelectedPairs] = useState([]);
  const [isCSVMapping, setIsCSVMapping] = useState(false);
  const [mappingCacheList, setMappingCacheList] = useState([]);
  const [matchedFilters, setMatchedFilters] = useState({
    sortBy: "",
    matchBy: { key: "", value: "All" },
  });
  // useEffect(() => {
  //   if (
  //     globalContext?.mappingSource[0]?.sourceCloudId &&
  //     globalContext?.mappingDestination[0]?.destCloudId
  //   ) {
  //     setTimeout(() => {
  //       appendMapping();
  //     }, 300);
  //   }
  // }, [
  //   globalContext?.mappingSource[0]?.sourceCloudId,
  //   globalContext?.mappingDestination[0]?.destCloudId,
  // ]);

  // useEffect(() => {
  //   dispatch({
  //     type: SET_MAPPED_PAIRS,
  //     payload: [],
  //   });
  //   getMappingCache();
  // }, []);

  const getMappingCache = async () => {
    setIsPageLoading(true);
    let res = await getMappingCacheList(
      1,
      30,
      matchedFilters?.matchBy?.key,
      matchedFilters?.sortBy
    );
    if (res?.status === "OK") {
      setMappingCacheList(res?.res);
      if (res?.res[0]?.csvId) {
        setIsCSVMapping(true);
      }
      dispatch({
        type: SET_CSV_MAPPING_ID,
        payload: res?.res[0]?.csvId,
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  const appendMapping = async () => {
    setIsPageLoading(true);
    let res = await saveMappings();
    if (res?.status === "OK" && res?.res?.length > 0) {
      setMappingCacheList([...mappingCacheList, ...(res?.res ?? [])]);
      dispatch({
        type: RESET_MAPPING_PAIRS,
        payload: [],
      });
      setIsPageLoading(false);
      let sourceCheck = document.querySelectorAll("#input_SOURCE:checked");
      sourceCheck.forEach((input) => {
        input.checked = false;
        input.disabled = true;
      });
      let destinationCheck = document.querySelectorAll(
        "#input_DESTINATION:checked"
      );
      destinationCheck.forEach((input) => {
        input.checked = false;
        input.disabled = true;
      });
    } else {
      setIsPageLoading(false);
    }
  };

  const selectMappingPairs = (e, mappingObject) => {
    let checkBoxs = document.querySelectorAll("#mappingPairsInput");
    let checkBoxsChecked = document.querySelectorAll(
      "#mappingPairsInput:checked"
    );
    let copyObj = [...selectedPairs];
    if (e.target.checked) {
      copyObj.push(mappingObject);
    } else {
      copyObj = copyObj?.filter((data) => {
        return data?.fromCloudId?.id !== mappingObject?.fromCloudId?.id;
      });
    }
    setSelectedPairs(copyObj);
    dispatch({
      type: SET_MAPPED_PAIRS,
      payload: copyObj,
    });
    if (
      checkBoxs.length > 0 &&
      checkBoxs?.length === checkBoxsChecked?.length
    ) {
      document.querySelector("#selectAllMappings").checked = true;
    } else {
      document.querySelector("#selectAllMappings").checked = false;
    }
  };

  const checkForSelectAllMappings = (e) => {
    let checkBoxs = document.querySelectorAll("#mappingPairsInput");
    let mapObj = [];
    if (e.target.checked) {
      checkBoxs.forEach((input) => {
        input.checked = true;
        mapObj.push(
          JSON.parse(decodeURIComponent(input.getAttribute("mappingObj")))
        );
      });
    } else {
      checkBoxs.forEach((input) => {
        input.checked = false;
      });
    }
    setSelectedPairs(mapObj);
    dispatch({
      type: SET_MAPPED_PAIRS,
      payload: mapObj,
    });
  };

  const startAutoMap = async () => {
    setIsPageLoading(true);
    let res = await deleteExistingMappings();
    if (res?.status === "OK") {
      let autoMapRes = await doAutoMap();
      if (autoMapRes?.status === "OK") {
        getMappingCache();
      } else {
        setIsPageLoading(false);
      }
    } else {
      setIsPageLoading(false);
    }
  };

  const deleteMappings = async () => {
    setIsPageLoading(true);
    let res = await deleteExistingMappings();
    if (res?.status === "OK") {
      // Mapping Deleted
    } else {
      setIsPageLoading(false);
    }
    setMappingCacheList([]);
    setIsCSVMapping(false);
    setIsPageLoading(false);
    document.querySelector("#selectAllMappings").checked = false;
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsPageLoading(true);

    if (file.type !== "text/csv") {
      setIsPageLoading(true);
      notifyToast("warn", "Invalid File Uploaded, Only Accepts CSV Format");
      return;
    }
    let reader = new FileReader();
    reader.onload = async () => {
      let deleteMappig = await deleteExistingMappings();
      if (deleteMappig?.status === "OK") {
        let fileUploadResponse = await uploadCsvFile(file);
        if (fileUploadResponse?.status === "OK") {
          if (fileUploadResponse?.res?.cfMappingCachesList?.length > 0) {
            getMappingCache();
          } else {
            deleteExistingMappings();
            setIsPageLoading(false);
          }
        } else {
          setIsPageLoading(false);
        }
      } else {
        setIsPageLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const handleCSVUpload = () => {
    fileUploadRef.current.value = "";
    fileUploadRef.current.click();
  };

  // useEffect(() => {
  //   getMappingCache();
  // }, [matchedFilters]);

  const downloadCSV = async () => {
    if (isCSVMapping) {
    } else {
      let res = await downloadSampleCSV();
    }
  };

  const downloadMappings = async () => {
    setIsPageLoading(true);
    let res = await downloadMappedCSV();
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res?.length > 0) {
        downloadGlobalCSV(res?.res, "USERMAPPING");
      } else {
        notifyToast(
          "success",
          "Report is in Progress,will be ready in few minutes"
        );
      }
    } else {
      notifyToast("error", "Failed To Generate CSV");
      setIsPageLoading(false);
    }
  };

  return (
    <>
      <div className="cf_content_mapping">
        <input
          type="file"
          accept=".csv"
          ref={fileUploadRef}
          onChange={(e) => handleFileUpload(e)}
          style={{
            visibility: "hidden",
            width: "0",
            height: "0",
            position: "absolute",
          }}
        />
        <div className="cf_content_mapping_title">
          <h4>Mapped Users</h4>
          <div className="cf_content_mapping_title_actions">
            <span
              className={`CF_d-flex ai-center CF_Pointer ${isCSVMapping ? "cf_cal_nextDate_disabled" : ""
                }`}
              onClick={downloadCSV}
            >
              <img src={cloudImageMapper("CSV_DOWNLOAD")} alt="CSV_DOWNLOAD" />
            </span>
            <span
              className="CF_d-flex ai-center CF_Pointer"
              onClick={() => handleCSVUpload()}
            >
              <img src={cloudImageMapper("CSV_UPLOAD")} alt="CSV_UPLOAD" />
            </span>
            <span>
              <button
                className="cf_autoMap_action"
                onClick={() => startAutoMap()}
              >
                Auto Map
              </button>
            </span>
          </div>
        </div>
        <div className="cf_content_premissionMapping_body">
          <table className="cf_mapping_table">
            <thead>
              <tr>
                <th style={{ width: "2%" }}>
                  <input
                    type="checkbox"
                    id="selectAllMappings"
                    onClick={(e) => checkForSelectAllMappings(e)}
                  />
                </th>
                <th style={{ width: "48%" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                    <span className="fw-600">Source Users</span>
                    <CustomDropDown
                      defaultVal={
                        matchedFilters?.sortBy === "sourceCloud"
                          ? matchedFilters?.matchBy
                          : { key: "", value: "All" }
                      }
                      dropDownList={[
                        { key: "", value: "All" },
                        { key: "matched", value: "Matched" },
                        { key: "notMatched", value: "Unmatched" },
                      ]}
                      selectFilter={(e) =>
                        setMatchedFilters({
                          sortBy: "sourceCloud",
                          matchBy: e,
                        })
                      }
                    >
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt />
                      </span>
                    </CustomDropDown>
                  </div>
                </th>
                <th style={{ width: "48%" }}>
                  <div className="CF_d-flex ai-center" style={{ gap: "10px" }}>
                    <span className="fw-600">Destination Users</span>
                    <CustomDropDown
                      defaultVal={
                        matchedFilters?.sortBy === "destCloud"
                          ? matchedFilters?.matchBy
                          : { key: "", value: "All" }
                      }
                      dropDownList={[
                        { key: "", value: "All" },
                        { key: "matched", value: "Matched" },
                        { key: "notMatched", value: "Unmatched" },
                      ]}
                      selectFilter={(e) =>
                        setMatchedFilters({
                          sortBy: "destCloud",
                          matchBy: e,
                        })
                      }
                    >
                      <span className="CF_Pointer CF_d-flex ai-center">
                        <BiFilterAlt />
                      </span>
                    </CustomDropDown>
                  </div>
                </th>
                <th>
                  <span
                    role="button"
                    tabIndex="0"
                    onClick={() => deleteMappings()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        deleteMappings();
                      }
                    }}
                    className="CF_Pointer"
                  >
                    <IoTrashOutline />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sprawlUsers.map((u, idx) => {
                const rowKey = u.id ?? `sprawl_${idx}`;
                const isEditing = editingSprawlId !== undefined && editingSprawlId === rowKey;
                const mappedDest = sprawlDestMap[rowKey];
                const rowBg = idx % 2 === 0 ? "#f9f9fb" : "#ffffff";
                return (
                  <tr key={`sprawl_${u.id}`} style={{ background: rowBg }}>
                    <td>
                      <input
                        type="checkbox"
                        id="mappingPairsInput"
                        disabled={!mappedDest}
                      />
                    </td>
                    <td>
                      <div className="CF_d-flex" style={{ alignItems: "center" }}>
                        <div className="cf_mapping_table_cloudIcon">
                          <img src={cloudImageMapper(u.vendorName)} alt={u.vendorName} />
                        </div>
                        <div className="CF_d-flex CF_flex-d-column" style={{ paddingLeft: "10px" }}>
                          <span className="cf_mapping_email" title={u.email}>{u.email ?? "—"}</span>
                          <span style={{ fontSize: "10px", color: "#0062ff", fontWeight: 600 }}>From Email Sprawl</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ position: "relative", minHeight: "40px", overflow: "visible" }}>
                      {isEditing ? (
                        <TextInputUpdate
                          defaultVal={mappedDest ?? ""}
                          inputPlaceHolder="Enter destination email"
                          inputWidth="180px"
                          saveAction={(val) => {
                            setSprawlDestMap((prev) => ({ ...prev, [rowKey]: val.trim() }));
                            setEditingSprawlId(undefined);
                          }}
                          closeAction={() => setEditingSprawlId(undefined)}
                        />
                      ) : mappedDest ? (
                        <div
                          className="CF_d-flex"
                          style={{ alignItems: "center", cursor: "pointer" }}
                          onClick={() => setEditingSprawlId(rowKey)}
                          title="Click to edit"
                        >
                          <div className="cf_mapping_table_cloudIcon">
                            <img src={cloudImageMapper("GMAIL")} alt="GMAIL" />
                          </div>
                          <span className="cf_mapping_email" style={{ paddingLeft: "10px" }}>{mappedDest}</span>
                        </div>
                      ) : (
                        <div
                          className="cf_not_matched"
                          style={{ cursor: "pointer" }}
                          onClick={() => setEditingSprawlId(u.id ?? `sprawl_${idx}`)}
                          title="Click to map destination"
                        >
                          NOT MATCHED
                        </div>
                      )}
                    </td>
                    <td />
                  </tr>
                );
              })}
              {mappingCacheList?.map((data, index) => {
                return (
                  <tr key={`${index}_${data?.toRootId}`}>
                    <td>
                      {data?.sourceCloudDetails && data?.destCloudDetails ? (
                        <input
                          type="checkbox"
                          id="mappingPairsInput"
                          mappingObj={encodeURIComponent(
                            JSON.stringify({
                              fromCloudId: {
                                id: data?.sourceCloudDetails?.id,
                              },
                              toCloudId: {
                                id: data?.destCloudDetails?.id,
                              },
                              isCSV: isCSVMapping,
                              fromMailId: data?.sourceCloudDetails?.emailId,
                              fromRootId:
                                data?.sourceCloudDetails?.rootFolderId,
                              toMailId: data?.destCloudDetails?.emailId,
                              toRootId: data?.destCloudDetails?.rootFolderId,
                              data: data,
                            })
                          )}
                          onChange={(e) =>
                            selectMappingPairs(e, {
                              fromCloudId: {
                                id: data?.sourceCloudDetails?.id,
                              },
                              toCloudId: {
                                id: data?.destCloudDetails?.id,
                              },
                              isCSV: isCSVMapping,
                              fromMailId: data?.sourceCloudDetails?.emailId,
                              fromRootId:
                                data?.sourceCloudDetails?.rootFolderId,
                              toMailId: data?.destCloudDetails?.emailId,
                              toRootId: data?.destCloudDetails?.rootFolderId,
                              data: data,
                            })
                          }
                        />
                      ) : (
                        <input type="checkbox" disabled />
                      )}
                    </td>
                    <td>
                      {data?.sourceCloudDetails ? (
                        <div className="CF_d-flex">
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
                            style={{ width: "100%", paddingLeft: "10px" }}
                          >
                            <span
                              className="cf_mapping_email"
                              title={data?.sourceCloudDetails?.emailId}
                            >
                              {data?.sourceCloudDetails?.emailId}
                            </span>
                            {data?.destCloudDetails?.folderPath !==
                              "undefined" &&
                              data?.sourceCloudDetails?.folderPath !==
                              "undefined" &&
                              (data?.destCloudDetails?.folderPath !== "/" ||
                                data?.sourceCloudDetails?.folderPath !== "/" ||
                                data?.csvId) ? (
                              <span className="cf_mapping_email">
                                {data?.sourceCloudDetails?.folderPath}
                              </span>
                            ) : (
                              ""
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="cf_not_matched">NOT MATCHED</div>
                      )}
                    </td>
                    <td>
                      {data?.destCloudDetails ? (
                        <div className="CF_d-flex">
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
                            style={{ width: "100%", paddingLeft: "10px" }}
                          >
                            <span
                              className="cf_mapping_email"
                              title={data?.destCloudDetails?.emailId}
                            >
                              {data?.destCloudDetails?.emailId}
                            </span>
                            {data?.destCloudDetails?.folderPath !==
                              "undefined" &&
                              data?.sourceCloudDetails?.folderPath !==
                              "undefined" &&
                              (data?.destCloudDetails?.folderPath !== "/" ||
                                data?.sourceCloudDetails?.folderPath !== "/" ||
                                data?.csvId) ? (
                              <span className="cf_mapping_email">
                                {data?.destCloudDetails?.folderPath}
                              </span>
                            ) : (
                              ""
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="cf_not_matched">NOT MATCHED</div>
                      )}
                    </td>
                    <td>
                      <FaRegTimesCircle />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="cf_content_premissionMapping_footer">
          <div>
            Mappings : {(mappingCacheList[0]?.noOfMappedCloudPressent ?? 0) + sprawlUsers.length}
          </div>
          {mappingCacheList?.length > 0 ? (
            <>
              <div>Matched : {mappingCacheList[0]?.matched ?? 0}</div>
              <div>Unmatched : {mappingCacheList[0]?.notMatched ?? 0}</div>
            </>
          ) : (
            ""
          )}
          <span style={{ marginLeft: "auto" }}></span>
          <div>
            <ButtonComponent
              isLoading={false}
              inputWidth="100px"
              customstyles={{ height: "35px" }}
              buttonName="Download"
              buttonClickAction={() => downloadMappings()}
            />
          </div>
        </div>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default MappingPairs;
