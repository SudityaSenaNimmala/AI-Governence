import Popup from "../../../Resuables/Popup/Popup";
import { useEffect, useState } from "react";
import FlowLicenseSelector from "../../NewFlow/FlowLicenseSelector";
import { getLicensesList } from "../../SaaSManagement/SaaSActions/SaaSActions";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { putLicenseConfigLicenses } from "../DashboardActions/DashboardActions";
import { notifyToast } from "../../../helpers/utils";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";

const LicenseHarverster = ({ licenseInfo = {}, refreshSubscriptions = () => { } }) => {
    const [isVisible, setIsVisible] = useState(true);
    const [licensesList, setLicensesList] = useState([]);
    const [isLicenseLoaded, setIsLicenseLoaded] = useState(false);
    const [originalLicenseSelect, setOriginalLicenseSelect] = useState([]);
    const [selectedLicense, setSelectedLicense] = useState([]);
    const [isPageLoading, setIsPageLoading] = useState(false);
    const [isSaveChanges, setIsSaveChanges] = useState(false);
    const [apiBody, setApiBody] = useState({
        email: null,
        adminCloudId: null,
        add: [],
        remove: [],
    });
    useEffect(() => {
        if (licenseInfo?.currentVendorLicesnes?.length > 0) {
            fetchLicenses();
            setLicensesList([]);
            setIsLicenseLoaded(true);
            setIsVisible(true);
        }
    }, [licenseInfo]);

    const fetchLicenses = async () => {
        setIsLicenseLoaded(true);
        let res = await getLicensesList(licenseInfo?.email, licenseInfo?.vendorName, licenseInfo?.adminCloudId);
        if (res?.status === "OK" && res?.res) {
            setLicensesList(res?.res);
            setIsLicenseLoaded(false);
            let existLics = res?.res?.filter((license) => licenseInfo?.currentVendorLicesnes?.find((item) => item?.objectId === license?.objectId));
            setSelectedLicense(existLics);
            setOriginalLicenseSelect(existLics);
        } else {
            setLicensesList([]);
            setIsLicenseLoaded(false);
        }
    }

    const handleLicenseSelection = (e, licenses) => {
        if (e.target.checked) {
            setSelectedLicense((prev) => [...prev, licenses]);
        } else {
            setSelectedLicense((prev) => prev.filter((license) => license?.objectId !== licenses?.objectId));
        }
    }

    const handleSave = async () => {
        setIsPageLoading(true);
        setIsSaveChanges(false);
        let addedId = selectedLicense.reduce((acc, license) => {
            if (!originalLicenseSelect.find((item) => item?.objectId === license?.objectId)) {
                acc.push(license?.planId);
            }
            return acc;
        }, []);
        let removedId = originalLicenseSelect.reduce((acc, license) => {
            if (!selectedLicense.find((item) => item?.objectId === license?.objectId)) {
                acc.push(license?.planId);
            }
            return acc;
        }, []);
        const payload = {
            emailId: licenseInfo?.email,
            adminCloudId: licenseInfo?.adminCloudId,
            add: addedId,
            remove: removedId,
        };
        setApiBody(payload);

        try {
            if (payload.add?.length > 0) {
                const firstRes = await putLicenseConfigLicenses([{
                    emailId: payload.emailId,
                    adminCloudId: payload.adminCloudId,
                    add: payload.add,
                    remove: [],
                }]);
                if (firstRes?.status === "OK") {
                    const addedCount = firstRes?.res?.addedCount ?? firstRes?.addedCount ?? 0;
                    if (addedCount > 0 && payload.remove?.length > 0) {
                        await putLicenseConfigLicenses([{
                            emailId: payload.emailId,
                            adminCloudId: payload.adminCloudId,
                            add: [],
                            remove: payload.remove,
                        }]);
                    } else if (payload.remove?.length > 0) {
                        let res = await putLicenseConfigLicenses([{ ...payload }]);
                        if (res?.status !== "OK") {
                            notifyToast("error", res?.res ?? "Failed to update licenses");
                            return;
                        } else {
                            notifyToast("success", "Licenses Updated successfully");
                        }
                    }
                } else {
                    notifyToast("error", firstRes?.res ?? "Failed to update licenses");
                    return;
                }
            } else if (payload.remove?.length > 0) {
                const res = await putLicenseConfigLicenses([{ ...payload }]);
                if (res?.status !== "OK") {
                    notifyToast("error", res?.res ?? "Failed to update licenses");
                    return;
                }
            }
            setIsSaveChanges(false);
            notifyToast("success", "Licenses updated successfully");
            // fetchLicenses();
        } catch (err) {
            notifyToast("error", err?.message ?? "Failed to update licenses");
        } finally {
            setIsPageLoading(false);
            refreshSubscriptions(licenseInfo?.email);
        }
    }

    return (
        <>
            <Popup
                options={{
                    isOpen: isVisible,
                    title: `License Harverster for ${licenseInfo?.email}`,
                    popupWidth: "30%",
                    type: "side",
                    popupHeight: "calc(100% - 0px)",
                    popupTop: "0px",
                    maxHeight: "100%",
                    overflowY: "auto",
                    parentStyles: {
                        justifyContent: "flex-end",
                    },
                }}
                toggleOpen={setIsVisible}
            >
                <div
                    className="cf_popup_container_body"
                    style={{
                        padding: "15px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        justifyContent: "flex-start",
                    }}
                >

                    {/* <div style={{ padding: "10px" }}> */}
                    <FlowLicenseSelector
                        appName={licenseInfo?.vendorName}
                        appId={licenseInfo?.adminCloudId}
                        licenseMap={licensesList}
                        isLicenseLoaded={isLicenseLoaded}
                        handleLicenseSelection={handleLicenseSelection}
                        selectedLicenses={selectedLicense}
                        isTitleVisible={false}
                    />
                    {/* </div> */}
                </div>
                <div
                    className="cf_popup_container_footer"
                    style={{ padding: "0 20px", paddingBottom: "10px", justifyContent: "flex-end" }}
                >
                    <ButtonComponent
                        inputWidth="100px"
                        buttonName="Save"
                        isDisabled={btoa(JSON.stringify(selectedLicense)) === btoa(JSON.stringify(originalLicenseSelect))}
                        buttonClickAction={() => setIsSaveChanges(true)}
                    />
                </div>
            </Popup >
            <Popup
                options={{
                    isOpen: isSaveChanges,
                    title: `Save Changes`,
                    popupWidth: "30%",
                    popupHeight: `200px`,
                    popupTop: "150px",
                }}
                toggleOpen={setIsSaveChanges}
            >
                <div
                    className="cf_popup_container_body"
                    style={{
                        padding: "20px 10px",
                        flexDirection: "column",
                        gap: "30px",
                        maxHeight: "500px",
                    }}
                >
                    <p style={{ fontWeight: "600" }}>
                        Are you sure you want to save the changes?
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
                            setIsSaveChanges(null);
                        }}
                    />
                    <ButtonComponent
                        inputWidth="100px"
                        isLoading={false}
                        isDisabled={false}
                        buttonName="Yes"
                        buttonClickAction={() => handleSave()}
                    />
                </div>
            </Popup>
            {isPageLoading ? getCFLoader() : ""}
        </>
    )
}

export default LicenseHarverster;