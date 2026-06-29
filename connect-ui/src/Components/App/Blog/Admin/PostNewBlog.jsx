import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactQuill from "react-quill";
import Quill from "quill";
import { ChevronDown } from "lucide-react";
import "react-quill/dist/quill.snow.css";

// Register custom class format so the Style button can add cf_custom to selected text
try {
  const Parchment = Quill.import("parchment");
  if (Parchment && Parchment.Attributor && Parchment.Attributor.Class) {
    const CfCustomClass = new Parchment.Attributor.Class("cf_custom", "", {
      scope: Parchment.Scope.INLINE,
    });
    Quill.register(CfCustomClass, true);
  }
} catch (e) {
  console.warn("Could not register cf_custom format:", e);
}
import ContentJSON from "../BlogReusables/ContentJSON.json";
import { getCloudName, getContentMigrationCloudsList, getMessageMigrationCloudsList, integrationsList } from "../../../helpers/helpers";
import { getCloudsList, notifyToast } from "../../../helpers/utils";
import {
  getBlogPost,
  getS3ImageUrl,
  saveBlogPost,
  uploadS3File,
} from "../AssertManager/AssertAction";
import "../css/Blog.css";
import TopNav from "../../../Resuables/Nav/TopNav";
import { getCFLoader } from "../../../Resuables/Loaders/Loaders";

const DEFAULT_CONTENT = "<p>Start writing...</p>";

const PRODUCT_TYPE_OPTIONS = [
  { value: "MIGRATE", label: "Migrate" },
  { value: "MANAGE", label: "Manage" },
];

const SUB_PRODUCT_OPTIONS = [
  { value: "CONTENT_MIGRATION", label: "Content Migration" },
  { value: "MESSAGE_MIGRATION", label: "Message Migration" },
  { value: "EMAIL_MIGRATION", label: "Email Migration" },
];

