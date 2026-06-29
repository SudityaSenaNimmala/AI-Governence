import React, { useEffect, useRef, useState } from "react";
import "./css/SearchComponents.css";
import { BsSearch } from "react-icons/bs";
import { IoCloseOutline } from "react-icons/io5";
import { getCFTextLoader } from "../Loaders/Loaders";

const SearchComponent = (props) => {
  const [currentVal, setCurrentVal] = useState(props?.defaultVal ?? null);
  const [isSearchOpen, setIsSearchOpen] = useState(props?.autoOpen ?? false);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    setCurrentVal("");
    setSearchSuggestions([]);
    // props?.onInputSearch({ searchInput: "" });
  }, [isSearchOpen]);

  const heandleSearchInput = (name, value) => {
    setCurrentVal(value);
    props?.onInputSearch({ [name]: value });
  };

  useEffect(() => {
    if (window.location.host?.includes("blogs") || props?.canResetDefaultVal) {
      if (props?.defaultVal !== undefined) {
        setCurrentVal(props.defaultVal);
      }
    }
  }, [props?.defaultVal]);

  const selectSearchSuggestionsInput = (data) => {
    setCurrentVal(data);
    heandleSearchInput(props?.inputName ?? "searchInput", data);
    setSearchSuggestions([]);
  };

  useEffect(() => {
    // if (props?.suggestionsList?.length > 0) {
    setSearchSuggestions(props?.suggestionsList);
    // }
  }, [props?.suggestionsList]);

  return (
    <div
      style={
        isSearchOpen
          ? { ...props?.customStyles }
          : { ...props?.customButtonStyles }
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
            placeholder={props?.inputPlaceHolder}
            onChange={(e) => {
              setIsFocused(true);
              heandleSearchInput(e.target.name, e.target.value);
            }}
            autoComplete="off"
            ref={inputRef}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setTimeout(() => {
                setIsFocused(false);
              }, 300);
            }}
          />
          {props?.autoOpen ? (
            <div
              className={`cf_open_search_cta ${props?.hideSearch ? `cf_hide` : ``
                }`}
              style={{
                ...props?.customSearchButtonStyles,
              }}
            >
              <BsSearch />
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
          }}
        >
          <BsSearch />
        </div>
      ) : (
        ""
      )}
      {searchSuggestions?.length && isSearchOpen > 0 && isFocused ? (
        <div
          className="cf_search_suggestions_div"
          style={{ ...props?.suggestionsStyles }}
        >
          {searchSuggestions?.map((data) => {
            return (
              <div onClick={() => selectSearchSuggestionsInput(data)}>
                {data}
              </div>
            );
          })}
        </div>
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
  );
};

export default SearchComponent;
