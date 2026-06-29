import { FolderOpen, Image, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { notifyToast } from "../../../helpers/utils";
import {
  getS3Folders,
  getS3Files,
  getS3ImageUrl,
  uploadS3File,
} from "./AssertAction";
import "../css/Blog.css";

const AssertManager = () => {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [previewPath, setPreviewPath] = useState(null);
  const [uploadFolder, setUploadFolder] = useState("");
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);

  const fetchFolders = useCallback(async () => {
    setLoadingFolders(true);
    const { status, res } = await getS3Folders();
    setLoadingFolders(false);
    if (status === "OK") {
      setFolders(res ?? []);
      if (res?.length && !selectedFolder) setUploadFolder(res[0]);
    } else {
      notifyToast("error", res?.message || "Failed to list folders");
      setFolders([]);
    }
  }, [selectedFolder]);

  const fetchFiles = useCallback(async (prefix) => {
    if (!prefix) {
      setFiles([]);
      return;
    }
    setLoadingFiles(true);
    const { status, res } = await getS3Files(prefix);
    setLoadingFiles(false);
    if (status === "OK") {
      setFiles(res ?? []);
    } else {
      notifyToast("error", res?.message || "Failed to list files");
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    if (selectedFolder) fetchFiles(selectedFolder);
    else setFiles([]);
  }, [selectedFolder, fetchFiles]);

  const handleUpload = async (e) => {
    e.preventDefault();
    const folder = uploadFolder?.trim();
    if (!folder) {
      notifyToast("error", "Please select or enter a folder");
      return;
    }
    if (!uploadFile) {
      notifyToast("error", "Please select a file");
      return;
    }
    setUploading(true);
    const { status, res } = await uploadS3File(uploadFile, folder);
    setUploading(false);
    if (status === "OK") {
      notifyToast("success", "File uploaded successfully");
      setUploadFile(null);
      if (selectedFolder === folder) fetchFiles(folder);
      else fetchFolders();
    } else {
      notifyToast("error", res?.message || "Upload failed");
    }
  };

  const isImage = (path) => {
    if (!path) return false;
    const ext = path.split(".").pop()?.toLowerCase();
    return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext);
  };

  return (
    <div className="cf_blog_container" style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "24px", color: "#001a6f" }}>Asset Manager</h1>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px", alignItems: "start" }}>
        {/* Folders */}
        <div
          className="cf_assert_panel"
          style={{
            background: "#f8f9fa",
            borderRadius: "12px",
            padding: "16px",
            border: "1px solid #e9ecef",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <FolderOpen size={20} color="#001a6f" />
            <h2 style={{ margin: 0, fontSize: "16px", color: "#001a6f" }}>Folders</h2>
          </div>
          {loadingFolders ? (
            <p style={{ color: "#6c757d" }}>Loading folders...</p>
          ) : folders.length === 0 ? (
            <p style={{ color: "#6c757d" }}>No folders</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {folders.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFolder(name);
                      setPreviewPath(null);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      marginBottom: "4px",
                      border: "none",
                      borderRadius: "8px",
                      background: selectedFolder === name ? "#e7f0ff" : "transparent",
                      color: selectedFolder === name ? "#001a6f" : "#495057",
                      cursor: "pointer",
                      fontWeight: selectedFolder === name ? 600 : 400,
                    }}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Files & Preview */}
        <div
          style={{
            background: "#fff",
            borderRadius: "12px",
            padding: "16px",
            border: "1px solid #e9ecef",
            minHeight: "320px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <Image size={20} color="#001a6f" />
            <h2 style={{ margin: 0, fontSize: "16px", color: "#001a6f" }}>
              {selectedFolder ? `Files in ${selectedFolder}` : "Select a folder"}
            </h2>
          </div>
          {selectedFolder && (
            <>
              {loadingFiles ? (
                <p style={{ color: "#6c757d" }}>Loading files...</p>
              ) : files.length === 0 ? (
                <p style={{ color: "#6c757d" }}>No files in this folder</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: "16px" }}>
                  {files.map((path) => {
                    const fileName = path.split("/").pop() || path;
                    const showPreview = isImage(path);
                    return (
                      <li
                        key={path}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          borderRadius: "8px",
                          background: previewPath === path ? "#e7f0ff" : "transparent",
                          marginBottom: "4px",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewPath(path)}
                          style={{
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            flex: 1,
                            color: "#495057",
                          }}
                        >
                          {fileName}
                        </button>
                        {showPreview && (
                          <span style={{ fontSize: "12px", color: "#6c757d" }}>Preview</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          {previewPath && isImage(previewPath) && (
            <div style={{ marginTop: "16px", padding: "12px", background: "#f8f9fa", borderRadius: "8px" }}>
              <p style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#6c757d" }}>Preview</p>
              <img
                src={getS3ImageUrl(previewPath)}
                alt={previewPath}
                style={{ maxWidth: "100%", maxHeight: "360px", objectFit: "contain" }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Upload */}
      <div
        style={{
          marginTop: "24px",
          padding: "20px",
          background: "#f8f9fa",
          borderRadius: "12px",
          border: "1px solid #e9ecef",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Upload size={20} color="#001a6f" />
          <h2 style={{ margin: 0, fontSize: "16px", color: "#001a6f" }}>Upload image</h2>
        </div>
        <form onSubmit={handleUpload} style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#6c757d", marginBottom: "4px" }}>
              Folder
            </label>
            <input
              type="text"
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              placeholder="e.g. smpl"
              list="folders-list"
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #dee2e6",
                minWidth: "160px",
              }}
            />
            <datalist id="folders-list">
              {folders.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#6c757d", marginBottom: "4px" }}>
              File
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              style={{ padding: "6px" }}
            />
          </div>
          <button
            type="submit"
            disabled={uploading || !uploadFile}
            style={{
              padding: "8px 20px",
              borderRadius: "8px",
              border: "none",
              background: uploading ? "#adb5bd" : "#001a6f",
              color: "#fff",
              cursor: uploading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AssertManager;
