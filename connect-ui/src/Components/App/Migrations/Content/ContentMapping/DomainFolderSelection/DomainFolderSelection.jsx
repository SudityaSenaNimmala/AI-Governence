import React from "react";
import { MdOutlineAdd } from "react-icons/md";

const DomainFolderSelection = (props) => {
    
  return (
    <div className="cf_mapping_domain" key={`SRC_${data?.domainName}`}>
      <span className="CF_d-flex CF_Pointer">
        <MdOutlineAdd className="CF_SVG_THICK" />
      </span>
      <span className="cf_mapping_domain_name">{data?.domainName}</span>
    </div>
  );
};

export default DomainFolderSelection;
