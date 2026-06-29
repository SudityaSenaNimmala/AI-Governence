import { User } from "lucide-react";
import ActionPanel from "../../NewFlow/components/ActionPanel";

const WorkFlowRenderRoles = ({ roleData = "", handleEditObject = () => { }, handleDeleteObject = () => { }, workFlowData = {}, setWorkFlowData = () => { } }) => {
    return (
        <ActionPanel
            key={roleData + "APPLICATION"}
            action={roleData}
            onDelete={() => handleDeleteObject(roleData)}
            showDelete={true}
            borderColor="#5A2E8A"
            backgroundColor="#E8D9FF"
            icon={<User size={22} color="#5A2E8A" />}
            title={roleData}
        />
    )
}

export default WorkFlowRenderRoles;