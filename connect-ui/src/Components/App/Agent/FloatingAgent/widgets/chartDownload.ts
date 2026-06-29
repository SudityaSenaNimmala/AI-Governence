/** Download a chart widget as PNG.
 * @param captureFullContainer  true for pie charts (donut + HTML legend), false for bar/line (SVG only)
 */
export function downloadChartAsPng(
  containerRef: React.RefObject<HTMLDivElement | null>,
  filename: string,
  captureFullContainer = false,
) {
  const container = containerRef.current;
  if (!container) return;

  const safeFilename = `${filename.replace(/\s+/g, "_") || "chart"}.png`;

  if (captureFullContainer) {
    // Use html2canvas to capture the full container (donut SVG + HTML legend).
    // The foreignObject+img approach fails in Chrome due to security restrictions.
    void import("html2canvas").then(({ default: html2canvas }) => {
      void html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false }).then((canvas) => {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = safeFilename;
        a.click();
      });
    });
    return;
  }

  // SVG-only path for bar / line charts
  const svg = container.querySelector("svg");
  if (!svg) return;

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = svg.clientWidth || 600;
    canvas.height = svg.clientHeight || 320;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = safeFilename;
    a.click();
  };
  img.src = url;
}

// React is used by callers but referenced here only for the type
import type React from "react";
