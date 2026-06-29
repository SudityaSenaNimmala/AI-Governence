import React, { useContext, useEffect, useState } from "react";
import { TfiAngleRight, TfiAngleLeft } from "react-icons/tfi";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { Link, useNavigate } from "react-router-dom";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import { initiateMigration } from "./ContentActions/ContentActions";
import { notifyToast } from "../../../helpers/utils";

const EmailBreadCrumb = (props) => {
  const navigation = useNavigate();
  const { globalContext } = useContext(GlobalContext);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [teamMigration, setTeamMigration] = useState({
    atPosition: 2,
    previousPosition: 0,
    nextPosition: 2,
  });

  const changeState = (action) => {
    let currentPosition = teamMigration?.atPosition,
      lastPosition = teamMigration?.atPosition;
    switch (action) {
      case "BACK":
        currentPosition -= 1;
        break;
      case "NEXT":
        currentPosition < 5 ? (currentPosition += 1) : "";
        break;
      default:
        break;
    }
    setTeamMigration({
      ...teamMigration,
      atPosition: currentPosition,
      previousPosition: lastPosition,
      nextPosition: lastPosition + 1,
    });
    props.contentState({
      atPosition: currentPosition,
      previousPosition: lastPosition,
      nextPosition: lastPosition + 1,
    });
  };

  useEffect(() => {
    if (teamMigration?.atPosition === 5) {
      setIsPageLoading(true);
      letsMigrate();
    }
  }, [teamMigration?.atPosition]);

  const letsMigrate = async () => {
    let res = await initiateMigration(globalContext?.jobDetails?.id);
    if (res?.status === "OK") {
      notifyToast("success", "Migration Initiated Successfully...");
      setTimeout(() => {
        navigation("/Reports/Content");
      }, 500);
    } else {
      notifyToast("error", "Failed to initate migration");
    }
  };

  return (
    <>
      <div className="CF_TEAM_BREAD_CRUMBS_DIV">
        <ul className="CF_TEAM_BREAD_CRUMBS">
          <li
            className={`${teamMigration.atPosition === 1 ? "breadCrumbeActive" : ""
              }${teamMigration.atPosition > 1 ? "breadCrumbeActive-Completed" : ""
              }`}
          >
            <div className="breadCrumbs-Div">
              <span className="breadCrumbCount">1</span>
              <span className="breadCrumbName">Selection</span>
              <span className="chevron">
                {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
              </span>
            </div>
          </li>
          <li
            className={`${teamMigration.atPosition === 2 ? "breadCrumbeActive" : ""
              }${teamMigration.atPosition > 2 ? "breadCrumbeActive-Completed" : ""
              }`}
          >
            <div className="breadCrumbs-Div">
              <span className="breadCrumbCount">2</span>
              <span className="breadCrumbName">Mapping</span>
              <span className="chevron">
                {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
              </span>
            </div>
          </li>
          <li
            className={`${teamMigration.atPosition === 3 ? "breadCrumbeActive" : ""
              }${teamMigration.atPosition > 3 ? "breadCrumbeActive-Completed" : ""
              }`}
          >
            <div className="breadCrumbs-Div">
              {/* <span className="CF_TEAM_Chevron_Before">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span> */}
              <span className="breadCrumbCount"> 3</span>
              <span className="breadCrumbName">Permission Mapping</span>
              <span className="chevron">
                {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
              </span>
            </div>
          </li>
          <li
            className={`${teamMigration.atPosition === 4 ? "breadCrumbeActive" : ""
              }${teamMigration.atPosition > 4 ? "breadCrumbeActive-Completed" : ""
              }`}
          >
            <div className="breadCrumbs-Div">
              {/* <span className="CF_TEAM_Chevron_Before">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span> */}
              <span className="breadCrumbCount">4</span>
              <span className="breadCrumbName"> Options</span>
              <span className="chevron">
                {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
              </span>
            </div>
          </li>
          <li
            className={`${teamMigration.atPosition === 5 ? "breadCrumbeActive" : ""
              }${teamMigration.atPosition > 5 ? "breadCrumbeActive-Completed" : ""
              }`}
          >
            <div className="breadCrumbs-Div">
              {/* <span className="CF_TEAM_Chevron_Before">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span> */}
              <span className="breadCrumbCount">5</span>
              <span className="breadCrumbName">Migration</span>
              <span className="chevron">
                {/* <AiFillCaretRight className="CF_TEAM_Chevron_Icon" /> */}
              </span>
            </div>
          </li>
        </ul>
      </div>
      <div className="CT_TEAM_BreadCrumbs_Buttons">
        {teamMigration?.atPosition === 1 ? (
          <Link to="/Migrations" style={{ textDecoration: "none" }}>
            <ButtonComponent
              isDisabled={
                teamMigration?.atPosition === 1}
              inputWidth="auto"
              customstyles={{ padding: "0 10px", height: "35px" }}
              buttonName="Previous"
              buttonClickAction={() => changeState("BACK")}
            >
              <TfiAngleLeft />
            </ButtonComponent>
          </Link>
        ) : (
          <ButtonComponent
            inputWidth="auto"
            customstyles={{ padding: "0 10px", height: "35px" }}
            buttonName="Previous"
            buttonClickAction={() => changeState("BACK")}
          >
            <TfiAngleLeft />
          </ButtonComponent>
        )}
        <ButtonComponent
          // isDisabled={
          //   teamMigration?.atPosition === 1 &&
          //   !globalContext?.mappedPairs?.length > 0
          // }
          inputWidth="auto"
          customstyles={{ padding: "0 10px", height: "35px" }}
          buttonName=""
          buttonClickAction={() => changeState("NEXT")}
        >
          <span>
            {teamMigration?.atPosition === 4 || teamMigration?.atPosition === 5
              ? "Start Migration"
              : "Next"}
          </span>
          <TfiAngleRight />
        </ButtonComponent>
      </div>
      {isPageLoading ? getCFLoader() : ""}
    </>
  );
};

export default EmailBreadCrumb;
