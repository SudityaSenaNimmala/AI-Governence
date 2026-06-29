import { Building } from "lucide-react";
import ActionPanel from "../../NewFlow/components/ActionPanel";

const WorkFlowRenderDivisions = ({ divisionData = "", handleEditObject = () => { }, handleDeleteObject = () => { }, workFlowData = {}, setWorkFlowData = () => { } }) => {
    return (
        <ActionPanel
            key={divisionData + "DIVISION"}
            action={divisionData}
            onDelete={() => handleDeleteObject(divisionData)}
            showDelete={true}
            borderColor="#1E5673"
            backgroundColor="#CFE8F3"
            icon={<Building size={22} color="#1E5673" />}
            title={divisionData}
        />
    )
}

export default WorkFlowRenderDivisions;