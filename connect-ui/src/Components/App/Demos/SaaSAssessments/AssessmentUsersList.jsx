import { useState } from "react";
import SaaSAssessmentCandidates from "./SaaSAssessmentCandidates";
import Popup from "../../../Resuables/Popup/Popup";

const AssessmentUsersList = ({
  assessmentId,
  assessmentName,
  setSelectedAssessment,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  return (
    <Popup
      options={{
        isOpen: isVisible,
        title: `${assessmentName} Assessment Respondents`,
        popupWidth: "calc(100% - 80px)",
        type: "side",
        popupHeight: "calc(100% - 00px)",
        popupTop: "0px",
        maxHeight: "100%",
        overflowY: "auto",
        titleCustomStyles: {
          fontSize: "16px",
          fontWeight: "600",
        },
        parentStyles: {
          justifyContent: "flex-end",
        },
      }}
      toggleOpen={setSelectedAssessment}
    >
      <div style={{ width: "100%", height: "100%", padding: "0 10px" }}>
        <SaaSAssessmentCandidates
          assessmentId={assessmentId}
          assessmentName={assessmentName}
        />
      </div>
    </Popup>
  );
};

export default AssessmentUsersList;
