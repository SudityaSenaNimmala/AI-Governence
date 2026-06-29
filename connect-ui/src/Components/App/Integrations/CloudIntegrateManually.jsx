import { useContext, useEffect, useState } from "react";
import Popup from "../../Resuables/Popup/Popup";
import TextInput from "../../Resuables/InputsComponents/TextInput";
import SearchComponentDropDown from "../../Resuables/SearchComponent/SearchComponentDropDown";
import { GlobalContext } from "../../../GlobalContext/GlobalContext";
import { getCloudName, integrationsList } from "../../helpers/helpers";
import { Trash2 } from "lucide-react";
import ButtonComponent from "../../Resuables/InputsComponents/ButtonComponent";
import { notifyToast, validateEmail } from "../../helpers/utils";
import { saveManuallyIntegration } from "../Oauth/OauthActions/OauthApiActions";
import { useNavigate } from "react-router-dom";

const CloudIntegrateManually = ({
  isManuallyIntegration,
  setIsManuallyIntegration,
  setIsPageLoading,
}) => {
  const navigate = useNavigate();
  const { globalContext } = useContext(GlobalContext);
  const { cloudsList } = globalContext;
  const [manuallyIntegrationData, setManuallyIntegrationData] = useState({
    vendor: {
      adminEmail: "",
      providerName: "",
      externalProviderName: "",
      UsersCount: "",
    },
    subscriptions: [],
    checkAdminEmail: "",
    purchaseDate: "",
    expiryDate: "",
    recurring: false,
  });

  const [listSubscriptions, setListSubscriptions] = useState([
    {
      planName: "",
      totalLicenceCount: "",
      assignedLicenceCount: "",
      purchasedPrise: "",
    },
  ]);

  const [errorData, setErrorData] = useState([
    {
      planName: "",
      totalLicenceCount: "",
      assignedLicenceCount: "",
      purchasedPrise: "",
    },
  ]);

  const [errorValidation, setErrorValidation] = useState({
    adminEmail: "",
    providerName: "",
    externalProviderName: "",
    UsersCount: "",
    purchaseDate: "",
    expiryDate: "",
  });

  const [suggestionsList, setSuggestionsList] = useState([]);
  const [suggestionsEmailList, setSuggestionsEmailList] = useState([]);

  const getExpiredDateFromPurchase = (purchasedDateVal, isYearly) => {
    if (!purchasedDateVal) return null;
    const d = new Date(purchasedDateVal);
    if (isYearly) d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  };

  useEffect(() => {
    if (isManuallyIntegration) {
      setErrorValidation({});
      setErrorData([]);
      setManuallyIntegrationData({
        vendor: {
          adminEmail: "",
          providerName: "",
          externalProviderName: "",
          UsersCount: "",
        },
        subscriptions: [],
        checkAdminEmail: "",
        purchaseDate: "",
        expiryDate: "",
        recurring: false,
      });
      setListSubscriptions([
        {
          planName: "",
          totalLicenceCount: "",
          assignedLicenceCount: "",
          purchasedPrise: "",
        },
      ]);
    }
    makeSuggestionsList();
  }, [cloudsList, isManuallyIntegration]);

  const makeSuggestionsList = () => {
    let cloudData = integrationsList().reduce((acc, curr) => {
      acc.push(curr.cloudName);
      return acc;
    }, []);
    setSuggestionsList(cloudData);

    let emailData = cloudsList?.reduce((acc, curr) => {
      if (!acc?.includes(curr.adminEmail) && validateEmail(curr.adminEmail)) {
        acc.push(curr.adminEmail);
      }
      return acc;
    }, []);
    setSuggestionsEmailList(emailData);
  };

  const saveIntegration = async () => {
    // First Validate ManuallyIntegrationData
    let validateError = {};
    if (manuallyIntegrationData.vendor.providerName === "") {
      validateError.providerName = "This field is required";
    }
    // if (manuallyIntegrationData.vendor.adminEmail === "") {
    //   validateError.adminEmail = "This field is required";
    // }
    if (manuallyIntegrationData.vendor.UsersCount === "") {
      validateError.UsersCount = "This field is required";
    }
    if (manuallyIntegrationData.purchaseDate === "") {
      validateError.purchaseDate = "This field is required";
    }
    if (manuallyIntegrationData.expiryDate === "") {
      validateError.expiryDate = "This field is required";
    }
    // if (manuallyIntegrationData.vendor.externalProviderName === "") {
    //   validateError.externalProviderName = "This field is required";
    // }
    if (manuallyIntegrationData.checkAdminEmail === "") {
      validateError.checkAdminEmail = "This field is required";
    }
    if (
      manuallyIntegrationData.checkAdminEmail === "OTHERS" &&
      manuallyIntegrationData.vendor.adminEmail === ""
    ) {
      validateError.adminEmail = "This field is required";
    }
    if (
      manuallyIntegrationData.vendor.providerName === "OTHERS" &&
      manuallyIntegrationData.vendor.externalProviderName === ""
    ) {
      validateError.externalProviderName = "This field is required";
    }

    if (Object.keys(validateError).length > 0) {
      setErrorValidation(validateError);
      return;
    }

    // First Validate All ListSubscriptions
    let isValid = true;
    listSubscriptions.forEach((item, index) => {
      if (item.planName === "") {
        isValid = false;
        setErrorData(
          errorData?.map((item, i) =>
            i === index
              ? { ...item, planName: "This field is required" }
              : { ...item, planName: "" }
          )
        );
      }
    });
    console.log("CHECK");

    if (!isValid) {
      return;
    }

    console.log(manuallyIntegrationData);
    console.log(listSubscriptions);

    let makeVendor = {
      adminEmail:
        manuallyIntegrationData.checkAdminEmail === "OTHERS"
          ? manuallyIntegrationData.vendor.adminEmail
          : manuallyIntegrationData.checkAdminEmail,
      providerName: "OTHERS",
      externalProviderName:
        manuallyIntegrationData.vendor.providerName === "OTHERS"
          ? manuallyIntegrationData.vendor.externalProviderName
          : manuallyIntegrationData.vendor.providerName,
      usersCount: manuallyIntegrationData.vendor.UsersCount,
    };

    let makeSubscriptions = [];
    listSubscriptions.forEach((item) => {
      makeSubscriptions.push({
        planName: item.planName,
        totalLicenceCount: item.totalLicenceCount,
        assignedLicenceCount: item.assignedLicenceCount,
        purchasedPrise: item.purchasedPrise,
        purchasedDate: manuallyIntegrationData.purchaseDate?.split("T")[0],
        expiredDate: manuallyIntegrationData.expiryDate?.split("T")[0],
        yearlySubscription: manuallyIntegrationData.recurring,
      });
    });

    let makeData = {
      vendor: makeVendor,
      subscriptions: makeSubscriptions,
    };

    setIsManuallyIntegration(false);
    setIsPageLoading(true);
    let res = await saveManuallyIntegration(makeData);
    if (res?.status === "OK") {
      setIsPageLoading(false);
      notifyToast("success", "Application Added Successfully");
      setTimeout(() => {
        navigate("/Integrations/Manage");
      }, 300);
    } else {
      setIsPageLoading(false);
      notifyToast("error", res?.res);
    }
  };

  return (
    <Popup
      options={{
        isOpen: isManuallyIntegration,
        title: `New App Integration`,
        popupWidth: "80%",
        // type: "side",
        // titleStyle: "",
        popupHeight: "calc(100% - 80px)",
        popupTop: "40px",
        maxHeight: "100%",
        overflowY: "auto",
        customStyles: {
          borderRadius: "10px",
        },
      }}
      toggleOpen={setIsManuallyIntegration}
    >
      <div
        className="cf_popup_container_body"
        style={{
          padding: "25px 15px",
          height: "calc(100% - 100px)",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          flexDirection: "column",
          // gap: "10px",
        }}
      >
        <div
          className="CF_d-flex"
          style={{
            width: "100%",
            gap: "20px",
            padding: "20px 0px",
            borderBottom: "1px solid #E0E0E0",
            borderTop: "1px solid #E0E0E0",
          }}
        >
          <div
            style={{
              width: "fit-content",
              gap: "20px",
              flexDirection: "column",
            }}
            className="CF_d-flex"
          >
            <SearchComponentDropDown
              defaultVal={
                manuallyIntegrationData.vendor.providerName
                  ? getCloudName(manuallyIntegrationData.vendor.providerName)
                  : manuallyIntegrationData.vendor.providerName
              }
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              isSuggestionsLoading={false}
              suggestionsList={
                manuallyIntegrationData?.vendor?.providerName
                  ? suggestionsList?.filter((itm) =>
                      getCloudName(itm)
                        ?.toLowerCase()
                        ?.includes(
                          manuallyIntegrationData?.vendor?.providerName?.toLowerCase()
                        )
                    )
                  : suggestionsList
              }
              isCloudsList={true}
              addNewOption={true}
              errorData={errorValidation?.providerName}
              newOptionText={`+ New Application`}
              canHaveIcons={true}
              customStyles={{
                width: "360px",
              }}
              inputPlaceHolder={`Application Name *`}
              onInputSearch={(e) => {
                setManuallyIntegrationData({
                  ...manuallyIntegrationData,
                  vendor: {
                    ...manuallyIntegrationData.vendor,
                    providerName: e?.searchInput,
                  },
                });
              }}
            />
            {manuallyIntegrationData.vendor.providerName === "OTHERS" && (
              <TextInput
                type="text"
                autoFocus={true}
                inputWidth="360px"
                defaultValue={
                  manuallyIntegrationData.vendor.externalProviderName
                }
                inputName="externalProviderName"
                placeHolder="External Application Name"
                errorData={errorValidation?.externalProviderName}
                getInputText={(val) =>
                  setManuallyIntegrationData({
                    ...manuallyIntegrationData,
                    vendor: {
                      ...manuallyIntegrationData.vendor,
                      externalProviderName: val,
                    },
                  })
                }
              />
            )}
          </div>
          <div
            style={{
              width: "fit-content",
              gap: "20px",
              flexDirection: "column",
            }}
            className="CF_d-flex"
          >
            <SearchComponentDropDown
              defaultVal={manuallyIntegrationData.checkAdminEmail}
              autoOpen={true}
              boxShadows={true}
              inputName="searchInput"
              isSuggestionsLoading={false}
              suggestionsList={
                manuallyIntegrationData?.checkAdminEmail
                  ? suggestionsEmailList?.filter((itm) =>
                      itm
                        ?.toLowerCase()
                        ?.includes(
                          manuallyIntegrationData?.checkAdminEmail?.toLowerCase()
                        )
                    )
                  : suggestionsEmailList
              }
              isCloudsList={true}
              addNewOption={true}
              canHaveIcons={false}
              errorData={errorValidation?.checkAdminEmail}
              newOptionText={`+ New Owner Email`}
              customStyles={{
                width: "360px",
              }}
              inputPlaceHolder={`Owner Email *`}
              onInputSearch={(e) => {
                setManuallyIntegrationData({
                  ...manuallyIntegrationData,
                  checkAdminEmail: e?.searchInput,
                });
              }}
            />
            {manuallyIntegrationData.checkAdminEmail === "OTHERS" && (
              <TextInput
                type="email"
                autoFocus={true}
                inputWidth="360px"
                textInputWidth="360px"
                defaultValue={manuallyIntegrationData.vendor.adminEmail}
                inputName="adminEmail"
                placeHolder="Owner Email"
                errorData={errorValidation?.adminEmail}
                getInputText={(val) =>
                  setManuallyIntegrationData({
                    ...manuallyIntegrationData,
                    vendor: {
                      ...manuallyIntegrationData.vendor,
                      adminEmail: val,
                    },
                  })
                }
              />
            )}
          </div>
          <TextInput
            type="number"
            autoFocus={false}
            inputWidth="360px"
            textInputWidth="360px"
            defaultValue={manuallyIntegrationData.vendor.UsersCount}
            inputName="UsersCount"
            placeHolder="Users Count*"
            errorData={errorValidation?.UsersCount}
            getInputText={(val) =>
              val !== ""
                ? /\d/.test(+val)
                  ? setManuallyIntegrationData({
                      ...manuallyIntegrationData,
                      vendor: {
                        ...manuallyIntegrationData.vendor,
                        UsersCount: +val,
                      },
                    })
                  : ""
                : setManuallyIntegrationData({
                    ...manuallyIntegrationData,
                    vendor: {
                      ...manuallyIntegrationData.vendor,
                      UsersCount: "",
                    },
                  })
            }
          />
        </div>
        <div
          className="CF_d-flex ai-center"
          style={{
            gap: "20px",
            width: "100%",
            padding: "20px 0",
            borderBottom: "1px solid #E0E0E0",
          }}
        >
          <div style={{ width: "fit-content" }}>
            <span
              style={{
                fontSize: "12px",
                fontWeight: "400",
                padding: "0 5px",
                color: "#0062ff",
              }}
            >
              Purchased Date*
            </span>
            <TextInput
              type="date"
              autoFocus={false}
              inputWidth="360px"
              textInputWidth="360px"
              defaultValue={manuallyIntegrationData.purchaseDate?.split("T")[0]}
              inputName="domainName"
              errorData={errorValidation?.purchaseDate}
              placeHolder=""
              getInputText={(val) => {
                const purchaseDateISO = new Date(val).toISOString();
                setManuallyIntegrationData((prev) => {
                  const expiryDateISO = getExpiredDateFromPurchase(val, prev.recurring);
                  return {
                    ...prev,
                    purchaseDate: purchaseDateISO,
                    ...(expiryDateISO && { expiryDate: expiryDateISO }),
                  };
                });
              }}
            />
          </div>
          <div style={{ width: "fit-content" }}>
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
              autoFocus={false}
              inputWidth="360px"
              textInputWidth="360px"
              defaultValue={manuallyIntegrationData.expiryDate?.split("T")[0]}
              inputName="domainName"
              errorData={errorValidation?.expiryDate}
              placeHolder=""
              getInputText={(val) =>
                setManuallyIntegrationData({
                  ...manuallyIntegrationData,
                  expiryDate: new Date(val)?.toISOString(),
                })
              }
            />
          </div>
          <div
            className="CF_d-flex ai-center"
            style={{
              gap: "10px",
              justifyContent: "flex-start",
              width: "100%",
              marginLeft: "30px",
              marginTop: "20px",
            }}
          >
            <div>Recurring :</div>
            <div className="CF_d-flex ai-center" style={{ gap: "8px" }}>
              <span
                className={`cf_switch_text ${
                  !manuallyIntegrationData.recurring ? "cf_switch_active" : ""
                }`}
              >
                Monthly&nbsp;&nbsp;
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  id="splitChannels"
                  checked={manuallyIntegrationData.recurring}
                  onChange={(e) => {
                    const isYearly = e.target.checked;
                    setManuallyIntegrationData((prev) => {
                      const next = { ...prev, recurring: isYearly };
                      if (prev.purchaseDate) {
                        const expiryDateISO = getExpiredDateFromPurchase(prev.purchaseDate, isYearly);
                        if (expiryDateISO) next.expiryDate = expiryDateISO;
                      }
                      return next;
                    });
                  }}
                />
                <span className="slider round" style={{ top: "6px" }}></span>
              </label>
              <span
                className={`cf_switch_text ${
                  manuallyIntegrationData.recurring ? "cf_switch_active" : ""
                }`}
              >
                Yearly
              </span>
            </div>
          </div>
        </div>
        <div
          className="CF_d-flex"
          style={{
            width: "100%",
            gap: "20px",
            padding: "20px 0px",
            flexDirection: "column",
            borderBottom: "1px solid #E0E0E0",
          }}
        >
          <>
            {listSubscriptions.map((item, index) => (
              <div
                className="CF_d-flex"
                style={{ gap: "20px", padding: "10px 0" }}
              >
                <TextInput
                  type="text"
                  autoFocus={false}
                  inputWidth="260px"
                  textInputWidth="260px"
                  defaultValue={item.planName}
                  inputName="planName"
                  placeHolder="Plan Name"
                  errorData={errorData[index]?.planName}
                  getInputText={(val) =>
                    setListSubscriptions(
                      listSubscriptions.map((item, i) =>
                        i === index ? { ...item, planName: val } : item
                      )
                    )
                  }
                />
                <TextInput
                  type="email"
                  autoFocus={false}
                  inputWidth="260px"
                  textInputWidth="260px"
                  defaultValue={item.totalLicenceCount}
                  inputName="totalLicenceCount"
                  placeHolder="Total Licenses Count"
                  errorData={errorData[index]?.totalLicenceCount}
                  getInputText={(val) =>
                    setListSubscriptions(
                      listSubscriptions.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              totalLicenceCount:
                                val !== "" ? (/\d/.test(+val) ? +val : "") : "",
                            }
                          : item
                      )
                    )
                  }
                />
                <TextInput
                  type="email"
                  autoFocus={false}
                  inputWidth="260px"
                  textInputWidth="260px"
                  defaultValue={item.assignedLicenceCount}
                  inputName="assignedLicenceCount"
                  placeHolder="Assigned Licenses Count"
                  errorData={errorData[index]?.assignedLicenceCount}
                  getInputText={(val) =>
                    setListSubscriptions(
                      listSubscriptions.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              assignedLicenceCount:
                                val !== "" ? (/\d/.test(+val) ? +val : "") : "",
                            }
                          : item
                      )
                    )
                  }
                />
                <TextInput
                  type="email"
                  autoFocus={false}
                  inputWidth="260px"
                  textInputWidth="260px"
                  defaultValue={item.purchasedPrise}
                  inputName="purchasedPrise"
                  placeHolder="Purchased Price"
                  errorData={errorData[index]?.purchasedPrise}
                  getInputText={(val) =>
                    setListSubscriptions(
                      listSubscriptions.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              purchasedPrise:
                                val !== "" ? (/\d/.test(+val) ? +val : "") : "",
                            }
                          : item
                      )
                    )
                  }
                />
                {listSubscriptions.length > 1 && (
                  <div
                    style={{
                      marginLeft: "auto",
                      padding: "0",
                      width: "30px",
                      height: "30px",
                      justifyContent: "center",
                      marginTop: "5px",
                    }}
                    className="cf_onboard_timer CF_d-flex ai-center CF_Pointer"
                    onClick={() => {
                      setListSubscriptions(
                        listSubscriptions.filter((item, i) => i !== index)
                      );
                      setErrorData(errorData?.filter((item, i) => i !== index));
                    }}
                  >
                    <Trash2 size={14} />
                  </div>
                )}
              </div>
            ))}
            <p
              style={{ fontSize: "12px" }}
              className="cf_make_link"
              onClick={() => {
                setListSubscriptions([
                  ...listSubscriptions,
                  {
                    planName: "",
                    totalLicenceCount: "",
                    assignedLicenceCount: "",
                    purchasedPrise: "",
                  },
                ]);
                setErrorData([
                  ...errorData,
                  {
                    planName: "",
                    totalLicenceCount: "",
                    assignedLicenceCount: "",
                    purchasedPrise: "",
                  },
                ]);
              }}
            >
              + New Licence
            </p>
          </>
        </div>
      </div>
      <div
        className="cf_popup_container_footer"
        style={{
          padding: "0 20px",
          paddingBottom: "0px",
          //   borderTop: "1px solid #E0E0E0",
        }}
      >
        <ButtonComponent
          customstyles={{
            marginLeft: "auto",
            height: "35px",
            fontSize: "12px",
            fontWeight: "500",
          }}
          inputWidth="60px"
          isLoading={false}
          isDisabled={false}
          buttonName={"Save"}
          buttonClickAction={() => saveIntegration()}
        />
      </div>
    </Popup>
  );
};

export default CloudIntegrateManually;
