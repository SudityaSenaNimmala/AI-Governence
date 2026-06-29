import { cloudImageMapper, getCloudName } from "../../../helpers/helpers";
import ActionPanel from "../../NewFlow/components/ActionPanel";

const WorkFlowRenderAppications = ({ appData = {}, appType = "", handleEditObject = () => { }, handleDeleteObject = () => { }, workFlowData = {}, setWorkFlowData = () => { }, type = "ONBOARD", disableEdit = false }) => {
    return (
        appType === "TRIGGER" ?
            <ActionPanel
                action={appData?.currentApplication}
                borderColor="#fa8248"
                backgroundColor="#f9bfa22b"
                icon={
                    <p style={{ fontSize: "18px", fontWeight: "500" }}>
                        ⚡
                    </p>
                }
                title="When User Onboarded in"
                subtitle={getCloudName(
                    appData?.currentApplication?.providerName === "OTHERS" ? appData?.currentApplication?.externalProviderName : appData?.currentApplication?.providerName
                )}
            />
            :
            <ActionPanel
                disableEdit={disableEdit}
                key={appData?.currentApplication?.id + "APPLICATION"}
                action={appData}
                onEdit={() =>
                    handleEditObject({
                        ...appData,
                        type: "PRIMARY_APPLICATION",
                    })
                }
                onDelete={() => {
                    handleDeleteObject(appData);
                }
                }
                showDelete={true}
                deleted={appData?.deleted}
                borderColor="#0062ff"
                backgroundColor="rgb(178 199 255 / 14%)"
                imageSrc={cloudImageMapper(
                    appData?.currentApplication?.providerName, appData?.currentApplication?.externalProviderName
                )}
                imageAlt={appData?.currentApplication?.providerName === "OTHERS" ? appData?.currentApplication?.externalProviderName : appData?.currentApplication?.providerName}
                title={type === "ONBOARD" ? "Onboard User to" : "Offboard User from"}
                subtitle={`${getCloudName(
                    (appData?.currentApplication?.providerName === "OTHERS" ? appData?.currentApplication?.externalProviderName : appData?.currentApplication?.providerName) || (appData?.currentApplication?.applicationName === "OTHERS" ? appData?.currentApplication?.externalProviderName : appData?.currentApplication?.applicationName)
                )}${appData?.currentApplication?.adminEmail ? ` (${appData?.currentApplication?.adminEmail})` : ""}`}
            />
    )
}

export default WorkFlowRenderAppications;