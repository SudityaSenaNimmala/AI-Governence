import { useState } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["link", "image"],
    ["clean"],
  ],
};

export default function BlogPostContentEditor() {
  const [content, setContent] = useState("<p>Start writing...</p>");

  const handleSave = () => {
    console.log(content);
  };

  return (
    <>
      <ReactQuill
        theme="snow"
        value={content}
        onChange={setContent}
        modules={quillModules}
        style={{ minHeight: "400px", marginBottom: "48px" }}
      />
      <button onClick={handleSave}>Save</button>
    </>
  );
}
