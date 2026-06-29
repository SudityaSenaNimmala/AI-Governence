// import React from "react";
// import { axiosRequest } from "../helpers/apiRequest";
// import axios from "axios";

// const ApiTesting = () => {
//   const { CancelToken } = axios;
//   let token;
//   const sendApiRequest = () => {
//     token = CancelToken.source();
//     // token.cancel();
//     axiosRequest(
//       {
//         path: `/testing?time=${Math.round(Math.random() * 10)}`,
//         method: "GET",
//       },
//       token.token
//     ).then((res) => {});
//   };

//   return (
//     <div style={{ padding: "50px" }}>
//       <button
//         style={{ height: "40px", padding: "0 10px" }}
//         onClick={() => {
//           sendApiRequest();
//         }}
//       >
//         Send Request
//       </button>
//       <button
//         style={{ height: "40px", padding: "0 10px", marginLeft: "50px" }}
//         onClick={() => token.cancel()}
//       >
//         Cancel Request
//       </button>
//     </div>
//   );
// };

import React, { useEffect, useState } from "react";
import SvgName from "./SvgName";
import CustomToolTip from "../Resuables/CustomToolTip/CustomToolTip";
// import { Virtuoso } from "react-virtuoso";

const ApiTesting = () => {
  const [logo, setLogo] = useState("");

  useEffect(() => {
    setLogo(<SvgName name="Giridhar Krishna" />);
  }, []);

  let data = {
    id: "6411b1c63ae473c5a2fd67a2",
    type: null,
    activeCount: 10,
    pickLimitCountPerMessageWS: 10,
    stopFolderPick: false,
    pickLimitCountPerWS: 10,
    pickConflictFolders: 100,
    noFoldersInBatch: 40,
    stopTrackingChangesCounter: 20,
    pickLimitCountPermissionPerWS: 10,
    pickLimitCountHyperLinkPerWS: 3,
    stopSourceHyperLink: false,
    stopDestHyperLink: true,
    stopSourcePathLink: false,
    stopDestPathLink: false,
    onlyPickDestExist: true,
    stopInvitePermission: false,
    stopClosingAndSharing: false,
  };
  return (
    <div>
      {/* {logo} */}
      <div style={{ marginTop: "150px", marginLeft: "300px" }}>
        <CustomToolTip title="CloudFuze APP" />
      </div>
      <CustomToolTip title="CloudFuze APP" />
      <div
        style={{
          marginTop: "300px",
          marginLeft: "1400px",
          // position: "absolute",
          bottom: "0",
        }}
      >
        <CustomToolTip title="CloudFuze APP" />
      </div>
      <div
        style={{
          marginTop: "100px",
          marginLeft: "300px",
          // position: "absolute",
          bottom: "0",
        }}
      >
        <CustomToolTip title="CloudFuze APP" />
      </div>

      {/* <table>
        <tbody>
          {Object.keys(data)?.map((res) => {
            return res !== "id" && typeof data[res] !== "object" ? (
              <tr>
                <td>{res}</td>
                <td>{data[res].toString()}</td>
              </tr>
            ) : (
              ""
            );
          })}
        </tbody>
      </table> */}
    </div>
  );
};
// const ApiTesting = () => {
//   let data = JSON.parse(localStorage.globalState)?.resourceAppsList;
//   return (
//     <div
//       style={{
//         height: "100%",
//         width: "100%",
//       }}
//     >
//       <Virtuoso
//         style={{
//           height: "100%",
//           width: "100%",
//           display: "grid",
//           gridTemplateAreas: "a a a a",
//         }}
//         data={data}
//         // initialItemCount={1000}
//         itemContent={(_, data) => (
//           <div
//             style={{
//               width: "20%",
//               padding: "0.5rem",
//               height: `100px`,
//             }}
//           >
//             <div>
//               <div>
//                 <div></div>
//               </div>
//               <div>
//                 <p className="cf_mapping_email">{data?.appName}</p>
//                 <p className="cf_mapping_email">{data?.signIn}</p>
//               </div>
//             </div>
//           </div>
//         )}
//       />
//     </div>
//   );
// };
export default ApiTesting;
