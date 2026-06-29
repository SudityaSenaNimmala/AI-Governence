import { MapPin } from "lucide-react";
import ActionPanel from "../../NewFlow/components/ActionPanel";

const WorkFlowRenderLocations = ({ locationData = "", handleEditObject = () => { }, handleDeleteObject = () => { }, workFlowData = {}, setWorkFlowData = () => { } }) => {
    return (
        <ActionPanel
            key={locationData + "LOCATION"}
            action={locationData}
            onDelete={() => handleDeleteObject(locationData)}
            showDelete={true}
            borderColor="#9E2A5C"
            backgroundColor="#FFD6E7"
            icon={<MapPin size={22} color="#9E2A5C" />}
            title={locationData}
        />
    )
}

export default WorkFlowRenderLocations;