import { useState } from "react";
import { getMaxChar } from "../../../../helpers/utils";
import { IoCloseOutline } from "react-icons/io5";

const DMSEmailFormat = (props) => {
  let { emailList, dmName } = { ...props };
  const [emailsListState, setEmailsListState] = useState([]);
  return (
    <>
      <div className="CF_d-flex ai-center" style={{ gap: "15px" }}>
        <div>
          <span className="cf_mapping_email">
            {getMaxChar(emailList?.split(",")[0], 35)}
          </span>
          {emailList?.split(",").length > 1 ? (
            <span className="cf_mapping_email">
              , {getMaxChar(emailList?.split(",")[1], 35)}
            </span>
          ) : (
            ""
          )}
        </div>
        {emailList?.split(",").length > 2 &&
        emailList?.split(",").length - 3 !== 0 ? (
          <div
            className="CF_Pointer CF_View_Emails_CTA CF_d-flex ai-center"
            onClick={() => setEmailsListState(emailList.split(","))}
          >
            +{emailList?.split(",").length - 3}
          </div>
        ) : (
          ""
        )}
      </div>
      {emailsListState?.length > 0 ? (
        <div className="CF_POPUP_CONTAINER">
          <div className="CF_POPUP_CONTAINER_DMS_EMAILS_BODY">
            <div className="CF_POPUP_CONTAINER_DMS_EMAILS_BODY_TITLE">
              <p title={dmName}>{getMaxChar(dmName, 50)} Users List</p>
              <span style={{ marginLeft: "auto" }}></span>
              <IoCloseOutline onClick={() => setEmailsListState([])} />
            </div>
            <div className="CF_POPUP_CONTAINER_DMS_EMAILS_BODY_BODY">
              <table className="cf_message_table">
                <thead>
                  <tr>
                    <th style={{ width: "2%" }}>S.No</th>
                    <th style={{ width: "98%" }}>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {emailsListState?.map((data, index) => {
                    return data ? (
                      <tr key={data}>
                        <td>{index + 1}</td>
                        <td>{data}</td>
                      </tr>
                    ) : (
                      ""
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        ""
      )}
    </>
  );
};

export default DMSEmailFormat;
