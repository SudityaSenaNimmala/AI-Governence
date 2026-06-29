import React, { useEffect, useRef, useState } from "react";
import "./css/SearchComponents.css";
import { BsSearch } from "react-icons/bs";
import { IoCloseOutline } from "react-icons/io5";
import { getCFTextLoader } from "../Loaders/Loaders";
import { FaCaretDown } from "react-icons/fa6";
import { cloudImageMapper, getCloudName } from "../../helpers/helpers";

const SearchComponentDropDown = (props) => {
  const [currentVal, setCurrentVal] = useState(props?.defaultVal ?? null);
  const [isSearchOpen, setIsSearchOpen] = useState(props?.autoOpen ?? false);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isSearchOpen) {
      setCurrentVal("");
      setSearchSuggestions([]);
      setIsFocused(false);
      setIsSuggestionsOpen(false);
    }
  }, [isSearchOpen]);

  const heandleSearchInput = (name, value) => {
    setCurrentVal(value);
    props?.onInputSearch({ [name]: value });
  };

  const selectSearchSuggestionsInput = (data) => {
    setCurrentVal(data);
    heandleSearchInput(props?.inputName ?? "searchInput", data);
    setSearchSuggestions([]);
    setIsSuggestionsOpen(false);
    setIsFocused(false);
  };

  const openSuggestionsDropdown = (e) => {
    e?.preventDefault?.();
    setIsSearchOpen(true);
    setIsFocused(true);
    setIsSuggestionsOpen(true);
    setSearchSuggestions(props?.suggestionsList ?? []);
    inputRef.current?.focus();
  };

  useEffect(() => {
    // if (props?.suggestionsList?.length > 0) {
    setSearchSuggestions(props?.suggestionsList);
    // }
  }, [props?.suggestionsList]);

  useEffect(() => {
    if (props?.defaultVal) {
      setCurrentVal(props?.defaultVal);
    }
  }, [props?.defaultVal]);

  return (
    <>
      <div
        style={
          isSearchOpen
            ? { ...props?.customStyles }
            : { ...props?.customButtonStyles }
        }
      >
        <div
          style={
            isSearchOpen
              ? {
                ...props?.customStyles,
                border: "1px solid #acacac",
                width: "100%",
              }
              : {
                ...props?.customButtonStyles,
                border: "1px solid #acacac",
                width: "100%",
              }
          }
          className={`cf_search_container ${isSearchOpen ? `cf_open_search_container` : ""
            }`}
        >
          {isSearchOpen ? (
            <>
              <input
                type="text"
                className="cf_open_search_input"
                value={currentVal ?? ""}
                name={props?.inputName ?? "searchInput"}
                autoFocus={props?.autoFocus}
                // onFocus={(e) => e.target.setSelectionRange(0, 0)}
                onChange={(e) => {
                  setIsFocused(true);
                  setIsSuggestionsOpen(true);
                  heandleSearchInput(e.target.name, e.target.value);
                }}
                autoComplete="off"
                ref={inputRef}
                onFocus={() => {
                  setIsFocused(true);
                  setIsSuggestionsOpen(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    setIsFocused(false);
                    setIsSuggestionsOpen(false);
                  }, 300);
                }}
              />
              <label
                htmlFor={props?.inputPlaceHolder ?? "Text"}
                className="cf_input_lable"
              >
                {props?.inputPlaceHolder ?? "Text"}
              </label>
              {props?.autoOpen ? (
                <div
                  className={`cf_open_search_cta ${props?.hideSearch ? `cf_hide` : ``
                    }`}
                  onMouseDown={openSuggestionsDropdown}
                >
                  <FaCaretDown />
                </div>
              ) : (
                <div
                  className={`cf_open_search_cta ${props?.hideSearch ? `cf_hide` : ``
                    }`}
                  onClick={() => {
                    heandleSearchInput(props?.inputName ?? "searchInput", "");
                    setIsSearchOpen(!isSearchOpen);
                  }}
                >
                  {isSearchOpen ? (
                    <IoCloseOutline
                      style={{ fontSize: "18px", color: "#0062ff" }}
                    />
                  ) : (
                    ""
                  )}
                </div>
              )}
            </>
          ) : (
            ""
          )}
          {!isSearchOpen ? (
            <div
              className={`cf_close_search_cta ${props?.hideSearch ? `cf_hide` : ``
                }`}
              onClick={() => {
                setIsSearchOpen(true);
                setIsFocused(true);
                setIsSuggestionsOpen(true);
                setSearchSuggestions(props?.suggestionsList ?? []);
              }}
            >
              <BsSearch />
            </div>
          ) : (
            ""
          )}
          {searchSuggestions?.length &&
          isSearchOpen &&
          (isFocused || isSuggestionsOpen) ? (
            <>
              {props?.addNewOption || props?.isCloudsList ? (
                <div
                  className="cf_search_suggestions_new_Options_div"
                  style={{
                    ...props?.suggestionsStyles,
                    maxHeight: "200px",
                  }}
                >
                  <div className="cf_search_suggestions_new_Options_div_body">
                    {searchSuggestions?.map((data) => {
                      return (
                        <div
                          onClick={() => selectSearchSuggestionsInput(data)}
                          style={{ width: "100%", padding: "0", border: "0" }}
                        >
                          {props?.isCloudsList ? (
                            <>
                              <div
                                className="CF_d-flex ai-center"
                                style={{ gap: "10px", width: "100%" }}
                              >
                                {props?.canHaveIcons ? (
                                  <img
                                    src={cloudImageMapper(data)}
                                    alt="cloud"
                                    style={{ width: "15px" }}
                                  />
                                ) : (
                                  ""
                                )}
                                <p
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: "500",
                                  }}
                                >
                                  {getCloudName(data)}
                                </p>
                              </div>
                            </>
                          ) : (
                            data
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div
                    className="new_other_option"
                    onClick={() => {
                      setIsFocused(false);
                      setIsSuggestionsOpen(false);
                      props?.onInputSearch({ searchInput: "OTHERS" });
                    }}
                  >
                    {props?.newOptionText ?? "+ New Vendor"}
                  </div>
                </div>
              ) : (
                <div
                  className="cf_search_suggestions_div"
                  style={{ ...props?.suggestionsStyles }}
                >
                  {searchSuggestions?.map((data) => {
                    return (
                      <div onClick={() => selectSearchSuggestionsInput(data)}>
                        {props?.isCloudsList ? getCloudName(data) : data}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            ""
          )}
          {props?.isSuggestionsLoading ? (
            <div
              className="cf_search_suggestions_div"
              style={{ ...props?.suggestionsStyles }}
            >
              <div>{getCFTextLoader()}</div>
            </div>
          ) : (
            ""
          )}
        </div>
        {props?.errorData ? (
          <span className="errorText">{props?.errorData}</span>
        ) : (
          ""
        )}
      </div>
    </>
  );
};

export default SearchComponentDropDown;
