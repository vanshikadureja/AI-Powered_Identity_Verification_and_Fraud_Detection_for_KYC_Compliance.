import React, { useState } from "react";

function AadhaarUpload() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [result, setResult] = useState(null);

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const handleExtract = async () => {
    if (!selectedFile) {
      alert("Please upload an Aadhaar image first!");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch("http://127.0.0.1:5000/extract_aadhaar", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      console.log("✅ Extracted Data:", data);
      setResult(data);
    } catch (error) {
      console.error("❌ Extraction failed:", error);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Upload Aadhaar for OCR Extraction</h2>
      <input type="file" accept="image/*" onChange={handleFileChange} />
      <button onClick={handleExtract}>Extract Data</button>

      {result && (
        <div style={{ marginTop: "20px" }}>
          <h3>Extracted Details:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default AadhaarUpload;
