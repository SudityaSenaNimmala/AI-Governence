import { Building } from "lucide-react";
import "./css/OrgSelector.css";
import { FaCaretDown } from "react-icons/fa6";
import { useEffect, useRef, useState } from "react";

const OrgSelector = ({ orgList, handleOrgChange }) => {
  const [isDropDownOpen, setIsDropDownOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [newOrgList, setNewOrgList] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (orgList && orgList.length > 0) {
      const reordered = [
        ...orgList.filter((item) => item.organization === "ALL"),
        ...orgList.filter((item) => item.organization !== "ALL"),
      ];
      setNewOrgList(reordered);
      reordered.forEach((org) => {
        if (org?.organization === "ALL") {
          setSelectedOrg(org);
          handleOrgChange(org);
        }
      });
    }
  }, [orgList]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsDropDownOpen(false);
        setSearchQuery("");
      }
    };
    if (isDropDownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropDownOpen]);

  const filteredList = newOrgList.filter((item) =>
    item?.organization?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      ref={containerRef}
      className={`cf_org_selector_container${isDropDownOpen ? " cf_org_selector_open" : ""}`}
      onClick={() => setIsDropDownOpen((prev) => !prev)}
    >
      <div className="cf_org_selector_container_header">
        <Building size={14} strokeWidth={2} color="#64748b" />
        <p>{selectedOrg?.organization}</p>
        <span className="cf_ml_auto"></span>
        <FaCaretDown
          size={16}
          color="#64748b"
          className={`cf_org_selector_caret${isDropDownOpen ? " cf_org_selector_caret_open" : ""}`}
        />
      </div>
      {isDropDownOpen && (
        <div
          className="cf_org_selector_container_dropDown"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cf_org_selector_search">
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="cf_org_selector_list">
            {filteredList.length > 0 ? (
              filteredList.map((data) =>
                data?.organization ? (
                  <div
                    className="cf_org_selector_container_header"
                    key={data?.organization}
                    onClick={() => {
                      setSelectedOrg(data);
                      setIsDropDownOpen(false);
                      setSearchQuery("");
                      handleOrgChange(data);
                    }}
                  >
                    <Building size={14} strokeWidth={2} color="#64748b" />
                    <p title={data?.organization}>{data?.organization}</p>
                  </div>
                ) : null
              )
            ) : (
              <p className="cf_org_selector_no_results">No results found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OrgSelector;
