import { Plus } from "lucide-react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";

const WorkFlowAddAction = ({
    isWaitingForDragging = false,
    handleDrop = (e) => { },
    addAction = (action) => { },
    customClass = "",
    marginTop = "60px"
}) => {
    return (
        <>
            {isWaitingForDragging ? (
                <div
                    className="cf_newFlow_trigger_pannel cf_action_trigger_dottedParent cf_action_drop_pannel ${customClass}"
                    style={{
                        marginTop: marginTop,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                >
                    <p>
                        Drag and drop here
                    </p>
                </div>
            ) : (
                <div className={`cf_action_trigger cf_action_triggerV3 ${customClass}`} style={{ marginTop: marginTop }}>
                    <ActionButton
                        customClass="changeButtonColorOnHover cf_newBox_Shadow"
                        customStyles={{
                            backgroundColor: "#fff",
                            height: "35px",
                            width: "35px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "50%",
                        }}
                        buttonType="button"
                        isDisabled={false}
                        buttonClickAction={() => {
                            addAction();
                        }}
                    >
                        <Plus size={16} />
                    </ActionButton>
                </div>
            )}</>
    )
}

export default WorkFlowAddAction;