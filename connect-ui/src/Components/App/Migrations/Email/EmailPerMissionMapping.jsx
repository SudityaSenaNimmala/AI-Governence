import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BiFilterAlt } from "react-icons/bi";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { cloudImageMapper } from "../../../helpers/helpers";
import { downloadGlobalCSV, notifyToast } from "../../../helpers/utils";
import CustomDropDown from "../../../Resuables/CustomDropDown/CustomDropDown";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import {
  downloadPermissionMappingCSV,
  getDomainsSearchList,
  getPermissionMapping,
  getPermissionMappingStatus,
  getSearchUserByDomain,
  searchPermissions,
  updatePermissions,
  uploadPerMissionsCsvFile,
} from "./ContentActions/ContentActions";

const EmailPerMissionMapping = (props) => {
  const location = useLocation();
  const preSelectedUsers = location.state?.preSelectedUsers ?? [];

  const dummyPermissions = useMemo(() =>
    preSelectedUsers.map((u) => ({
      sourceCloudDetails: { emailId: u.email, id: u.id },
      destCloudDetails: { emailId: u.email },
      noOfMappedCloudPressent: preSelectedUsers.length,
      matched: preSelectedUsers.length,
      notMatched: 0,
    })),
    [preSelectedUsers]
  );

  const editInputFocusRef = useRef([]);
  const inputFocusRef = useRef();
  const fileUploadRef = useRef(null);
  const [pagination, setPagination] = useState({ pageNo: 1, hasNext: false });
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [selectedEdit, setSelectedEdit] = useState([]);
  const [sourcreEditCloudId, setSourcreEditCloudId] = useState("");
  const [userSuggestionsList, setUserSuggestionsList] = useState([]);
  const [isPageLoding, setIsPageLoading] = useState(false);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [permissionList, setPermissionList] = useState([]);

  const displayList = permissionList.length > 0 ? permissionList : dummyPermissions;
  const [matchedFilters, setMatchedFilters] = useState({
    sortBy: "",
    matchBy: { key: "", value: "All" },
  });
  // useEffect(() => {
  //   if (props?.atPosition === 2) {
  //     setPagination({ pageNo: 1, hasNext: false });
  //     checkPerMissionMappingStatus();
  //   }
  // }, [props?.atPosition]);
  const checkPerMissionMappingStatus = async () => {
    let res = await getPermissionMappingStatus();
    if (res?.status === "OK") {
      if (res?.res?.processStatus === "PROCESSED") {
        getPerMissionMappingList();
      } else {
        setIsPageLoading(true);
        setTimeout(() => {
          checkPerMissionMappingStatus();
        }, 5000);
      }
    }
    // getPerMissionMappingList();
  };

  const getPerMissionMappingList = async (pageNo = pagination?.pageNo) => {
    setIsPageLoading(true);
    let list = await getPermissionMapping(
      pageNo,
      50,
      matchedFilters?.sortBy,
      matchedFilters?.matchBy?.key
    );
    if (list?.status === "OK") {
      if (pageNo === 1) {
        setPermissionList([...(list?.res ?? [])]);
      } else {
        setPermissionList([...permissionList, ...(list?.res ?? [])]);
      }
      setPagination({
        pageNo: pageNo + 1,
        hasNext: list?.res?.length === 50,
      });
      setIsPageLoading(false);
    } else {
      setIsPageLoading(false);
    }
  };

  let searchDebounce;
  const searchSourceUserList = async (e) => {
    let inputString = e?.searchInput;
    setIsSuggestionsLoading(true);
    if (userSuggestionsList?.includes(e?.searchInput)) {
      setIsSuggestionsLoading(false);
      setIsPageLoading(true);
      let getCloudDetails = await getSearchUserByDomain(
        inputString,
        "DESTINATION",
        1,
        20
      );
      if (getCloudDetails?.status === "OK") {
        let updatePer = await updatePermissions(
          sourcreEditCloudId,
          getCloudDetails?.res[0]?.cloudDetail[0]?.id
        );
        if (updatePer?.status === "OK") {
          setIsSuggestionsLoading(false);
          let editIndex = selectedEdit.split("_")[0];
          let copyPermissionList = [...permissionList];
          copyPermissionList[editIndex].destCloudDetails.emailId = inputString;
          notifyToast("success", "Permission Mapping Updated Successfully");
          setUserSuggestionsList([]);
          setIsPageLoading(false);
          setSelectedEdit("");
        } else {
          setIsSuggestionsLoading(false);
          notifyToast("error", "Failed To Update Permission Mapping...");
          setUserSuggestionsList([]);
          setSelectedEdit("");
          getPerMissionMappingList(1);
          setIsPageLoading(false);
        }
      } else {
        setIsSuggestionsLoading(false);
        setIsPageLoading(false);
      }
      return;
    }
    if (searchDebounce) {
      clearInterval(searchDebounce);
    }

    searchDebounce = setTimeout(async () => {
      if (inputString?.length > 2) {
        setIsSuggestionsLoading(true);
        let res = await getDomainsSearchList(inputString, "DESTINATION", 1, 20);
        if (res?.status === "OK") {
          setIsSuggestionsLoading(false);
          setUserSuggestionsList(res?.res);
        }
      } else if (inputString?.length === 0) {
        setIsSuggestionsLoading(false);
        setIsPageLoading(true);
        getPerMissionMappingList(1);
      }
    }, 500);
  };

  const handleMappingSearch = async (e) => {
    let inputString = e?.searchInput;
    if (searchDebounce) {
      clearInterval(searchDebounce);
    }
    searchDebounce = setTimeout(async () => {
      if (inputString?.length > 2) {
        setIsPageLoading(true);
        let res = await searchPermissions(inputString, "DESTINATION", 1, 20);
        if (res?.status === "OK") {
          if (res?.res?.length > 0) {
            setPermissionList(res?.res);
          } else {
            notifyToast();
          }
          setIsPageLoading(false);
        } else {
          setIsPageLoading(false);
        }
      } else if (inputString?.length === 0) {
        setIsPageLoading(true);
        getPerMissionMappingList(1);
      }
    }, 500);
  };

  const handleClickOutside = (event) => {
    const isClickOutsideInput =
      inputFocusRef.current && !inputFocusRef.current.contains(event.target);

    const isClickOutsideEditInputs = editInputFocusRef.current.some((ref) => {
      return ref && !ref.contains(event.target);
    });

    console.log(event.target);

    if (isClickOutsideInput && isClickOutsideEditInputs) {
    }

    if (
      inputFocusRef?.current &&
      inputFocusRef?.current?.contains(event.target) &&
      editInputFocusRef?.current?.some(
        (ref) => ref && !ref?.contains(event.target)
      )
    ) {
      setSelectedEdit("");
    }
  };

  // useEffect(() => {
  //   if (selectedEdit) {
  //     document.addEventListener("click", handleClickOutside);
  //   } else {
  //     document.removeEventListener("click", handleClickOutside);
  //   }
  //   return () => {
  //     document.removeEventListener("click", handleClickOutside);
  //   };
  // }, [selectedEdit]);

  const selectEditUser = (srcCloudId, editSelObj) => {
    setSourcreEditCloudId(srcCloudId);
    setSelectedEdit(editSelObj);
  };

  // useEffect(() => {
  //   if (props?.atPosition === 2) {
  //     setPermissionList([]);
  //     getPerMissionMappingList(1);
  //   }
  // }, [matchedFilters]);

  const downloadMappings = async () => {
    setIsPageLoading(true);
    let res = await downloadPermissionMappingCSV();
    if (res?.status === "OK") {
      setIsPageLoading(false);
      if (res?.res?.length > 0) {
        downloadGlobalCSV(res?.res, "PERMISSIONS_MAPPING");
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

  const handleCSVUpload = () => {
    fileUploadRef.current.value = "";
    fileUploadRef.current.click();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsPageLoading(true);

    if (file.type !== "text/csv") {
      setIsPageLoading(false);
      notifyToast("warn", "Invalid File Uploaded, Only Accepts CSV Format");
      return;
    }
    let reader = new FileReader();
    reader.onload = async () => {
      let fileUploadResponse = await uploadPerMissionsCsvFile(file);
      if (fileUploadResponse?.status === "OK") {
        setIsPageLoading(false);
        if (fileUploadResponse?.res?.includes("Error processing CSV")) {
          alert("Error processing CSV");
          notifyToast("error", fileUploadResponse?.res);
        } else {
          if (fileUploadResponse?.res?.length > 0) {
            notifyToast("success", "File Uploaded Successfully");
            setPermissionList(fileUploadResponse?.res);
          } else {
            notifyToast("warn", "No Data Found in CSV");
          }
        }
      } else {
        setIsPageLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const handleScrollPagination = (e) => {
    const bottom =
      e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight <= 40;

    if (bottom && !isPageLoding && pagination?.hasNext) {
      console.log("I Am Bottom");
      getPerMissionMappingList(pagination?.pageNo);
    }
  };

  return (
    <>
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
      <div className="cf_content_premissionMapping">
        <div className="cf_content_mapping_title">
          <h4>Mapped Permissions</h4>
          <div>
            {/* <SearchComponent
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              customStyles={{ width: "350px", height: "35px" }}
              customButtonStyles={{
                background: "transparent",
                color: "rgb(255, 255, 255)",
                fontWeight: "bolder",
                height: "35px",
              }}
              inputPlaceHolder={`Search Users`}
              onInputSearch={(e) => handleMappingSearch(e)}
            /> */}
          </div>
          <span
            className="CF_d-flex ai-center CF_Pointer"
            onClick={handleCSVUpload}
          >
            <img src={cloudImageMapper("CSV_UPLOAD")} alt="CSV_UPLOAD" />
          </span>
        </div>
        <div
          className="cf_content_premissionMapping_body"
          onScroll={handleScrollPagination}
        >
          <table className="cf_mapping_table">
            <thead>
              <tr>
                <th style={{ width: "50%" }}>
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
                <th style={{ width: "50%" }}>
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
              </tr>
            </thead>
            <tbody>
              {displayList?.map((data, index) => {
                return (
                  <tr>
                    <td>
                      {data?.sourceCloudDetails ? (
                        <div
                          className="CF_d-flex cf_edit_parent_div"
                          style={{ gap: "5px" }}
                        >
                          <div className="cf_mapping_table_cloudIcon">
                            <img
                              src={cloudImageMapper(globalContext?.sourceCloud?.cloudName ?? preSelectedUsers[0]?.vendorName ?? "OUTLOOK")}
                              alt={globalContext?.sourceCloud?.cloudName ?? "OUTLOOK"}
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
                              {data?.sourceCloudDetails?.emailId}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="cf_not_matched">NOT MATCHED</div>
                      )}
                    </td>
                    <td>
                      {data?.destCloudDetails ? (
                        <div
                          className="CF_d-flex cf_edit_parent_div"
                          style={{ gap: "5px" }}
                        >
                          <div className="cf_mapping_table_cloudIcon">
                            <img
                              src={cloudImageMapper(globalContext?.destinationCloud?.cloudName ?? "GMAIL")}
                              alt={globalContext?.destinationCloud?.cloudName ?? "GMAIL"}
                            />
                          </div>

                          {selectedEdit ===
                            `${index}_DSTN_${data?.destCloudDetails?.emailId}` ? (
                            <div
                              className="CF_d-flex CF_flex-d-column"
                              style={{ width: "100%" }}
                              ref={inputFocusRef}
                            >
                              <SearchComponent
                                hideSearch={true}
                                autoOpen={true}
                                boxShadows={true}
                                autoFocus={true}
                                inputName="searchInput"
                                isSuggestionsLoading={isSuggestionsLoading}
                                suggestionsList={userSuggestionsList}
                                suggestionsStyles={{ top: "29px" }}
                                customStyles={{
                                  width: "240px",
                                  height: "30px",
                                  border: "1px solid #ddd",
                                  padding: "0 5px",
                                }}
                                customButtonStyles={{
                                  background: "transparent",
                                  color: "rgb(255, 255, 255)",
                                  fontWeight: "bolder",
                                  height: "30px",
                                  border: 0,
                                }}
                                defaultVal={data?.destCloudDetails?.emailId}
                                inputPlaceHolder={""}
                                onInputSearch={(e) => searchSourceUserList(e)}
                              />
                            </div>
                          ) : (
                            <div
                              className="CF_d-flex CF_flex-d-column"
                              style={{ width: "100%" }}
                              ref={(el) =>
                                (editInputFocusRef.current[index] = el)
                              }
                            >
                              <div
                                className="cf_mapping_email edit_input_div"
                                title="alex@filefuze.co"
                                data-ref="ed"
                                onClick={() =>
                                  selectEditUser(
                                    data?.sourceCloudDetails?.id,
                                    `${index}_DSTN_${data?.destCloudDetails?.emailId}`
                                  )
                                }
                              >
                                {data?.destCloudDetails?.emailId}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="cf_not_matched">NOT MATCHED</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className="CF_MAPPING_TABLE_FOOTER CF_d-flex ai-center gap-30"
          style={{
            height: "50px",
            borderTop: "1px solid #ddd",
            padding: "0 10px",
          }}
        >
          <span>
            Mappings:{" "}
            {displayList.length > 0 ? displayList[0]?.noOfMappedCloudPressent ?? displayList.length : 0}
          </span>
          <span>
            Matched :{" "}
            {displayList.length > 0 ? displayList[0]?.matched ?? displayList.length : 0}
          </span>
          <span>
            Unmatched :
            {displayList.length > 0 ? displayList[0]?.notMatched ?? 0 : 0}
          </span>
          <span style={{ marginLeft: "auto" }}></span>
          <ButtonComponent
            isLoading={false}
            inputWidth="100px"
            customstyles={{ height: "35px" }}
            buttonName="Download"
            buttonClickAction={() => downloadMappings()}
          />
        </div>
      </div>
      {isPageLoding ? getCFLoader() : ""}
    </>
  );
};

export default EmailPerMissionMapping;
