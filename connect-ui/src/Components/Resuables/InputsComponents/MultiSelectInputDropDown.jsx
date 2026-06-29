import { useEffect, useRef, useState } from "react";
import { getCFTextLoader } from "../Loaders/Loaders";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";
import { globalDebounce } from "../../helpers/utils";

const MultiSelectInputDropDown = ({
  childrenStyle = {},
  parentStyle = {},
  options = {},
  suggestedData = [],
  displayFields = [],
  loadAction = async () => { },
  handleSelection = () => { },
  selectedData = [],
  isCloudsList = false,
  searchAction = async () => { },
}) => {
  const [loadedData, setLoadedData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    if (suggestedData?.length > 0) {
      setLoadedData(suggestedData);
    }
  }, [suggestedData]);

  useEffect(() => {
    if (isSearchOpen) {
      getLoadedData();
    }
  }, [isSearchOpen]);

  const getLoadedData = async () => {
    const res = await loadAction();
    if (res) {
      setIsLoading(false);
    }
    setSearchValue("");
  };

  const handleSelectChanges = (e, data, action, type) => {
    handleSelection(e, data, action, type);
  };


  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsSearchOpen(false);
      }
    };
    if (isSearchOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSearchOpen]);

  const searchDebounce = useRef(null);
  const searchWithThrottle = async (searchValue) => {
    if (searchDebounce.current) {
      clearInterval(searchDebounce.current);
    }

    if (searchValue.length > 0) {
      searchDebounce.current = setTimeout(async () => {
        const res = await searchAction(searchValue);
        if (res) {
          setIsLoading(false);
        } else {
          setIsLoading(false);
        }
      }, 500);
    } else {
      setIsLoading(true);
      loadAction();
      setIsLoading(false);
    }
  };


  return (
    <div
      ref={containerRef}
      className="cf_multi_select_input_dropdown_container"
      style={{ ...parentStyle }}
    >
      <div
        className="cf_multi_select_input_dropdown_container_name"
        style={{ gap: "10px", cursor: "pointer" }}
        onClick={() => setIsSearchOpen((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setIsSearchOpen((prev) => !prev)}
      >
        {selectedData?.length > 0 ? (
          <>
            {isCloudsList ? (
              <img
                src={cloudImageMapper(selectedData[0]["providerName"])}
                alt="cloud"
                style={{ width: "20px", height: "20px", objectFit: "contain" }}
              />
            ) : (
              ""
            )}{" "}
            {options?.inputType === "radio" ? (
              <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={isCloudsList
                  ? getCloudName(selectedData[0][displayFields[0]])
                  : selectedData[0]
                    ? selectedData[0][displayFields[0]]
                    : ""}
              >
                {isCloudsList
                  ? getCloudName(selectedData[0][displayFields[0]])
                  : selectedData[0]
                    ? selectedData[0][displayFields[0]]
                    : ""}
              </p>
            ) : options?.inputType === "checkbox" ? (
              <p>{selectedData?.length} selected</p>
            ) : (
              ""
            )}
          </>
        ) : (
          <p className="cf_sub_heading">{options?.name || "Select"}</p>
        )}
      </div>
      {isSearchOpen && (
        <div
          className="cf_multi_select_input_dropdown_input_search_suggestions"
          style={{ ...childrenStyle }}
        >
          <div style={{ padding: "5px" }}>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => {
                if (searchAction) {
                  setIsLoading(true);
                  setSearchValue(e.target.value);
                  searchWithThrottle(e.target.value)
                } else {
                  setSearchValue(e.target.value)
                }

              }}
              className="cf_multi_select_input_dropdown_input_search_suggestions_input"
              placeholder={
                options?.searchValue || `Search By ${options?.name || "Select"}`
              }
            />
          </div>
          <div className="cf_multi_select_input_dropdown_input_search_suggestions_items">
            {isLoading ? (
              <div className="cf_multi_select_input_dropdown_input_search_suggestions_item_suggest">
                {getCFTextLoader()}
              </div>
            ) : loadedData?.filter((data) => {
              if (isCloudsList) {
                return (data[displayFields[0]]
                  ?.toLowerCase()
                  .includes(searchValue?.toLowerCase()) || getCloudName(data?.providerName)?.toLowerCase()?.includes(searchValue?.toLowerCase()))
              } else {
                return (data[displayFields[0]]
                  ?.toLowerCase()
                  .includes(searchValue?.toLowerCase()))
              }
            })?.length === 0 ? (
              <div className="cf_multi_select_input_dropdown_input_search_suggestions_item_suggest">
                <p>No data found</p>
              </div>
            ) : (
              loadedData
                ?.filter((data) => {
                  if (isCloudsList) {
                    return (data[displayFields[0]]
                      ?.toLowerCase()
                      .includes(searchValue?.toLowerCase()) || getCloudName(data?.providerName)?.toLowerCase()?.includes(searchValue?.toLowerCase()))
                  } else {
                    return (data[displayFields[0]]
                      ?.toLowerCase()
                      .includes(searchValue?.toLowerCase()))
                  }
                })
                ?.map((data, index) => (
                  <div
                    key={data?.id || index}
                    className="cf_multi_select_input_dropdown_input_search_suggestions_item_suggest"
                  >
                    <input
                      type={options?.inputType || "checkbox"}
                      name={options?.inputName || ""}
                      onChange={(e) =>
                        handleSelectChanges(
                          e,
                          data,
                          options?.inputName,
                          options?.inputType
                        )
                      }
                      checked={
                        isCloudsList ?
                          selectedData[0]?.id === data?.id
                          :
                          selectedData?.length > 0 &&
                          selectedData[0]?.[displayFields[0]] ===
                          data[displayFields[0]]
                      }
                    />
                    {isCloudsList ? (
                      <img
                        src={cloudImageMapper(data["providerName"])}
                        alt="cloud"
                        style={{
                          width: "20px",
                          height: "20px",
                          objectFit: "contain",
                        }}
                      />
                    ) : (
                      ""
                    )}
                    {displayFields?.map((field) => (
                      <p title={data[field]} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} >
                        {isCloudsList ? getCloudName(data[field]) : data[field]}
                      </p>
                    ))}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelectInputDropDown;
