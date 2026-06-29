import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  userName: string;
  btnPos: { x: number; y: number };
  btnSize: number;
  onOpen: () => void;
  onClose: () => void;
}

const POPUP_W   = 280;
const POPUP_H   = 120; // approximate popup height
const PADDING   = 8;
const SIDEBAR_W = 80; // CloudFuze left nav width — bubble must not overlap it

const MESSAGES = [
  { title: (n: string) => `${n}, check your spend`,     body: "I'll break down your SaaS costs and find savings in seconds." },
  { title: (n: string) => `${n}, any unused licenses?`, body: "I can find wasted seats and help you reclaim them." },
  { title: (n: string) => `Hey, ${n}!`,                 body: "Your SaaS portfolio is ready to explore. Ask me anything." },
  { title: (n: string) => `${n}, shadow IT alert?`,     body: "I can detect unauthorized apps across your org." },
  { title: (n: string) => `${n}, renewals coming up?`,  body: "Let me show your upcoming contract renewals." },
];

export default function GreetingPopup({ userName, btnPos, btnSize, onOpen, onClose }: Props) {
  const [msg] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  // Prefer left of button; flip to right if it would overlap the sidebar or go off-screen
  const leftOfBtn = btnPos.x - POPUP_W - 14;
  const onLeft    = leftOfBtn >= SIDEBAR_W + PADDING;
  const rawX      = onLeft ? leftOfBtn : btnPos.x + btnSize + 14;
  const rawY      = btnPos.y + btnSize / 2 - POPUP_H / 2;
  const popupX    = Math.max(SIDEBAR_W + PADDING, Math.min(rawX, window.innerWidth - POPUP_W - PADDING));
  const popupY    = Math.max(PADDING, Math.min(rawY, window.innerHeight - POPUP_H - PADDING));

  return (
    <motion.div
      initial={{ opacity: 0, x: 12, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 12, scale: 0.96 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={onOpen}
      style={{
        position: "fixed",
        left: popupX,
        top: popupY,
        zIndex: 10000,
        width: POPUP_W,
        background: "#0d1f6e",
        borderRadius: 14,
        boxShadow: "0 6px 28px rgba(13,31,110,0.5)",
        cursor: "pointer",
        userSelect: "none",
        fontFamily: "inherit",
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px 12px 8px", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, flexShrink: 0,
        }}>
          👋
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#93c5fd", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Manage AI
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 2, lineHeight: 1.3 }}>
            {msg.title(userName)}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onClose(); }}
          style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.45)", cursor: "pointer",
            fontSize: 17, lineHeight: 1, padding: "2px 4px", flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "0 12px 14px", fontSize: 12, color: "rgba(255,255,255,0.78)", lineHeight: 1.5 }}>
        {msg.body}
      </div>

      {/* Arrow pointing toward the button — flips side based on bubble position */}
      <div style={{
        position: "absolute",
        ...(onLeft ? { right: -8 } : { left: -8 }),
        top: "50%",
        transform: "translateY(-50%)",
        width: 0, height: 0,
        borderTop: "8px solid transparent",
        borderBottom: "8px solid transparent",
        ...(onLeft ? { borderLeft: "8px solid #0d1f6e" } : { borderRight: "8px solid #0d1f6e" }),
      }} />
    </motion.div>
  );
}
