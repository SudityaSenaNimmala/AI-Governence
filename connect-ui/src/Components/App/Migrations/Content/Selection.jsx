import React, { useContext, useMemo } from "react";
import { GlobalContext } from "../../../../GlobalContext/GlobalContext";
import {
    SET_SELECTED_DESTINATION_CLOUD,
    SET_SELECTED_SOURCE_CLOUD,
} from "../../../../GlobalContext/action.types";
import {
    cloudImageMapper,
    collaboratorsCloudsList,
    contenCloudsList,
    emailMigrationCloudsList,
} from "../../../helpers/helpers";
import "./css/Selection.css";

const formatAccountName = (email = "") => {
    const local = email.split("@")[0] || "";
    return local
        .split(/[._-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
};

const getAccountMeta = (account) => {
    const email = account?.emailId || account?.adminEmail || "";
    const subtext = email.includes("@") ? email.split("@")[1] : account?.domainName || "";
    const name =
        account?.name?.trim() ||
        account?.displayName?.trim() ||
        formatAccountName(email) ||
        "—";

    return { name, subtext };
};

const SelectionCard = ({ title, accounts, selectedId, inputName, onSelect }) => {
    return (
        <div className="cf_content_selection_card">
            <div className="cf_content_selection_card_header">
                <span>{title}</span>
            </div>
            <div className="cf_content_selection_card_body">
                {accounts?.length > 0 ? (
                    accounts.map((account, index) => {
                        const { name, subtext } = getAccountMeta(account);
                        const isSelected = selectedId === account?.id;

                        return (
                            <label
                                key={`${inputName}_${account?.id ?? index}`}
                                className={`cf_content_selection_row ${index % 2 === 0
                                    ? "cf_content_selection_row_even"
                                    : "cf_content_selection_row_odd"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name={inputName}
                                    checked={isSelected}
                                    onChange={() => onSelect(account)}
                                />
                                <div className="cf_mapping_table_cloudIcon">
                                    <img
                                        src={cloudImageMapper(account?.cloudName ?? account?.providerName)}
                                        alt={account?.cloudName ?? account?.providerName}
                                    />
                                </div>
                                <div className="cf_content_selection_row_text">
                                    <span className="cf_content_selection_row_name">{name}</span>
                                    {subtext ? (
                                        <span className="cf_content_selection_row_subtext">{subtext}</span>
                                    ) : null}
                                </div>
                            </label>
                        );
                    })
                ) : (
                    <div className="cf_content_selection_empty">No accounts available</div>
                )}
            </div>
        </div>
    );
};

const Selection = ({ type = "CONTENT" }) => {
    const { globalContext, dispatch } = useContext(GlobalContext);

    const contentAccounts = useMemo(
        () =>
            (globalContext?.cloudsList || []).filter((cloud) => {
                if (type === "CONTENT") {
                    contenCloudsList.includes(cloud?.providerName)
                }
                if (type === "MESSAGE") {
                    collaboratorsCloudsList.includes(cloud?.providerName)
                }
                if (type === "EMAIL") {
                    emailMigrationCloudsList.includes(cloud?.providerName)
                }
            }),
        [globalContext?.cloudsList, type]
    );

    const handleSourceSelect = (account) => {
        dispatch({ type: SET_SELECTED_SOURCE_CLOUD, payload: account });
    };

    const handleDestinationSelect = (account) => {
        dispatch({ type: SET_SELECTED_DESTINATION_CLOUD, payload: account });
    };

    return (
        <div className="cf_content_selection_placer">
            <SelectionCard
                title="Select Source"
                accounts={contentAccounts}
                selectedId={globalContext?.sourceCloud?.id}
                inputName="content_source_selection"
                onSelect={handleSourceSelect}
            />
            <div className="cf_content_selection_flow" aria-hidden="true">
                <span className="cf_content_selection_flow_chevron">&gt;</span>
                <span className="cf_content_selection_flow_chevron">&gt;</span>
                <span className="cf_content_selection_flow_chevron">&gt;</span>
            </div>
            <SelectionCard
                title="Select Destination"
                accounts={contentAccounts}
                selectedId={globalContext?.destinationCloud?.id}
                inputName="content_destination_selection"
                onSelect={handleDestinationSelect}
            />
        </div>
    );
};

export default Selection;
