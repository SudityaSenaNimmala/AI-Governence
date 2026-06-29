import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import ActionButton from "../../../Resuables/InputsComponents/ActionButton";
import SearchComponent from "../../../Resuables/SearchComponent/SearchComponent";
import { getCFTextLoader } from "../../../Resuables/Loaders/Loaders";
import { getUniqueUsersList } from "../../Dashboard/DashboardActions/DashboardActions";
import { getVendorSearch } from "../../SaaSManagement/SaaSActions/SaaSActions";
import { notifyToast } from "../../../helpers/utils";

const SelectOffBoardUsers = ({ onClose, selectedUsersOffboarding, setSelectedUsersOffboarding }) => {
    const [userList, setUserList] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchInput, setSearchInput] = useState("");
    const [selectedUsersEmail, setSelectedUsersEmail] = useState([]);
    const [selectedUsers, setSelectedUsers] = useState([]);
    const [selectedUserMap, setSelectedUserMap] = useState({});
    const searchDebounce = useRef(null);



    useEffect(() => {
        setSearchInput("");
        setUserList([]);
        setSelectedUsersEmail([]);
        setSelectedUserMap({});
        getUserList();
    }, []);

    const getUserList = async () => {
        setIsLoading(true);
        const res = await getUniqueUsersList(1, 20, "ALL");
        if (res?.status === "OK") {
            setUserList(res?.res?.data ?? []);
        } else {
            notifyToast("error", "Failed to get user list");
        }
        setIsLoading(false);
    };

    const searchUsers = async (searchValue) => {
        setIsLoading(true);
        const res = await getVendorSearch(
            "UNIQUUSERSSEARCH",
            "unqusers",
            searchValue?.trim(),
            false,
            "ALL"
        );
        if (res?.status === "OK" && res?.res?.data?.length > 0) {
            setUserList(res?.res?.data);
        } else {
            setUserList([]);
        }
        setIsLoading(false);
    };

    const searchWithThrottle = (searchValue) => {
        if (searchDebounce.current) {
            clearTimeout(searchDebounce.current);
        }
        if (searchValue?.trim?.()?.length > 0) {
            searchDebounce.current = setTimeout(() => {
                searchUsers(searchValue);
            }, 500);
        } else {
            getUserList();
        }
    };

    const handleClose = (action) => {
        if (action === "SAVE") {
            setSelectedUsersOffboarding([...selectedUsersOffboarding, ...selectedUsers]);
        }
        if (typeof onClose === "function") {
            onClose();
        } else {
            const escapeEvent = new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true,
            });
            window.dispatchEvent(escapeEvent);
        }
    };

    const handleCheckboxChange = (user, checked) => {
        if (checked) {
            setSelectedUserMap((prev) => ({
                ...prev,
                [user?.email]: user?.vendorAdminCloudId?.length > 0
                    ? user?.vendorAdminCloudId[0]?.split(":")[1]
                    : null,
            }));
            setSelectedUsers((prev) => [...prev, user]);
            setSelectedUsersEmail((prev) => [...prev, user?.email]);
        } else {
            setSelectedUserMap((prev) => {
                const next = { ...prev };
                delete next[user?.email];
                return next;
            });
            setSelectedUsers((prev) => prev.filter((user) => user?.email !== user?.email));
            setSelectedUsersEmail((prev) => prev.filter((email) => email !== user?.email));
        }
    };


    return (
        <div
            style={{
                width: "30%",
                height: "100%",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "0",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
            }}
            className="cf_box_shadow"
        >
            <div
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderBottom: "1px solid #e2e8f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <p
                    style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        color: "#0f1729",
                        margin: 0,
                    }}
                >
                    Select Off Board Users
                </p>
                <ActionButton
                    buttonType="button"
                    customClass="CF_Pointer"
                    customStyles={{
                        width: "28px",
                        height: "28px",
                        padding: "0",
                        minWidth: "28px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "transparent",
                        border: "none",
                    }}
                    buttonClickAction={handleClose}
                >
                    <X size={18} color="#64748b" />
                </ActionButton>
            </div>

            <div
                style={{
                    width: "100%",
                    padding: "8px 12px",
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    minHeight: 0,
                    overflow: "hidden",
                }}
            >
                <div style={{ flexShrink: 0 }}>
                    <SearchComponent
                        defaultVal={searchInput}
                        autoOpen={true}
                        boxShadows={true}
                        inputName="searchInput"
                        inputPlaceHolder="Search by email"
                        customStyles={{
                            width: "100%",
                            height: "40px",
                        }}
                        onInputSearch={(e) => searchWithThrottle(e?.searchInput)}
                    />
                </div>
                <div
                    className="cf_new_tables_div"
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                    }}
                >
                    {isLoading ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
                            {getCFTextLoader()}
                        </div>
                    ) : (
                        <table style={{ width: "100%" }}>
                            <thead>
                                <tr>
                                    <th style={{ width: "1%", textAlign: "center" }} />
                                    <th style={{ width: "60%", textAlign: "left" }}>Email</th>
                                </tr>
                            </thead>
                            <tbody>
                                {
                                    selectedUsers?.length > 0 ? (
                                        selectedUsers?.map((user) => (
                                            <tr key={user?.id ?? user?.email}>
                                                <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedUsersEmail?.includes(user?.email)}
                                                        onChange={(e) => handleCheckboxChange(user, e.target.checked)}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: "500", textAlign: "left" }}>
                                                    <span>{user?.email ?? "—"}</span>
                                                </td>
                                            </tr>
                                        ))
                                    ) : ""
                                }
                                {userList?.filter((user) => !selectedUsersOffboarding?.some((selectedUser) => selectedUser?.email === user?.email))?.filter((user) => !selectedUsersEmail?.includes(user?.email))?.map((user) => (
                                    <tr key={user?.id ?? user?.email}>
                                        <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedUsersEmail?.includes(user?.email)}
                                                onChange={(e) => handleCheckboxChange(user, e.target.checked)}
                                            />
                                        </td>
                                        <td style={{ fontWeight: "500", textAlign: "left" }}>
                                            <span>{user?.email ?? "—"}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {!isLoading && (!userList || userList.length === 0) && (
                        <p style={{ padding: "16px", color: "#64748b", margin: 0, fontSize: "14px" }}>
                            No users found.
                        </p>
                    )}
                </div>
                <div style={{ width: "100%", padding: "0px", display: "flex", justifyContent: "flex-end" }}>
                    <ActionButton
                        buttonType="button"
                        customClass="CF_Pointer changeButtonColorOnHover cf_newBox_Shadow"
                        customStyles={{
                            width: "80px",
                            height: "40px",
                        }}
                        buttonClickAction={() => handleClose("SAVE")}
                    >
                        Save
                    </ActionButton>
                </div>
            </div>
        </div>
    );
};

export default SelectOffBoardUsers;
