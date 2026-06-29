import { Building } from "lucide-react";
import ActionPanel from "../../NewFlow/components/ActionPanel";
import WorkFlowAddAction from "./WorkFlowAddAction";

const RenderWorkFlow = ({ id = "default", action, handleDrop, addActions, isWaitingForDragging, dull, dark, handleDelete = () => { }, flowVisibleActions = () => { }, isVisible = true, type = "DEPARTMENT" }) => {
    return (
        <div id={id}>
            <ActionPanel
                isVisible={isVisible}
                flowVisibleActions={flowVisibleActions}
                key={action + "DEPARTMENT"}
                action={action}
                onDelete={() => handleDelete(action)}
                icon={<Building size={20} color="#B2562B" />}
                showDelete={true}
                borderColor={dark || "#B2562B"}
                backgroundColor={dull || "#FFDFC8"}
                title={action}
                type={type}
            />
        </div>
    )
}

export default RenderWorkFlow;