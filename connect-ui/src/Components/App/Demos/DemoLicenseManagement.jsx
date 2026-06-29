import {
  ArrowDown01,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUp10,
  ArrowUpAZ,
  ArrowUpZA,
  Pencil,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import {
  formatDateForRenewal,
  getUserId,
  makeDataForCalender,
  newImplementation,
  notifyToast,
} from "../../helpers/utils";
import ActionButton from "../../Resuables/InputsComponents/ActionButton";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import { getCFLoader, getCFTextLoader } from "../../Resuables/Loaders/Loaders";
import Popup from "../../Resuables/Popup/Popup";
import {
  checkLicenseStatus,
  getLicensesList,
  saveAndUpdateLicense,
} from "../SaaSManagement/SaaSActions/SaaSActions";
import {
  SET_BILLING_SUMMARY,
  SET_SAAS_CLOUD,
  SET_UPDATE_JOB_PARAMS,
} from "../../../GlobalContext/action.types";
import { getSaaSCostingWithAppList } from "../Dashboard/DashboardActions/DashboardActions";
import SaaSLicenceUserList from "./SaaSLicenceUserList";
import { InVoiceFileUploadNew } from "../UserManagement/OnBoard/InVoiceFileUpload copy";
import {
  getMicrosoftLicenseFeatures,
  isMicrosoftLicenseProvider,
} from "./microsoftLicenseFeatures";
import "./microsoftLicenseFeaturesPopup.css";

const DemoLicenseManagement = ({
  selectedOrgData = { organization: "ALL" },
  isLicenseSync,
  setIsLicenseSync,
  checkSync,
}) => {
  const navigate = useNavigate();
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { globalContext, dispatch } = useContext(GlobalContext);
  const [licensesList, setLicensesList] = useState([]);
  const [selectedLicense, setSelectedLicense] = useState(null);
  const [licenseFeaturesPopup, setLicenseFeaturesPopup] = useState(null);
  const [isUsersSyncing, setIsUsersSyncing] = useState(false);
  const { adminEmail, memberId, providerName, domainName, id, phoneNumber, externalProviderName } = {
    ...globalContext?.saasCloud,
  };
  const [isVisible, setIsVisible] = useState(false);
  const [newLicense, setNewLicense] = useState({});
  const [isEditExistingLicense, setIsEditExistingLicense] = useState(false);
  const [errorData, setErrorData] = useState({});
  const [isUploadInvoice, setIsUploadInvoice] = useState(false);
  const onlyUsedRequired = ["HUBSPOT", "CONFLUENCE", "ATLASSIAN", "JIRA"];

  const [sort, setSort] = useState({
    reccuring: "all",
    costPerUser: "all",
    purchasedPrice: "all",
    potentialSavings: "all",
    assignedLicenceCount: "all",
  });

  useEffect(() => {
    setLicensesList([]);
    setIsLoading(true);
    if (
      newImplementation.includes(providerName) ||
      providerName === "ONE_PASSWORD" ||
      providerName === "ADOBE_IDENTITY" ||
      providerName === "FIGMA"
    ) {
      licenseStatus();
    } else {
      setIsLicenseSync(true);
      getLicenses();
    }
  }, [memberId]);

  const licenseStatus = async () => {
    setIsLoading(false);
    setIsPageLoading(true);
    let res = await checkLicenseStatus(id);
    if (res?.status === "OK" && res?.res) {
      setIsPageLoading(false);
      setIsLicenseSync(res?.res?.syncSubScription);
      if (res?.res?.syncSubScription) {
        getLicenses();
      }
    } else {
      setIsLicenseSync(true);
      setIsLicenseSync(true);
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    if (providerName === "OTHERS") {
      setIsLicenseSync(true);
      getLicenses("SYNC");
      return;
    }
    if (
      (checkSync && newImplementation.includes(providerName)) ||
      providerName === "ONE_PASSWORD" ||
      providerName === "ADOBE_IDENTITY" ||
      providerName === "FIGMA"
    ) {
      licenseStatus();
    }
  }, [checkSync]);

  const getLicenses = async (type) => {
    if (type === "SYNC") {
      setIsPageLoading(true);
    } else {
      setIsLoading(true);
    }
    let res = await getLicensesList(memberId || adminEmail, providerName, id);
    if (res?.status === "OK" && res?.res) {
      if (providerName === "GITHUB__" || providerName === "MICROSOFT_TEAMS") {
        let list = [];
        res?.res?.map((data) => {
          list.push({
            ...data,
            seatsAvailable: data?.seatsAvailable,
            costPerUser:
              data?.costPerUser === "Infinity" || data?.costPerUser === "NaN"
                ? "0"
                : data?.costPerUser === 0
                  ? isNaN(data?.purchasedPrise / data?.totalLicenceCount)
                    ? 0
                    : (data?.purchasedPrise / data?.totalLicenceCount)?.toFixed(2)
                  : data?.costPerUser && !isNaN(data?.costPerUser)
                    ? data?.costPerUser
                    : 0,
            potentialSavings:
              data?.savingCost && !isNaN(data?.savingCost)
                ? data?.savingCost?.toFixed(2)
                : data?.availableCount > 0 && isNaN(data?.availableCount)
                  ? "0.00"
                  : getCostPerUser(data) > 0
                    ? (getCostPerUser(data) * data?.availableCount)?.toFixed(2)
                    : "0.00",
          });
        });
        setIsPageLoading(false);
        setLicensesList(list);
        setIsLoading(false);
      } else {
        let list = [];
        res?.res?.map((data) => {
          list.push({
            ...data,
            costPerUser:
              data?.costPerUser === "Infinity" || data?.costPerUser === "NaN"
                ? "0"
                : data?.costPerUser === 0 || isNaN(data?.costPerUser)
                  ? isNaN(data?.purchasedPrise / data?.totalLicenceCount)
                    ? 0
                    : data?.purchasedPrise / data?.totalLicenceCount
                  : data?.costPerUser && !isNaN(data?.costPerUser)
                    ? data?.costPerUser
                    : 0,
            potentialSavings:
              data?.savingCost && !isNaN(data?.savingCost)
                ? data?.savingCost?.toFixed(2)
                : data?.availableCount > 0 && isNaN(data?.availableCount)
                  ? "0.00"
                  : getCostPerUser(data) > 0
                    ? (getCostPerUser(data) * data?.availableCount)?.toFixed(2)
                    : "0.00",
          });
        });
        setIsUsersSyncing(
          res?.res?.filter((ndata) => ndata?.processStatus !== "PROCESSED" && !ndata?.manualEntry)
            ?.length > 0
        );
        setIsPageLoading(false);
        setLicensesList(list);
        setIsLoading(false);
      }
    } else {
      setIsPageLoading(false);
      setIsLoading(false);
    }
  };

  const handleEditLicense = async (name, value) => {
    setNewLicense({ ...newLicense, [name]: value });
  };

  const getExpiredDateFromPurchase = (purchasedDateVal, isYearly) => {
    if (!purchasedDateVal) return null;
    const d = new Date(purchasedDateVal);
    if (isYearly) d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  };

  const updateCostInfo = async () => {
    let copyLicense = { ...newLicense };
    let errorObj = {};
    copyLicense.vendor = providerName;
    if (!copyLicense?.yearlySubscription) {
      copyLicense.yearlySubscription = false;
    }
    if (!copyLicense?.totalLicenceCount) {
      errorObj.totalLicenceCount = "Total Licence Count is required";
    }
    if (!copyLicense?.purchasedPrise) {
      errorObj.purchasedPrise = "Purchased Price is required";
    }
    if (
      copyLicense?.purchasedDate === null ||
      copyLicense?.purchasedDate === ""
    ) {
      copyLicense.purchasedDate = "";
    }
    if (copyLicense?.expiredDate === null || copyLicense?.expiredDate === "") {
      errorObj.expiredDate = "Expired Date is required";
    }

    if (!isEditExistingLicense) {
      if (!copyLicense?.planName) {
        errorObj.planName = "Plan Name is required";
      }
      if (!copyLicense?.assignedLicenceCount) {
        errorObj.assignedLicenceCount = "Assigned Licence Count is required";
      }
    }

    if (copyLicense?.assignedLicenceCount > copyLicense?.totalLicenceCount) {
      errorObj.assignedLicenceCount =
        "Assigned Licence Count cannot be greater than Total Licence Count";
    }

    setErrorData(errorObj);

    if (Object.keys(errorObj).length > 0) {
      return;
    }

    setIsPageLoading(true);
    setIsVisible(false);
    let newLicenseData = { ...copyLicense };
    if (
      newImplementation.includes(providerName) ||
      providerName === "ONE_PASSWORD" ||
      providerName === "ADOBE_IDENTITY" ||
      providerName === "FIGMA"
    ) {
      newLicenseData.purchasedDate =
        newLicenseData?.purchasedDate?.split("T")[0];
      newLicenseData.expiredDate = newLicenseData?.expiredDate
        ? newLicenseData?.expiredDate?.split("T")[0]
        : "";
    }
    let res = await saveAndUpdateLicense([{ ...newLicenseData }], providerName);
    if (res?.status === "OK" && res?.res) {
      getLicenses();
      dispatch({
        type: SET_UPDATE_JOB_PARAMS,
        payload: "RERUN_NOTIFICATIONS",
      });
      notifyToast(
        "success",
        licensesList?.filter((data) => data?.planId === newLicense?.planId)
          ?.length > 0
          ? "License updated successfully"
          : "License added successfully"
      );

      if (newLicense?.expiryDate) {
        let licMapper =
          globalContext?.saasCloud?.billingInfo?.expiryDateMap ?? {};
        licMapper[newLicense?.planName] = formatDateForRenewal(
          newLicense?.expiryDate
        );
        let billInfo = {
          ...globalContext?.saasCloud?.billingInfo,
          expiryDateMap: licMapper,
        };
        dispatch({
          type: SET_SAAS_CLOUD,
          payload: { ...globalContext?.saasCloud, billingInfo: billInfo },
        });
      }
      fetchSaaSCosting();
      setIsPageLoading(false);
    } else {
      notifyToast(
        "error",
        licensesList?.filter((data) => data?.planId === newLicense?.planId)
          ?.length > 0
          ? "Failed to update license"
          : "Failed to add license"
      );
      setIsPageLoading(false);
    }
  };

  const fetchSaaSCosting = async () => {
    let res = await getSaaSCostingWithAppList();
    if (res?.status === "OK" && res?.res) {
      if (res?.res?.userFinancialMetrics[0]?.vendorName) {
        let currentVendor = res?.res?.userFinancialMetrics?.filter((data) => {
          return (
            data?.memberId === memberId && data?.vendorName === providerName
          );
        });
        if (currentVendor?.length > 0) {
          dispatch({
            type: SET_SAAS_CLOUD,
            payload: {
              ...globalContext?.saasCloud,
              billingInfo: currentVendor?.length > 0 ? currentVendor[0] : null,
            },
          });
        }
        let calData = makeDataForCalender(res?.res?.userFinancialMetrics);
        dispatch({
          type: SET_BILLING_SUMMARY,
          payload: { ...res?.res, calenderData: calData },
        });
      }
    }
  };

  const startEdit = (data) => {
    setIsVisible(true);
    setErrorData({});
    if (
      newImplementation.includes(providerName) ||
      providerName === "ONE_PASSWORD" ||
      providerName === "ADOBE_IDENTITY" ||
      providerName === "FIGMA"
    ) {
      setNewLicense({
        id: data?.id,
        adminCloudId: data?.adminCloudId,
        productId: data?.productId,
        planId: data?.planId,
        planName: data?.planName,
        totalLicenceCount: data?.totalLicenceCount,
        purchasedPrise: data?.purchasedPrise,
        expiredDate: data?.expiredDate,
        purchasedDate: data?.purchasedDate,
        yearlySubscription: data?.yearlySubscription,
        // isPaid: true,
      });
    } else {
      setNewLicense(data);
    }
  };

  const getCostPerUser = (data) => {
    if (data?.costPerUser === "Infinity" || data?.costPerUser === "NaN") return 0;
    return data?.costPerUser && !isNaN(data?.costPerUser)
      ? data?.costPerUser
      : isNaN(data?.purchasedPrise / data?.totalLicenceCount)
        ? "0"
        : data?.purchasedPrise / data?.totalLicenceCount;
  };

  const handleSort = (type) => {
    let sortVal = sort[type];
    if (sortVal === "all") {
      sortVal = "asc";
    } else if (sortVal === "asc") {
      sortVal = "desc";
    } else if (sortVal === "desc") {
      sortVal = "all";
    }
    setSort({ ...sort, [type]: sortVal });
  };

  return (
    <>
      <div
        className="cf_main_content_place_main CF_d-flex"
        style={{
          padding: "10px 0 0 0",
          flexDirection: "column",
          height: "fit-content",
          border: "1px solid #ddd",
          paddingTop: "0px",
        }}
      >
        <div
          className="cf_licenses_container_table_header"
          style={{ gap: "20px" }}
        >
          <span>Total Licenses: {licensesList?.length}</span>
          <span style={{ marginLeft: "auto" }}></span>
          <div className="CF_d-flex ai-center" style={{ gap: "5px" }}>
            {sort?.assignedLicenceCount !== "all" && (
              <div
                className="CF_d-flex ai-center cf_sort_filter_box"
                style={{ gap: "5px" }}
              >
                <p>
                  Assigned Licenses:{" "}
                  <span>{sort?.assignedLicenceCount?.toUpperCase()}</span>
                </p>
                <X
                  size={16}
                  color="#acacac"
                  strokeWidth={2.5}
                  onClick={() =>
                    setSort({ ...sort, assignedLicenceCount: "all" })
                  }
                />
              </div>
            )}
            {sort?.costPerUser !== "all" && (
              <div
                className="CF_d-flex ai-center cf_sort_filter_box"
                style={{ gap: "5px" }}
              >
                <p>
                  Cost Per User: <span>{sort?.costPerUser?.toUpperCase()}</span>
                </p>
                <X
                  size={16}
                  color="#acacac"
                  strokeWidth={2.5}
                  onClick={() => setSort({ ...sort, costPerUser: "all" })}
                />
              </div>
            )}

            {sort?.purchasedPrice !== "all" && (
              <div
                className="CF_d-flex ai-center cf_sort_filter_box"
                style={{ gap: "5px" }}
              >
                <p>
                  Purchased Price:{" "}
                  <span>{sort?.purchasedPrice?.toUpperCase()}</span>
                </p>
                <X
                  size={16}
                  color="#acacac"
                  strokeWidth={2.5}
                  onClick={() => setSort({ ...sort, purchasedPrice: "all" })}
                />
              </div>
            )}

            {sort?.potentialSavings !== "all" && (
              <div
                className="CF_d-flex ai-center cf_sort_filter_box"
                style={{ gap: "5px" }}
              >
                <p>
                  Potential Savings:{" "}
                  <span>{sort?.potentialSavings?.toUpperCase()}</span>
                </p>
                <X
                  size={16}
                  color="#acacac"
                  strokeWidth={2.5}
                  onClick={() => setSort({ ...sort, potentialSavings: "all" })}
                />
              </div>
            )}

            {sort?.reccuring !== "all" && (
              <div
                className="CF_d-flex ai-center cf_sort_filter_box"
                style={{ gap: "5px" }}
              >
                <p>
                  Recurring: <span>{sort?.reccuring?.toUpperCase()}</span>
                </p>
                <X
                  size={16}
                  color="#acacac"
                  strokeWidth={2.5}
                  onClick={() => setSort({ ...sort, reccuring: "all" })}
                />
              </div>
            )}
          </div>

          {isUsersSyncing &&
            providerName !== "OTHERS" &&
            providerName !== "CURSOR_AI" ? (
            <div
              className="CF_d-flex ai-center"
              style={{ gap: "8px", paddingRight: "40px" }}
            >
              <p
                style={{
                  fontSize: "12px",
                  fontWeight: "500",
                  color: "#0062ff",
                }}
              >
                License users are being synced...
              </p>
              <div
                className="cf_dashboard_analytics_edit CF_Pointer"
                style={{ marginLeft: "auto", visibility: "visible" }}
                onClick={() => getLicenses("SYNC")}
                title="Check Status"
              >
                <RotateCw
                  size={12}
                  className="CF_Pointer"
                  title="Check Status"
                />
              </div>
            </div>
          ) : (
            ""
          )}
          {/* 
          {console.log(sort)}
 */}
          {!isPageLoading && !isLoading && (
            <>
              <ActionButton
                customClass={`changeButtonColorOnHover`}
                customStyles={{
                  backgroundColor: "#f2f2f2",
                  height: "35px",
                }}
                buttonType="button"
                buttonClickAction={() => {
                  setIsVisible(true);
                  setErrorData({});
                  if (
                    newImplementation.includes(providerName) ||
                    providerName === "ONE_PASSWORD" ||
                    providerName === "ADOBE_IDENTITY" ||
                    providerName === "FIGMA" ||
                    providerName === "OTHERS"
                  ) {
                    setNewLicense({
                      id: null,
                      adminCloudId: id,
                      productId: "",
                      planId: "",
                      totalLicenceCount: 0,
                      purchasedPrise: 0,
                      expiredDate: null,
                      purchasedDate: null,
                    });
                  } else {
                    setNewLicense({
                      id: null,
                      planName: "",
                      purchasedDate: "",
                      expiryDate: "",
                      createdTime: "",
                      planId: "",
                      userId: getUserId(),
                      adminMemberId: memberId,
                      vendor: providerName,
                      deleted: false,
                      subscriberEmail: adminEmail,
                      purchasedAmount: "",
                      domain: domainName,
                      seatsAvailable: "",
                      seatsUsed: "",
                      totalSeat: "",
                      totalAmount: "",
                      workspace: null,
                    });
                  }
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <p style={{ fontSize: "12px", fontWeight: "500" }}>
                    Add License
                  </p>
                </div>
              </ActionButton>
              <ActionButton
                customClass={`changeButtonColorOnHover cf_button_gradient`}
                buttonType="button"
                customStyles={{
                  backgroundColor: "#f2f2f2",
                }}
                buttonClickAction={() => setIsUploadInvoice(true)}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "5px" }}
                >
                  <Sparkles size={16} />
                  <span style={{ fontSize: "12px" }}>
                    AI-powered Invoice Parser
                  </span>
                </div>
              </ActionButton>
            </>
          )}
        </div>
        <div className="cf_new_tables_div" style={{ borderRadius: "0" }}>
          <table className="cf_licenses_table">
            <thead>
              <tr style={{ borderRadius: "0" }}>
                <th style={{ width: "25%", borderRadius: "0" }}>Name</th>
                {providerName === "GITHUB" ? <>
                  <th style={{ width: "15%" }}>Total Usage </th>
                  <th style={{ width: "15%" }}>Billable Usage </th>
                </> : onlyUsedRequired.includes(providerName) ? (
                  <>
                    <th style={{ width: "25%" }}>Used Licenses </th>
                  </>
                ) : (
                  <>
                    {!newImplementation.includes(providerName) ||
                      providerName === "ONE_PASSWORD" ||
                      providerName === "ADOBE_IDENTITY" ||
                      providerName === "OTHERS" ||
                      (providerName === "FIGMA" && (
                        <th style={{ width: "10%" }}>Available Licenses</th>
                      ))}
                    <th style={{ width: "20%" }}>
                      {" "}
                      <div
                        className="CF_d-flex ai-center CF_Pointer cf_selectNone"
                        style={{ gap: "5px" }}
                        onClick={() => handleSort("assignedLicenceCount")}
                      >
                        <p>
                          {providerName === "MAILTRAP"
                            ? "Usage"
                            : `Assigned Licenses`}
                        </p>
                        {sort.assignedLicenceCount === "asc" ? (
                          <ArrowDown01
                            size={14}
                            color="#acacac"
                            strokeWidth={2.5}
                          />
                        ) : sort.assignedLicenceCount === "desc" ? (
                          <ArrowUp10
                            size={14}
                            color="#acacac"
                            strokeWidth={2.5}
                          />
                        ) : (
                          <ArrowDownUp
                            size={14}
                            color="#acacac"
                            strokeWidth={2.5}
                          />
                        )}
                      </div>{" "}
                    </th>
                  </>
                )}
                {providerName !== "MAILTRAP" &&
                  (newImplementation.includes(providerName) ||
                    providerName === "ONE_PASSWORD" ||
                    providerName === "ADOBE_IDENTITY" ||
                    providerName === "FIGMA" ||
                    providerName === "OTHERS") ? (
                  <th style={{ width: "10%" }}>
                    <div
                      className="CF_d-flex ai-center CF_Pointer cf_selectNone"
                      style={{ gap: "5px" }}
                      onClick={() => handleSort("costPerUser")}
                    >
                      <p>Cost Per User</p>
                      {sort.costPerUser === "asc" ? (
                        <ArrowDown01
                          size={14}
                          color="#acacac"
                          strokeWidth={2.5}
                        />
                      ) : sort.costPerUser === "desc" ? (
                        <ArrowUp10 size={14} color="#acacac" strokeWidth={2.5} />
                      ) : (
                        <ArrowDownUp
                          size={14}
                          color="#acacac"
                          strokeWidth={2.5}
                        />
                      )}
                    </div>
                  </th>
                ) : (
                  ""
                )}
                <th style={{ width: "10%" }}>
                  <div
                    className="CF_d-flex ai-center CF_Pointer cf_selectNone"
                    style={{ gap: "5px" }}
                    onClick={() => handleSort("purchasedPrice")}
                  >
                    <p>
                      {newImplementation.includes(providerName) ||
                        providerName === "ONE_PASSWORD" ||
                        providerName === "ADOBE_IDENTITY" ||
                        providerName === "FIGMA" ||
                        providerName === "OTHERS"
                        ? "Purchased Price"
                        : "Cost"}
                    </p>
                    {sort.purchasedPrice === "asc" ? (
                      <ArrowDown01 size={14} color="#acacac" strokeWidth={2.5} />
                    ) : sort.purchasedPrice === "desc" ? (
                      <ArrowUp10 size={14} color="#acacac" strokeWidth={2.5} />
                    ) : (
                      <ArrowDownUp size={14} color="#acacac" strokeWidth={2.5} />
                    )}
                  </div>
                </th>
                {providerName !== "MAILTRAP" &&
                  (newImplementation.includes(providerName) ||
                    providerName === "ONE_PASSWORD" ||
                    providerName === "ADOBE_IDENTITY" ||
                    providerName === "FIGMA" ||
                    providerName === "OTHERS") ? (
                  <th style={{ width: "10%" }}>
                    {" "}
                    <div
                      className="CF_d-flex ai-center CF_Pointer cf_selectNone"
                      style={{ gap: "5px" }}
                      onClick={() => handleSort("potentialSavings")}
                    >
                      <p>Potential Savings</p>
                      {sort.potentialSavings === "asc" ? (
                        <ArrowDown01
                          size={14}
                          color="#acacac"
                          strokeWidth={2.5}
                        />
                      ) : sort.potentialSavings === "desc" ? (
                        <ArrowUp10 size={14} color="#acacac" strokeWidth={2.5} />
                      ) : (
                        <ArrowDownUp
                          size={14}
                          color="#acacac"
                          strokeWidth={2.5}
                        />
                      )}
                    </div>
                  </th>
                ) : (
                  ""
                )}
                {/* {providerName !== "GOOGLE_WORKSPACE" ? ( */}
                <th style={{ width: "10%" }}>
                  <div
                    className="CF_d-flex ai-center CF_Pointer cf_selectNone"
                    style={{ gap: "5px" }}
                    onClick={() => handleSort("reccuring")}
                  >
                    <p>Recurring</p>
                    {sort.reccuring === "asc" ? (
                      <ArrowDownAZ size={14} color="#acacac" strokeWidth={2.5} />
                    ) : sort.reccuring === "desc" ? (
                      <ArrowUpZA size={14} color="#acacac" strokeWidth={2.5} />
                    ) : (
                      <ArrowDownUp size={14} color="#acacac" strokeWidth={2.5} />
                    )}
                  </div>
                </th>

                {!newImplementation.includes(providerName) ||
                  providerName === "ONE_PASSWORD" ||
                  providerName === "ADOBE_IDENTITY" ||
                  providerName === "FIGMA" ||
                  providerName === "OTHERS" ? (
                  <th style={{ width: "10%" }}>Status</th>
                ) : (
                  ""
                )}
                <th style={{ width: "25%", borderRadius: "0" }}></th>
                {/* <th></th> */}
              </tr>
            </thead>
            <tbody>
              {(function () {
                const filtered = (licensesList || []).filter((data) => {
                  if (providerName === "TERRAFORM") {
                    if (
                      selectedOrgData?.organization === "ALL" ||
                      !selectedOrgData?.organization ||
                      !selectedOrgData
                    ) {
                      return data;
                    } else {
                      return data?.organization === selectedOrgData?.organization;
                    }
                  } else {
                    return data;
                  }
                });
                const sorted = [...filtered].sort((a, b) => {
                  if (sort.assignedLicenceCount === "asc") {
                    return (a?.assignedLicenceCount ?? 0) - (b?.assignedLicenceCount ?? 0);
                  } else if (sort.assignedLicenceCount === "desc") {
                    return (b?.assignedLicenceCount ?? 0) - (a?.assignedLicenceCount ?? 0);
                  }
                  if (sort.costPerUser === "asc") {
                    return (Number(a?.costPerUser) || 0) - (Number(b?.costPerUser) || 0);
                  } else if (sort.costPerUser === "desc") {
                    return (Number(b?.costPerUser) || 0) - (Number(a?.costPerUser) || 0);
                  }
                  if (sort.purchasedPrice === "asc") {
                    return (a?.purchasedPrise ?? 0) - (b?.purchasedPrise ?? 0);
                  } else if (sort.purchasedPrice === "desc") {
                    return (b?.purchasedPrise ?? 0) - (a?.purchasedPrise ?? 0);
                  }
                  if (sort.potentialSavings === "asc") {
                    return (a?.potentialSavings ?? 0) - (b?.potentialSavings ?? 0);
                  } else if (sort.potentialSavings === "desc") {
                    return (b?.potentialSavings ?? 0) - (a?.potentialSavings ?? 0);
                  }
                  if (sort.reccuring === "asc") {
                    return (a?.yearlySubscription ? 1 : 0) - (b?.yearlySubscription ? 1 : 0);
                  } else if (sort.reccuring === "desc") {
                    return (b?.yearlySubscription ? 1 : 0) - (a?.yearlySubscription ? 1 : 0);
                  }
                  return 0;
                });
                return sorted;
              })()
                ?.map((data, index) => {
                  return newImplementation.includes(providerName) ||
                    providerName === "ONE_PASSWORD" ||
                    providerName === "ADOBE_IDENTITY" ||
                    providerName === "FIGMA" ||
                    providerName === "OTHERS" ? (
                    <tr key={data?.planId ? `${data.planId}-${index}` : `row-${index}`}>
                      <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          <div className="cf_license_img_placer">
                            <img
                              src={externalProviderName && phoneNumber ? `https://cloudfuzehost.com/globalasserts/${phoneNumber}` : cloudImageMapper(providerName)}
                              alt={providerName}
                            />
                          </div>
                          <div className="cf_license_title">
                            {isMicrosoftLicenseProvider(providerName) &&
                              getMicrosoftLicenseFeatures(
                                data?.planName,
                                data?.planId,
                                data?.domain
                              ) ? (
                              <p
                                className="cf_license_title cf_make_link"
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    const label =
                                      data?.planName?.replaceAll("_", " ") ||
                                      data?.planId?.replaceAll("_", " ") ||
                                      data?.domain?.replaceAll("_", " ");
                                    setLicenseFeaturesPopup({
                                      title: label,
                                      features: getMicrosoftLicenseFeatures(
                                        data?.planName,
                                        data?.planId,
                                        data?.domain
                                      ),
                                    });
                                  }
                                }}
                                style={{
                                  fontWeight: "500",
                                  whiteSpace: "nowrap",
                                }}
                                onClick={() => {
                                  const label =
                                    data?.planName?.replaceAll("_", " ") ||
                                    data?.planId?.replaceAll("_", " ") ||
                                    data?.domain?.replaceAll("_", " ");
                                  setLicenseFeaturesPopup({
                                    title: label,
                                    features: getMicrosoftLicenseFeatures(
                                      data?.planName,
                                      data?.planId,
                                      data?.domain
                                    ),
                                  });
                                }}
                              >
                                {data?.planName?.replaceAll("_", " ") ||
                                  data?.planId?.replaceAll("_", " ") ||
                                  data?.domain?.replaceAll("_", " ")}
                              </p>
                            ) : (
                              <p
                                style={{
                                  fontWeight: "500",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {data?.planName?.replaceAll("_", " ") ||
                                  data?.planId?.replaceAll("_", " ") ||
                                  data?.domain?.replaceAll("_", " ")}
                              </p>
                            )}
                            {providerName === "OTHERS" ? (
                              ""
                            ) : (
                              <span style={{ fontSize: "10px" }}>
                                {data?.domain || data?.organization}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* <td className="cf_license_title">
                    {data?.totalLicenceCount}
                  </td> */}
                      {providerName === "GITHUB" ? <>
                        <td>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            {(data?.exactLicenceCount)?.toFixed(2)} <span style={{ fontSize: "10px", color: "#000", marginTop: "5px" }}>{data?.billingUnits}</span>
                          </div>
                        </td>
                        <td>
                          <div
                            className="CF_d-flex ai-center"
                            style={{ gap: "5px" }}
                          >
                            {(data?.totalLicenceCount)?.toFixed(2)} <span style={{ fontSize: "10px", color: "#000", marginTop: "5px" }}>{data?.billingUnits}</span>
                          </div>
                        </td>
                      </> : <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          {(data?.assignedLicenceCount || data?.assignedLicenceCount === 0) &&
                            data?.totalLicenceCount &&
                            providerName !== "OTHERS" ? (
                            <div className="cf_license_indicator">
                              <div
                                className="cf_license_indicator_filler"
                                style={{
                                  width: `${(data?.assignedLicenceCount /
                                    data?.totalLicenceCount) *
                                    100
                                    }%`,
                                }}
                              ></div>
                              <div
                                className="cf_license_indicator_background"
                                per={
                                  data?.assignedLicenceCount /
                                  data?.totalLicenceCount
                                }
                                style={{
                                  width: `${100 -
                                    (data?.assignedLicenceCount /
                                      data?.totalLicenceCount) *
                                    100
                                    }%`,
                                }}
                              ></div>
                            </div>
                          ) : (
                            ""
                          )}
                          {providerName === "OTHERS" ? (
                            <div
                              className="cf_license_title"
                              style={{
                                fontSize: "12px",
                              }}
                            >
                              {data?.totalLicenceCount
                                ? `${data?.totalLicenceCount}`
                                : data?.assignedLicenceCount}
                            </div>
                          ) : newImplementation.includes(providerName) ||
                            providerName === "ONE_PASSWORD" ||
                            providerName === "ADOBE_IDENTITY" ||
                            providerName === "FIGMA" ||
                            providerName === "OTHERS" ? (
                            data?.manualEntry ? (
                              <div
                                className="cf_license_title"
                                style={{
                                  fontSize: "12px",
                                }}
                              >
                                {data?.totalLicenceCount
                                  ? data?.assignedLicenceCount
                                    ? `${data?.assignedLicenceCount}/${data?.totalLicenceCount}`
                                    : data?.totalLicenceCount
                                  : data?.assignedLicenceCount}
                              </div>
                            ) : (
                              <div
                                className={`${providerName !== "MAILTRAP"
                                  ? "cf_license_title cf_make_link"
                                  : "cf_license_title"
                                  }`}
                                onClick={() => {
                                  if (providerName !== "MAILTRAP") {
                                    setSelectedLicense({
                                      planName: data?.planName || data?.planId,
                                      assignCount: data?.assignedLicenceCount,
                                      planId: data?.planId,
                                    });
                                  }
                                }}
                                style={{
                                  fontSize: "12px",
                                }}
                              >
                                {data?.totalLicenceCount
                                  ? `${data?.assignedLicenceCount}/${data?.totalLicenceCount}`
                                  : data?.assignedLicenceCount}
                              </div>
                            )
                          ) : (
                            ""
                          )}
                        </div>
                      </td>}
                      {providerName !== "MAILTRAP" && (
                        <td className="cf_license_title">
                          ${(data?.costPerUser != null && data?.costPerUser !== "" && !isNaN(Number(data?.costPerUser))) ? Number(data.costPerUser).toFixed(2) : "0.00"}
                        </td>
                      )}
                      <td className="cf_license_title">
                        $
                        {data?.purchasedPrise && !isNaN(data?.purchasedPrise)
                          ? data?.purchasedPrise?.toFixed(2)
                          : "0.00"}
                      </td>
                      {providerName !== "MAILTRAP" && (
                        <td className="cf_license_title">
                          $
                          {data?.savingCost && !isNaN(data?.savingCost)
                            ? data?.savingCost?.toFixed(2)
                            : data?.availableCount > 0 &&
                              isNaN(data?.availableCount)
                              ? "0.00"
                              : getCostPerUser(data) > 0
                                ? (
                                  getCostPerUser(data) * data?.availableCount
                                )?.toFixed(2)
                                : "0.00"}
                        </td>
                      )}
                      <td className="cf_license_title">
                        {data?.yearlySubscription ? "Yearly" : "Monthly"}
                      </td>
                      <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          {data?.purchasedDate || data?.expiredDate ? (
                            <div>
                              {data?.purchasedDate ? (
                                <p style={{ whiteSpace: "nowrap" }}>
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Assigned on:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {new Date(data?.purchasedDate)
                                      .toDateString()
                                      ?.split(" ")
                                      ?.splice(1, 4)
                                      ?.join(" ")}
                                  </span>
                                </p>
                              ) : (
                                ""
                              )}
                              {data?.expiredDate ? (
                                <p style={{ whiteSpace: "nowrap" }}>
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Expires on:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {new Date(data?.expiredDate)
                                      .toDateString()
                                      ?.split(" ")
                                      ?.splice(1, 4)
                                      ?.join(" ")}
                                  </span>
                                </p>
                              ) : (
                                ""
                              )}
                            </div>
                          ) : (
                            ""
                          )}
                          <div
                            className="cf_dashboard_analytics_edit CF_Pointer"
                            style={{ marginLeft: "auto" }}
                            onClick={() => {
                              startEdit(data);
                              setIsEditExistingLicense(true);
                            }}
                          >
                            <Pencil size={14} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={data?.planId ? `${data.planId}-${index}` : `row-${index}`}>
                      <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          <div className="cf_license_img_placer">
                            <img
                              src={externalProviderName && phoneNumber ? `https://cloudfuzehost.com/globalasserts/${phoneNumber}` : cloudImageMapper(providerName)}
                              alt={providerName}
                            />
                          </div>
                          <div className="cf_license_title">
                            <p
                              style={{
                                fontWeight: "500",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {data?.planName?.replaceAll("_", " ") ||
                                data?.planId?.replaceAll("_", " ") ||
                                data?.domain?.replaceAll("_", " ")}
                            </p>
                            <span style={{ fontSize: "10px" }}>
                              {data?.workspace}
                            </span>
                          </div>
                        </div>
                      </td>
                      {onlyUsedRequired?.includes(providerName) ? (
                        providerName === "JIRA" ||
                          providerName === "ATLASSIAN" ||
                          providerName === "CONFLUENCE" ? (
                          <td>
                            <div
                              style={{
                                fontSize: "12px",
                                fontWeight: "500",
                              }}
                            >
                              {data?.seatsUsed}
                            </div>
                          </td>
                        ) : (
                          <td>
                            {data?.manualEntry ? (
                              <div className="cf_license_title">
                                {data?.freeSeat ? (
                                  <>
                                    {data?.freeSeat}&nbsp;
                                    <span
                                      style={{
                                        fontSize: "10px",
                                      }}
                                    >
                                      Sales Seats,&nbsp;
                                    </span>
                                  </>
                                ) : (
                                  ""
                                )}
                                {data?.seatsUsed ? (
                                  <>
                                    {data?.seatsUsed}&nbsp;
                                    <span
                                      style={{
                                        fontSize: "10px",
                                      }}
                                    >
                                      Core Seats
                                    </span>
                                  </>
                                ) : (
                                  ""
                                )}
                              </div>
                            ) : (
                              <div
                                className="cf_license_title cf_make_link"
                                onClick={() =>
                                  setSelectedLicense({
                                    planName:
                                      data?.planName ||
                                      data?.planId ||
                                      data?.domain,
                                    assignCount:
                                      data?.seatsUsed && data?.freeSeat
                                        ? data?.seatsUsed + data?.freeSeat
                                        : data?.seatsUsed
                                          ? data?.seatsUsed
                                          : data?.freeSeat,
                                    planId: data?.planId,
                                  })
                                }
                              >
                                {data?.freeSeat ? (
                                  <>
                                    {data?.freeSeat}&nbsp;
                                    <span
                                      style={{
                                        fontSize: "10px",
                                      }}
                                    >
                                      Sales Seats,&nbsp;
                                    </span>
                                  </>
                                ) : (
                                  ""
                                )}
                                {data?.seatsUsed ? (
                                  <>
                                    {data?.seatsUsed}&nbsp;
                                    <span
                                      style={{
                                        fontSize: "10px",
                                      }}
                                    >
                                      Core Seats
                                    </span>
                                  </>
                                ) : (
                                  ""
                                )}
                              </div>
                            )}
                          </td>
                        )
                      ) : (
                        <>
                          {!newImplementation.includes(providerName) ||
                            providerName === "ONE_PASSWORD" ||
                            providerName === "ADOBE_IDENTITY" ||
                            providerName === "FIGMA" ||
                            providerName === "OTHERS" ? (
                            <td className="cf_license_title">
                              {data?.seatsAvailable - data?.seatsUsed < 0
                                ? 0
                                : data?.seatsAvailable - data?.seatsUsed}
                            </td>
                          ) : (
                            ""
                          )}
                          <td>
                            <div
                              className="CF_d-flex ai-center"
                              style={{ gap: "10px" }}
                            >
                              {newImplementation.includes(providerName) ||
                                providerName === "ONE_PASSWORD" ||
                                providerName === "ADOBE_IDENTITY" ||
                                providerName === "FIGMA" ||
                                providerName === "OTHERS" ? (
                                data?.manualEntry ? (
                                  <div
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                    }}
                                  >
                                    {data?.assignedLicenceCount}
                                  </div>
                                ) : (
                                  <div
                                    className="cf_license_title cf_make_link"
                                    onClick={() => {
                                      if (data?.updateSavingCost) {
                                        setSelectedLicense({
                                          planName:
                                            data?.planName || data?.planId,
                                          assignCount: data?.assignedLicenceCount,
                                          planId: data?.planId,
                                        });
                                      } else {
                                        startEdit(data);
                                      }
                                    }}
                                    style={{
                                      fontSize: "12px",
                                    }}
                                  >
                                    {data?.assignedLicenceCount}
                                  </div>
                                )
                              ) : (
                                <div className="cf_license_indicator">
                                  <div
                                    className="cf_license_indicator_filler"
                                    style={{
                                      width: `${(data?.seatsUsed / data?.seatsAvailable) *
                                        100
                                        }%`,
                                    }}
                                  ></div>
                                  <div
                                    className="cf_license_indicator_background"
                                    per={data?.seatsUsed / data?.seatsAvailable}
                                    style={{
                                      width: `${100 -
                                        (data?.seatsUsed / data?.seatsAvailable) *
                                        100
                                        }%`,
                                    }}
                                  ></div>
                                </div>
                              )}
                              {newImplementation.includes(providerName) ||
                                providerName === "ONE_PASSWORD" ||
                                providerName === "ADOBE_IDENTITY" ||
                                providerName === "FIGMA" ||
                                providerName === "OTHERS" ? (
                                ""
                              ) : providerName === "JIRA" ||
                                providerName === "ATLASSIAN" ||
                                providerName === "CONFLUENCE" ? (
                                <div
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: "500",
                                  }}
                                >
                                  {data?.seatsUsed}/{data?.seatsAvailable}
                                </div>
                              ) : (
                                <div
                                  className="cf_license_title cf_make_link"
                                  onClick={() =>
                                    setSelectedLicense({
                                      planName: data?.planName || data?.planId,
                                      assignCount: data?.seatsUsed,
                                      planId: data?.planId,
                                    })
                                  }
                                  style={{
                                    fontSize: "12px",
                                  }}
                                >
                                  {data?.seatsUsed}/{data?.seatsAvailable}
                                </div>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                      <td className="cf_license_title">
                        ${(data?.totalAmount || data?.purchasedPrise)?.toFixed(2)}
                      </td>
                      <td className="cf_license_title">
                        {data?.annualPlan ? "Yearly" : "Monthly"}
                      </td>
                      <td className="cf_license_title">
                        {data?.deleted ? "In-Active" : "Active"}
                      </td>
                      <td>
                        <div
                          className="CF_d-flex ai-center"
                          style={{ gap: "10px" }}
                        >
                          {data?.purchasedDate || data?.expiryDate ? (
                            <div>
                              {data?.purchasedDate ? (
                                <p style={{ whiteSpace: "nowrap" }}>
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Assigned on:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {new Date(data?.purchasedDate)
                                      .toDateString()
                                      ?.split(" ")
                                      ?.splice(1, 4)
                                      ?.join(" ")}
                                  </span>
                                </p>
                              ) : (
                                ""
                              )}
                              {data?.expiryDate ? (
                                <p style={{ whiteSpace: "nowrap" }}>
                                  <span
                                    className="cf_license_title"
                                    style={{
                                      fontSize: "12px",
                                      color: "#acacac",
                                      fontWeight: 400,
                                    }}
                                  >
                                    Expires on:{" "}
                                  </span>
                                  <span
                                    className="cf_license_title"
                                    style={{ fontSize: "12px" }}
                                  >
                                    {new Date(data?.expiryDate)
                                      .toDateString()
                                      ?.split(" ")
                                      ?.splice(1, 4)
                                      ?.join(" ")}
                                  </span>
                                </p>
                              ) : (
                                ""
                              )}
                            </div>
                          ) : (
                            ""
                          )}
                          <div
                            className="cf_dashboard_analytics_edit CF_Pointer"
                            style={{ marginLeft: "auto" }}
                            onClick={() => {
                              startEdit(data);
                              setIsEditExistingLicense(true);
                            }}
                          >
                            <Pencil size={14} />
                          </div>
                        </div>
                      </td>
                      {/* <td></td> */}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {isLoading ? getCFTextLoader() : ""}
      </div>
      <Popup
        options={{
          isOpen: isVisible,
          title: `${newLicense?.id
            ? `Edit ${newLicense?.planName?.replaceAll("_", " ") ||
            newLicense?.planId?.replaceAll("_", " ") ||
            newLicense?.domain?.replaceAll("_", " ")
            } License`
            : `Add License for ${getCloudName(providerName === "OTHERS" ? externalProviderName : providerName)}`
            }`,
          popupWidth: "450px",
          popupHeight: "fit-content",
          popupTop: "100px",
          maxHeight: "450px",
          overflowY: "auto",
        }}
        toggleOpen={setIsVisible}
      >
        <div
          className="cf_popup_container_body"
          style={{
            padding: "15px",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              maxHeight: "450px",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            <TextInput
              type="text"
              autoFocus={true}
              inputWidth="100%"
              defaultValue={
                newLicense?.planName
                  ? newLicense?.planName?.replaceAll("_", " ")
                  : newLicense?.planId?.replaceAll("_", " ")
              }
              inputName="domainName"
              placeHolder="Plan Name *"
              errorData={errorData?.planName}
              readOnly={isEditExistingLicense}
              getInputText={(val) => handleEditLicense("planName", val)}
            />
            {providerName !== "MAILTRAP" && (
              <TextInput
                type="number"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newLicense?.totalLicenceCount}
                inputName="totalLicenceCount"
                errorData={errorData?.totalLicenceCount}
                placeHolder="Total Licence Count*"
                getInputText={(val) =>
                  val !== ""
                    ? /\d/.test(+val) && +val >= 0
                      ? handleEditLicense("totalLicenceCount", +val)
                      : ""
                    : handleEditLicense("totalLicenceCount", "")
                }
              />
            )}
            {!isEditExistingLicense && (
              <TextInput
                type="number"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={newLicense?.assignedLicenceCount}
                inputName="assignedLicenceCount"
                errorData={errorData?.assignedLicenceCount}
                placeHolder="Assigned Licence Count*"
                getInputText={(val) =>
                  val !== ""
                    ? /\d/.test(+val) && +val >= 0
                      ? handleEditLicense("assignedLicenceCount", +val)
                      : ""
                    : handleEditLicense("assignedLicenceCount", "")
                }
              />
            )}
            <TextInput
              type="number"
              autoFocus={true}
              inputWidth="100%"
              defaultValue={newLicense?.purchasedPrise}
              inputName="purchasedPrise"
              errorData={errorData?.purchasedPrise}
              placeHolder="Purchased Price*"
              getInputText={(val) =>
                val !== ""
                  ? /\d/.test(+val) && +val >= 0
                    ? handleEditLicense("purchasedPrise", +val)
                    : ""
                  : handleEditLicense("purchasedPrise", "")
              }
            />
            <div style={{ width: "100%" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "400",
                  padding: "0 5px",
                  color: "#0062ff",
                }}
              >
                Purchased Date
              </span>
              <TextInput
                type="date"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={
                  newLicense?.purchasedDate
                    ? newLicense?.purchasedDate?.split("T")[0]
                    : ""
                }
                inputName="purchasedDate"
                errorData={errorData?.purchasedDate}
                placeHolder=""
                getInputText={(val) => {
                  const purchasedDateISO = new Date(val).toISOString();
                  setNewLicense((prev) => {
                    const expiredDateISO = getExpiredDateFromPurchase(val, !!prev?.yearlySubscription);
                    return {
                      ...prev,
                      purchasedDate: purchasedDateISO,
                      ...(expiredDateISO && { expiredDate: expiredDateISO }),
                    };
                  });
                }}
              // readOnly={!newLicense?.isPaid}
              />
            </div>
            <div style={{ width: "100%" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "400",
                  padding: "0 5px",
                  color: "#0062ff",
                }}
              >
                Expiry Date*
              </span>
              <TextInput
                type="date"
                autoFocus={true}
                inputWidth="100%"
                defaultValue={
                  newLicense?.expiredDate
                    ? newLicense?.expiredDate?.split("T")[0]
                    : ""
                }
                inputName="expiredDate"
                errorData={errorData?.expiredDate}
                placeHolder=""
                getInputText={(val) =>
                  handleEditLicense("expiredDate", new Date(val)?.toISOString())
                }
              // readOnly={!newLicense?.isPaid}
              />
            </div>
            <div
              className="CF_d-flex ai-center"
              style={{
                gap: "10px",
                justifyContent: "flex-start",
                width: "100%",
              }}
            >
              <div>Recurring :</div>
              <div className={`CF_d-flex ai-center`} style={{ gap: "8px" }}>
                <span
                  className={`cf_switch_text ${!newLicense?.yearlySubscription ? "cf_switch_active" : ""
                    }`}
                >
                  Monthly&nbsp;&nbsp;
                </span>
                <label className="switch">
                  <input
                    type="checkbox"
                    id="splitChannels"
                    checked={newLicense?.yearlySubscription}
                    onChange={(e) => {
                      const isYearly = e.target.checked;
                      setNewLicense((prev) => {
                        const next = { ...prev, yearlySubscription: isYearly };
                        if (prev?.purchasedDate) {
                          const expiredDateISO = getExpiredDateFromPurchase(prev.purchasedDate, isYearly);
                          if (expiredDateISO) next.expiredDate = expiredDateISO;
                        }
                        return next;
                      });
                    }}
                  />
                  <span className="slider round" style={{ top: "6px" }}></span>
                </label>
                <span
                  className={`cf_switch_text ${newLicense?.yearlySubscription ? "cf_switch_active" : ""
                    }`}
                >
                  Yearly
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          className="cf_popup_container_footer"
          style={{ padding: "0 20px", paddingBottom: "10px" }}
        >
          <ButtonComponent
            customstyles={{ marginLeft: "auto" }}
            inputWidth="100px"
            isLoading={false}
            isDisabled={false}
            buttonName={newLicense?.id ? "Update" : "Save"}
            buttonClickAction={() => updateCostInfo()}
          />
        </div>
      </Popup>
      {isPageLoading ? getCFLoader() : ""}
      <Popup
        toggleOpen={() => setLicenseFeaturesPopup(null)}
        options={{
          isOpen: !!licenseFeaturesPopup,
          title: "License features",
          type: "side",
          popupWidth: "40%",
          popupHeight: "calc(100% - 0px)",
          popupTop: "0px",
          maxHeight: "100%",
          overflowY: "auto",
          parentStyles: {
            justifyContent: "flex-end",
          },
        }}
      >
        <div
          className="cf_popup_container_body ms-license-features-popup"
          style={{
            flexDirection: "column",
            alignItems: "stretch",
            height: "100%",
            justifyContent: "flex-start",
          }}
        >
          <div className="ms-license-features-popup__body">
            <div className="ms-license-features-popup__panel">
              <p className="ms-license-features-popup__kicker">Included capabilities</p>
              <p className="ms-license-features-popup__subtitle">
                {licenseFeaturesPopup?.title ?? "License"}
              </p>
              <ul className="ms-license-features-popup__list">
                {licenseFeaturesPopup?.features?.map((line, i) => (
                  <li key={i} className="ms-license-features-popup__item">
                    <span className="ms-license-features-popup__icon" aria-hidden>
                      ✓
                    </span>
                    <span className="ms-license-features-popup__text">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* <p className="ms-license-features-popup__footer-note">
              Summary for planning and demos. Confirm entitlements in Microsoft 365 admin center for
              your tenant.
            </p> */}
          </div>
        </div>
      </Popup>
      {selectedLicense && (
        <SaaSLicenceUserList
          licenseInfo={selectedLicense}
          setSelectedLicense={setSelectedLicense}
        />
      )}
      <InVoiceFileUploadNew
        isUploadInvoice={isUploadInvoice}
        setIsUploadInvoice={setIsUploadInvoice}
        saasVendor={globalContext?.saasCloud}
        getLicenses={getLicenses}
        fetchSaaSCosting={fetchSaaSCosting}
      />
    </>
  );
};

export default DemoLicenseManagement;