import React, { useState } from "react";
import { TfiAngleRight, TfiAngleLeft } from "react-icons/tfi";
import { AiFillCaretRight } from "react-icons/ai";
import ButtonComponent from "../../../Resuables/InputsComponents/ButtonComponent";
import { Link } from "react-router-dom";

const BoardBreadCrumbs = () => {
  const [teamMigration, setTeamMigration] = useState({
    atPosition: 1,
  });

  const changeState = (action) => {
    let currentPosition = teamMigration?.atPosition;
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
    });
    props.contentState({
      atPosition: currentPosition,
    });
  };

  return (
    <>
      <div className="CF_TEAM_BREAD_CRUMBS_DIV">
        <ul className="CF_TEAM_BREAD_CRUMBS">
          <li
            className={`${
              teamMigration.atPosition === 1 ? "breadCrumbeActive" : ""
            }${
              teamMigration.atPosition > 1 ? "breadCrumbeActive-Completed" : ""
            }`}
          >
            <div className="breadCrumbs-Div">
              <span className="breadCrumbCount">1</span>
              <span className="breadCrumbName">Pre-Migration</span>
              <span className="CF_TEAM_Chevron">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span>
            </div>
          </li>
          <li
            className={`${
              teamMigration.atPosition === 2 ? "breadCrumbeActive" : ""
            }${
              teamMigration.atPosition > 2 ? "breadCrumbeActive-Completed" : ""
            }`}
          >
            <div className="breadCrumbs-Div">
              <span className="CF_TEAM_Chevron_Before">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span>
              <span className="breadCrumbCount"> 2</span>
              <span className="breadCrumbName">Mapping</span>
              <span className="CF_TEAM_Chevron">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span>
            </div>
          </li>
          <li
            className={`${
              teamMigration.atPosition === 3 ? "breadCrumbeActive" : ""
            }${
              teamMigration.atPosition > 3 ? "breadCrumbeActive-Completed" : ""
            }`}
          >
            <div className="breadCrumbs-Div">
              <span className="CF_TEAM_Chevron_Before">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span>
              <span className="breadCrumbCount">3</span>
              <span className="breadCrumbName"> Options</span>
              <span className="CF_TEAM_Chevron">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span>
            </div>
          </li>
          <li
            className={`${
              teamMigration.atPosition === 4 ? "breadCrumbeActive" : ""
            }${
              teamMigration.atPosition > 4 ? "breadCrumbeActive-Completed" : ""
            }`}
          >
            <div className="breadCrumbs-Div">
              <span className="CF_TEAM_Chevron_Before">
                <AiFillCaretRight className="CF_TEAM_Chevron_Icon" />
              </span>
              <span className="breadCrumbCount">4</span>
              <span className="breadCrumbName">Migrate</span>
            </div>
          </li>
        </ul>
      </div>
      <div className="CT_TEAM_BreadCrumbs_Buttons">
        {teamMigration?.atPosition === 1 ? (
          <Link to="/Migrations" style={{ textDecoration: "none" }}>
            <ButtonComponent
              inputWidth="auto"
              customstyles={{ padding: "0 10px" }}
              buttonName="Previous"
              buttonClickAction={() => changeState("BACK")}
            >
              <TfiAngleLeft />
            </ButtonComponent>
          </Link>
        ) : (
          <ButtonComponent
            inputWidth="auto"
            customstyles={{ padding: "0 10px" }}
            buttonName="Previous"
            buttonClickAction={() => changeState("BACK")}
          >
            <TfiAngleLeft />
          </ButtonComponent>
        )}
        <ButtonComponent
          inputWidth="auto"
          customstyles={{ padding: "0 10px" }}
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
    </>
  );
};

export default BoardBreadCrumbs;
