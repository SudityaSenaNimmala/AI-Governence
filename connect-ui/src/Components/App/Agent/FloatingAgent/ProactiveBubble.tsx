import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  fact: string;
  question: string;
  btnPos: { x: number; y: number };
  btnSize: number;
  onFill: (question: string) => void;
  onClose: () => void;
}

const POPUP_W   = 300;
const PADDING   = 10; // min gap from any screen edge
const SIDEBAR_W = 80; // CloudFuze left nav width — bubble must not overlap it
const DURATION  = 10; // seconds

export default function ProactiveBubble({ fact, question, btnPos, btnSize, onFill, onClose }: Props) {
  const [barStarted, setBarStarted] = useState(false);
  const [popupY, setPopupY]         = useState<number | null>(null);
  const bubbleRef                   = useRef<HTMLDivElement>(null);

  // Start bar + dismiss timer only once bubble is visible (popupY set)
  useEffect(() => {
    if (popupY === null) return;
    const raf   = requestAnimationFrame(() => setBarStarted(true));
    const timer = setTimeout(onClose, DURATION * 1000);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, [popupY !== null]);

  // After first paint, measure real height and clamp so it never goes off-screen
  useEffect(() => {
    if (!bubbleRef.current) return;
    const h   = bubbleRef.current.offsetHeight;
    const raw = btnPos.y + btnSize / 2 - h / 2;
    setPopupY(Math.max(PADDING, Math.min(raw, window.innerHeight - h - PADDING)));
  }, [btnPos, btnSize, fact, question]);

  // Prefer left of button; flip to right if it would overlap the sidebar
  const leftOfBtn  = btnPos.x - POPUP_W - 14;
  const onLeft     = leftOfBtn >= SIDEBAR_W + PADDING;
  const rawX       = onLeft ? leftOfBtn : btnPos.x + btnSize + 14;
  const popupX     = Math.max(SIDEBAR_W + PADDING, Math.min(rawX, window.innerWidth - POPUP_W - PADDING));
  const resolvedY  = popupY ?? -9999;

  return (
    <motion.div
      ref={bubbleRef}
      initial={{ opacity: 0, x: 12, scale: 0.95 }}
      animate={{ opacity: popupY !== null ? 1 : 0, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={() => onFill(question)}
      style={{
        position: "fixed",
        left: popupX,
        top: resolvedY,
        zIndex: 10000,
        width: POPUP_W,
        background: "#0d1f6e",
        borderRadius: 14,
        boxShadow: "0 6px 28px rgba(13,31,110,0.5)",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: "inherit",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "11px 12px 6px", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, flexShrink: 0, marginTop: 1,
        }}>
          👋
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#93c5fd", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Manage AI
          </div>
          <div style={{ marginTop: 3, lineHeight: 1.45 }}>
            {fact.includes("\n") ? (
              fact.split("\n").map((line, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    color: i === 0 ? "#fff" : "rgba(255,255,255,0.88)",
                    fontWeight: i === 0 ? 700 : 400,
                    marginTop: i > 0 ? 4 : 0,
                  }}
                >
                  {line}
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>{fact}</div>
            )}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
        >
          ×
        </button>
      </div>

      {/* Suggested question */}
      <div style={{ margin: "0 12px 10px", padding: "8px 10px", background: "rgba(255,255,255,0.1)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#93c5fd", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
          Ask me
        </div>
        <div style={{ fontSize: 12, color: "#fff", lineHeight: 1.4 }}>
          {question}
        </div>
      </div>

      {/* Countdown bar — CSS transition from 100% → 0% over DURATION seconds */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.1)" }}>
        <div style={{
          height: "100%",
          width: barStarted ? "0%" : "100%",
          background: "#3b82f6",
          transition: barStarted ? `width ${DURATION}s linear` : "none",
        }} />
      </div>

      {/* Arrow pointing toward the button — flips side based on bubble position */}
      <div style={{
        position: "absolute",
        ...(onLeft ? { right: -8 } : { left: -8 }),
        top: "50%", transform: "translateY(-50%)",
        width: 0, height: 0,
        borderTop: "8px solid transparent",
        borderBottom: "8px solid transparent",
        ...(onLeft ? { borderLeft: "8px solid #0d1f6e" } : { borderRight: "8px solid #0d1f6e" }),
      }} />
    </motion.div>
  );
}
