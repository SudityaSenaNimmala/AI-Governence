import React, { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";

interface Props {
  onDone: (name: string) => void;
  onClose: () => void;
}

export default function OnboardingPopup({ onDone, onClose }: Props) {
  const [name, setName] = useState("");

  // Drag state
  const [pos, setPos] = useState({ x: window.innerWidth - 300 - 24, y: window.innerHeight - 220 - 24 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const draggedRef = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      if (Math.abs(ev.clientX - dragRef.current.sx) > 3 || Math.abs(ev.clientY - dragRef.current.sy) > 3)
        draggedRef.current = true;
      setPos({
        x: Math.max(0, Math.min(dragRef.current.ox + (ev.clientX - dragRef.current.sx), window.innerWidth - 300)),
        y: Math.max(0, Math.min(dragRef.current.oy + (ev.clientY - dragRef.current.sy), window.innerHeight - 200)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onDone(trimmed);
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 10 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 10000,
        width: 280,
        background: "#0d2266",
        borderRadius: 14,
        boxShadow: "0 6px 32px rgba(13,34,102,0.5)",
        userSelect: "none",
        fontFamily: "inherit",
      }}
    >
      {/* Drag handle — header area */}
      <div
        onMouseDown={onDragStart}
        style={{ padding: "12px 12px 0", cursor: "grab", display: "flex", alignItems: "center", gap: 8 }}
      >
        <div style={{
          width: 30, height: 30, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, flexShrink: 0,
        }}>
          👋
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#93c5fd", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Manage AI
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 1 }}>
            Hi! I'm Manage AI
          </div>
        </div>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          style={{
            background: "none", border: "none",
            color: "rgba(255,255,255,0.5)", cursor: "pointer",
            fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px 14px" }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginBottom: 10, userSelect: "none" }}>
          What should I call you?
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            onMouseDown={e => e.stopPropagation()}
            placeholder="Your name..."
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              color: "#fff",
              outline: "none",
              userSelect: "text",
            }}
          />
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={submit}
            style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: name.trim() ? "#2563eb" : "rgba(255,255,255,0.15)",
              border: "none", cursor: name.trim() ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 16, transition: "background 0.15s",
            }}
          >
            →
          </button>
        </div>
      </div>

      {/* Bottom pointer arrow */}
      <div style={{
        position: "absolute", bottom: -8, right: 40,
        width: 0, height: 0,
        borderLeft: "8px solid transparent",
        borderRight: "8px solid transparent",
        borderTop: "8px solid #0d2266",
      }} />
    </motion.div>
  );
}
