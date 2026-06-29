const SaaSManageLicences = (props) => {
  const restrictHeaders = {
    noName: ["GOOGLE_WORKSPACE"],
  };
  return (
    <div
      className="cf_main_content_place_main CF_d-flex"
      style={{
        padding: "10px 0 0 0",
        flexDirection: "column",
        height: "fit-content",
        overflow: "auto",
      }}
    >
      <div className="cf_new_tables_div" style={{ height: "fit-content" }}>
        <table>
          <thead>
            <tr>
              {/* <th style={{ width: "5%", textAlign: "center" }}></th> */}
              {!restrictHeaders?.noName?.includes(props?.vendorName) && (
                <th style={{ width: "35%", textAlign: "left" }}>Name</th>
              )}
              <th style={{ width: "60%", textAlign: "left" }}>Email</th>
            </tr>
          </thead>
          <tbody>
            {props?.usersList?.map((user) => (
              <tr>
                {/* <td></td> */}
                {!restrictHeaders?.noName?.includes(props?.vendorName) && (
                  <td style={{ fontWeight: "500" }}>{user?.displayName}</td>
                )}
                <td style={{ fontWeight: "500", textAlign: "left" }}>
                  {props?.vendorName === "GOOGLE_WORKSPACE"
                    ? user
                    : user?.email ?? "-"}
                </td>
              </tr>
            ))}
            {props?.usersList?.length === 0 && (
              <tr>
                <td
                  colSpan={2}
                  style={{
                    textAlign: "center",
                    fontWeight: "600",
                    color: "#64748b",
                  }}
                >
                  No {props?.type} found...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SaaSManageLicences;