const PostNewBlog = () => {
  const [vendorName, setVendorName] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const [productType, setProductType] = useState("");
  const [subProduct, setSubProduct] = useState("");
  const [migrationSource, setMigrationSource] = useState("");
  const [migrationDestination, setMigrationDestination] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [blogContent, setBlogContent] = useState(DEFAULT_CONTENT);
  const [loadingPost, setLoadingPost] = useState(false);
  const [existingPost, setExistingPost] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const quillRef = useRef(null);
  const quillWrapperRef = useRef(null);
  const quillInstanceRef = useRef(null);
  const fileInputRef = useRef(null);
  const rangeRef = useRef(null);
  const vendorNameRef = useRef(vendorName);
  const vendorSelectRef = useRef(null);
  const uploadFolderRef = useRef("");
  vendorNameRef.current = vendorName;
  uploadFolderRef.current = productType === "MANAGE" ? vendorName : productType === "MIGRATE" ? migrationSource + "-" + migrationDestination : "";

  const vendorOptions = useMemo(
    () =>
      integrationsList().map((key) => ({
        value: key.cloudName,
        label: getCloudName(key.cloudName) || key.cloudName,
      })),
    []
  );

  const migrateCloudOptions = useMemo(() => {
    if (productType !== "MIGRATE" || !subProduct) return [];
    if (subProduct === "CONTENT_MIGRATION") {
      return getContentMigrationCloudsList.map((key) => ({
        value: key,
        label: getCloudName(key) || key,
      }));
    }
    if (subProduct === "MESSAGE_MIGRATION") {
      return getMessageMigrationCloudsList.map((key) => ({
        value: key,
        label: getCloudName(key) || key,
      }));
    }
    if (subProduct === "EMAIL_MIGRATION") {
      return integrationsList().map((key) => ({
        value: key.cloudName,
        label: getCloudName(key.cloudName) || key.cloudName,
      }));
    }
    return [];
  }, [productType, subProduct]);

  const filteredVendorOptions = useMemo(() => {
    const q = (vendorSearch || "").trim().toLowerCase();
    if (!q) return vendorOptions;
    return vendorOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
    );
  }, [vendorOptions, vendorSearch]);

  const selectedVendorLabel = useMemo(
    () => vendorOptions.find((o) => o.value === vendorName)?.label ?? "",
    [vendorOptions, vendorName]
  );

  const closeVendorDropdown = useCallback(() => {
    setVendorDropdownOpen(false);
    setVendorSearch("");
  }, []);

  const isVendorSelected =
    productType === "MANAGE"
      ? Boolean(vendorName?.trim())
      : productType === "MIGRATE" && Boolean(migrationSource) && Boolean(migrationDestination);

  const isVendorSectionEnabled = productType === "MANAGE";

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (vendorSelectRef.current && !vendorSelectRef.current.contains(e.target)) {
        closeVendorDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeVendorDropdown]);

  const contentKeys = Object.keys(ContentJSON || {}).sort((a, b) =>
    (getCloudName(a) || a).localeCompare(getCloudName(b) || b)
  );

  const blogPostKey = productType === "MANAGE" ? vendorName : productType === "MIGRATE" && migrationSource && migrationDestination ? `${migrationSource}-${migrationDestination}` : "";

  useEffect(() => {
    if (productType === "MANAGE") {
      if (!vendorName?.trim()) {
        setBlogContent(DEFAULT_CONTENT);
        setCustomPath("");
        return;
      }
      setCustomPath(`how-to-integrate-${vendorName?.toLowerCase()}`);
    } else if (productType === "MIGRATE") {
      if (!migrationSource?.trim() || !migrationDestination?.trim()) {
        setBlogContent(DEFAULT_CONTENT);
        setCustomPath("");
        return;
      }
      setCustomPath(`how-to-migrate-from-${migrationSource?.toLowerCase()}-to-${migrationDestination?.toLowerCase()}`);
    } else {
      setBlogContent(DEFAULT_CONTENT);
      setCustomPath("");
      return;
    }
    let cancelled = false;
    setLoadingPost(true);
    getBlogPost(blogPostKey)
      .then(({ status, res }) => {
        if (cancelled) return;
        setLoadingPost(false);
        if (status === "OK" && res?.blogContent) {
          setBlogContent(res.blogContent);
          if (res?.customPath != null) setCustomPath(String(res.customPath));
          if (res?.productType != null) setProductType(String(res.productType));
          if (res?.subProduct != null) setSubProduct(String(res.subProduct));
          if (res?.migrationSource != null) setMigrationSource(String(res.migrationSource));
          if (res?.migrationDestination != null) setMigrationDestination(String(res.migrationDestination));
          setExistingPost(res);
          return;
        }
        if (status === "OK" && res?.content) {
          setBlogContent(res.content);
          if (res?.customPath != null) setCustomPath(String(res.customPath));
          if (res?.productType != null) setProductType(String(res.productType));
          if (res?.subProduct != null) setSubProduct(String(res.subProduct));
          if (res?.migrationSource != null) setMigrationSource(String(res.migrationSource));
          if (res?.migrationDestination != null) setMigrationDestination(String(res.migrationDestination));
          return;
        }
        if (ContentJSON[blogPostKey]) {
          setBlogContent(ContentJSON[blogPostKey]);
        } else {
          setBlogContent(DEFAULT_CONTENT);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingPost(false);
        if (ContentJSON[blogPostKey]) {
          setBlogContent(ContentJSON[blogPostKey]);
        } else {
          setBlogContent(DEFAULT_CONTENT);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blogPostKey, productType, vendorName, migrationSource, migrationDestination]);

  const triggerImageUpload = () => {
    const folder = uploadFolderRef.current?.trim();
    if (!folder) {
      notifyToast("error", "Please select a Vendor (or Source for Migrate) first (used as folder for uploads)");
      return;
    }
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const uploadImageAndInsert = async (file, insertRange) => {
    if (!file || !file.type.startsWith("image/")) return false;
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const timestampName = `${Date.now()}.${ext}`;
    const fileToUpload = new File([file], timestampName, { type: file.type });
    const folder = uploadFolderRef.current?.trim() || "blog";
    const { status, res } = await uploadS3File(fileToUpload, folder);
    if (status !== "OK") {
      notifyToast("error", res?.message || "Image upload failed");
      return false;
    }
    const path = res?.path ?? `${folder}/${timestampName}`;
    const imageUrl = getS3ImageUrl(path);
    const q = quillInstanceRef.current ?? quillRef.current?.getEditor?.();
    const range = insertRange ?? rangeRef.current;
    if (q && range != null) {
      q.insertEmbed(range.index, "image", imageUrl);
      q.setSelection(range.index + 1);
    }
    notifyToast("success", "Image uploaded");
    return true;
  };

  const onFileChange = async (e) => {
    setIsLoading(true);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) {
      notifyToast("error", "Please select an image file");
      setIsLoading(false);
      return;
    }
    await uploadImageAndInsert(file);
    setIsLoading(false);
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let imageFile = null;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        imageFile = item.getAsFile();
        break;
      }
    }
    if (!imageFile || !isVendorSelected) return;
    e.preventDefault();
    const editor = quillRef.current?.getEditor?.();
    if (!editor) return;
    const range = editor.getSelection(true);
    if (range == null) return;
    quillInstanceRef.current = editor;
    setIsLoading(true);
    const done = await uploadImageAndInsert(imageFile, range);
    setIsLoading(false);
    if (done) {
      rangeRef.current = { index: range.index + 1, length: 0 };
    }
  };

  const quillModules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, 4, 5, 6, false] }],
          [{ font: [] }],
          [{ size: ["small", false, "large", "huge"] }],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ align: [] }],
          ["bold", "italic", "underline", "strike"],
          [{ color: [] }, { background: [] }],
          ["blockquote"],
          [{ indent: "-1" }, { indent: "+1" }],
          ["link", "image", "video"],
          ["clean"],
          ["customstyle"],
        ],
        handlers: {
          image: function () {
            const q = this.quill;
            quillInstanceRef.current = q;
            rangeRef.current = q.getSelection(true);
            triggerImageUpload();
          },
          customstyle: function () {
            const q = this.quill;
            const range = q.getSelection(true);
            if (range) {
              q.formatText(range.index, range.length, "cf_custom", "cf_custom");
            }
          },
        },
      },
    }),
    []
  );

  const handleSave = async () => {
    if (productType === "MANAGE") {
      if (!vendorName?.trim()) {
        notifyToast("error", "Please select a vendor first");
        return;
      }
    } else if (productType === "MIGRATE") {
      if (!migrationSource?.trim() || !migrationDestination?.trim()) {
        notifyToast("error", "Please select source and destination");
        return;
      }
    } else {
      notifyToast("error", "Please select a product type first");
      return;
    }
    setIsLoading(true);
    setSaving(true);
    let body = {
      vendorName: productType === "MANAGE" ? vendorName.trim() : null,
      customPath: customPath?.trim() || null,
      productType: productType || null,
      subProduct: subProduct || null,
      migrationSource: productType === "MIGRATE" ? migrationSource.trim() : null,
      migrationDestination: productType === "MIGRATE" ? migrationDestination.trim() : null,
      blogContent,
    };
    if (existingPost?.id) {
      body.id = existingPost?.id;
    }
    const { status, res } = await saveBlogPost(body);
    setSaving(false);
    if (status !== "OK") {
      notifyToast("error", res?.message || "Failed to save post");
      setIsLoading(false);
      window.location.reload();
      return;
    } else {
      window.location.reload();
      setIsLoading(false);

    }
    notifyToast("success", "Post saved successfully");
    setVendorName("");
    setCustomPath("");
    setProductType("");
    setSubProduct("");
    setMigrationSource("");
    setMigrationDestination("");
    setBlogContent(DEFAULT_CONTENT);
  };

  return (
    <div className="cf_main_container" >
      <div className="cf_main_content_place" style={{ width: "100%" }}>
        <TopNav pageName="Post New Blog" />
        <div className="cf_blog_container" style={{ padding: "24px", maxWidth: "100%", margin: "0 auto" }}>
          {/* <h1 style={{ marginBottom: "24px", color: "#001a6f" }}>Post New Blog</h1> */}

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Vendor Name (SaaSVendor) - always enabled */}
            {/* Product Type & Sub Product */}
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <div style={{ flex: "1", minWidth: "200px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#001a6f",
                    marginBottom: "8px",
                  }}
                >
                  Product Type <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <select
                  value={productType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProductType(val);
                    if (val === "MANAGE") {
                      setSubProduct("");
                      setMigrationSource("");
                      setMigrationDestination("");
                    } else if (val === "MIGRATE") {
                      setVendorName("");
                    }
                  }}
                  style={{
                    width: "100%",
                    fontSize: "14px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid #dee2e6",
                  }}
                >
                  <option value="">Select product type</option>
                  {PRODUCT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {productType === "MIGRATE" && (
                <div style={{ flex: "1", minWidth: "200px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#001a6f",
                      marginBottom: "8px",
                    }}
                  >
                    Sub Product <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <select
                    value={subProduct}
                    onChange={(e) => {
                      setSubProduct(e.target.value);
                      setMigrationSource("");
                      setMigrationDestination("");
                    }}
                    style={{
                      width: "100%",
                      fontSize: "14px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #dee2e6",
                    }}
                  >
                    <option value="">Select sub product</option>
                    {SUB_PRODUCT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {productType === "MANAGE" && (
              <div style={{ opacity: isVendorSectionEnabled ? 1 : 0.6, pointerEvents: isVendorSectionEnabled ? "auto" : "none" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#001a6f",
                    marginBottom: "8px",
                  }}
                >
                  Vendor Name (SaaSVendor) <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <div ref={vendorSelectRef} style={{ position: "relative" }}>
                  <div
                    onClick={() => {
                      if (!isVendorSectionEnabled) return;
                      if (!vendorDropdownOpen) setVendorSearch("");
                      setVendorDropdownOpen((o) => !o);
                    }}
                    style={{
                      width: "100%",
                      fontSize: "14px",
                      padding: "10px 36px 10px 12px",
                      borderRadius: "8px",
                      border: "1px solid #dee2e6",
                      background: "#fff",
                      cursor: isVendorSectionEnabled ? "pointer" : "not-allowed",
                      minHeight: "42px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {vendorDropdownOpen ? (
                      <input
                        type="text"
                        placeholder="Search vendors..."
                        value={vendorSearch}
                        onChange={(e) => setVendorSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") closeVendorDropdown();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        style={{
                          flex: 1,
                          border: "none",
                          outline: "none",
                          fontSize: "14px",
                          padding: 0,
                        }}
                      />
                    ) : (
                      <span style={{ color: vendorName ? "#212529" : "#6c757d" }}>
                        {selectedVendorLabel || "Select a vendor"}
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    size={18}
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#6c757d",
                      pointerEvents: "none",
                      opacity: vendorDropdownOpen ? 0.5 : 1,
                    }}
                  />
                  {vendorDropdownOpen && (
                    <ul
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        margin: "4px 0 0",
                        padding: 0,
                        listStyle: "none",
                        maxHeight: "240px",
                        overflowY: "auto",
                        background: "#fff",
                        border: "1px solid #dee2e6",
                        borderRadius: "8px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                        zIndex: 10,
                      }}
                    >
                      {filteredVendorOptions.length === 0 ? (
                        <li style={{ padding: "12px", color: "#6c757d", fontSize: "14px" }}>
                          No vendors match your search
                        </li>
                      ) : (
                        filteredVendorOptions.map((opt) => (
                          <li
                            key={opt.value}
                            onClick={() => {
                              setVendorName(opt.value);
                              closeVendorDropdown();
                            }}
                            style={{
                              padding: "10px 12px",
                              fontSize: "14px",
                              cursor: "pointer",
                              background: opt.value === vendorName ? "#e7f1ff" : "transparent",
                            }}
                          >
                            {opt.label}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
                {!isVendorSectionEnabled && (
                  <p style={{ marginTop: "8px", fontSize: "13px", color: "#6c757d" }}>
                    {!productType
                      ? "Select a product type first to enable Vendor."
                      : productType === "MIGRATE"
                        ? "Select a sub product to enable Vendor."
                        : "Select a vendor to enable Custom Path and Blog Content."}
                  </p>
                )}
                {isVendorSectionEnabled && !isVendorSelected && (
                  <p style={{ marginTop: "8px", fontSize: "13px", color: "#6c757d" }}>
                    Select a vendor to enable Custom Path and Blog Content.
                  </p>
                )}
              </div>
            )}
            {productType === "MIGRATE" && subProduct && (
              <div>
                <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                  <div style={{ flex: "1", minWidth: "200px" }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#001a6f",
                        marginBottom: "8px",
                      }}
                    >
                      Source <span style={{ color: "#dc3545" }}>*</span>
                    </label>
                    <select
                      value={migrationSource}
                      onChange={(e) => {
                        setMigrationSource(e.target.value);
                        if (e.target.value === migrationDestination) setMigrationDestination("");
                      }}
                      style={{
                        width: "100%",
                        fontSize: "14px",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid #dee2e6",
                      }}
                    >
                      <option value="">Select source</option>
                      {migrateCloudOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: "1", minWidth: "200px" }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#001a6f",
                        marginBottom: "8px",
                      }}
                    >
                      Destination <span style={{ color: "#dc3545" }}>*</span>
                    </label>
                    <select
                      value={migrationDestination}
                      onChange={(e) => setMigrationDestination(e.target.value)}
                      style={{
                        width: "100%",
                        fontSize: "14px",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid #dee2e6",
                      }}
                    >
                      <option value="">Select destination</option>
                      {migrateCloudOptions
                        .filter((opt) => opt.value !== migrationSource)
                        .map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                {(!migrationSource || !migrationDestination) && (
                  <p style={{ marginTop: "8px", fontSize: "13px", color: "#6c757d" }}>
                    Select source and destination to enable Custom Path and Blog Content.
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#001a6f",
                  marginBottom: "8px",
                }}
              >
                Custom Path
              </label>
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="e.g. my-blog-slug"
                disabled={!isVendorSelected}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #dee2e6",
                  fontSize: "14px",
                }}
              />
            </div>

            {/* Blog Content (HTML Editor) - disabled until vendor selected, bigger */}
            <div style={{ opacity: isVendorSelected ? 1 : 0.6, pointerEvents: isVendorSelected ? "auto" : "none" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#001a6f",
                  marginBottom: "8px",
                }}
              >
                Blog Content
              </label>
              {loadingPost && (
                <p style={{ marginBottom: "8px", fontSize: "13px", color: "#6c757d" }}>Loading existing content...</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                style={{ display: "none" }}
              />
              <div ref={quillWrapperRef} onPaste={handlePaste}>
                <ReactQuill
                  ref={quillRef}
                  theme="snow"
                  value={blogContent || DEFAULT_CONTENT}
                  onChange={setBlogContent}
                  modules={quillModules}
                  readOnly={!isVendorSelected}
                  style={{ minHeight: "520px", marginBottom: "48px" }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!isVendorSelected || saving}
              style={{
                padding: "10px 24px",
                borderRadius: "8px",
                border: "none",
                background: !isVendorSelected || saving ? "#adb5bd" : "#001a6f",
                color: "#fff",
                cursor: !isVendorSelected || saving ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: "14px",
                alignSelf: "flex-start",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      {isLoading && getCFLoader()}
    </div>
  );
};

export default PostNewBlog;
