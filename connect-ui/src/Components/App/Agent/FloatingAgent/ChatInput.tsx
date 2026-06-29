import React, { useState, useRef, useEffect, KeyboardEvent } from "react";

interface Props { onSend: (text: string) => void; disabled: boolean; draftText?: string; onDraftConsumed?: () => void; }

const HINTS = [
  "Show me the license waste report",
  "Which vendors have inactive users?",
  "What's our total SaaS spend?",
  "Show user metrics",
  "List all connected vendors",
  "Which app costs the most?",
  "Show inactive users",
  "Show spend summary",
];

export default function ChatInput({ onSend, disabled, draftText, onDraftConsumed }: Props) {
  const [text, setText] = useState("");

  // Apply prefill from proactive bubble
  useEffect(() => {
    if (draftText) { setText(draftText); onDraftConsumed?.(); }
  }, [draftText]); // eslint-disable-line
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  function submit(value = text) {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    setSuggestions([]);
    if (textRef.current) textRef.current.style.height = "auto";
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === "Escape") setSuggestions([]);
  }

  function onInput() {
    if (!textRef.current) return;
    textRef.current.style.height = "auto";
    textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 140)}px`;
  }

  function onChange(val: string) {
    setText(val);
    if (val.trim().length >= 2) {
      const lower = val.toLowerCase();
      setSuggestions(HINTS.filter(h => h.toLowerCase().includes(lower)).slice(0, 4));
    } else {
      setSuggestions([]);
    }
  }

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div style={s.wrap}>
      {/* Typeahead dropdown */}
      {suggestions.length > 0 && (
        <div style={s.dropdown}>
          {suggestions.map(sg => (
            <button type="button" key={sg} style={s.suggestion} onMouseDown={() => submit(sg)}>{sg}</button>
          ))}
        </div>
      )}

      <div style={s.box}>
        <textarea
          ref={textRef}
          value={text}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onInput={onInput}
          onBlur={() => setTimeout(() => setSuggestions([]), 150)}
          placeholder={disabled ? "Thinking…" : "Ask anything about users, licenses, spend…"}
          disabled={disabled}
          rows={1}
          style={s.textarea}
        />

        {/* Send button */}
        <button
          type="button"
          className="send-btn"
          onClick={() => submit()}
          disabled={!canSend}
          style={{ ...s.btn, background: canSend ? "#2563eb" : "#e5e7eb" }}
        >
          {disabled
            ? <span className="spinner" style={{ borderTopColor: "#9ca3af" }} />
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          }
        </button>
      </div>

      <div style={s.hint}>Enter to send · Shift+Enter for new line</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap:       { padding: "10px 12px 12px", borderTop: "1px solid #e2e8f0", background: "#fff", position: "relative" },
  dropdown:   { position: "absolute", bottom: "100%", left: 12, right: 12, background: "#fff", border: "1px solid #bfdbfe", borderRadius: 12, boxShadow: "0 8px 24px rgba(37,99,235,.12)", overflow: "hidden", marginBottom: 6, zIndex: 20 },
  suggestion: { display: "block", width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 13, color: "#1e40af", background: "none", border: "none", borderBottom: "1px solid #f0f4ff", cursor: "pointer" },
  box:        { display: "flex", alignItems: "flex-end", gap: 6, background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "6px 6px 6px 10px", transition: "border-color 0.15s" },
  textarea:   { flex: 1, resize: "none", border: "none", background: "transparent", fontSize: 14, lineHeight: 1.6, outline: "none", fontFamily: "inherit", overflowY: "hidden", padding: "5px 0", color: "#0f172a" },
  btn:        { width: 34, height: 34, borderRadius: 10, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s, transform 0.1s", color: "#fff" },
  hint:       { fontSize: 10, color: "#94a3b8", textAlign: "center", marginTop: 7, letterSpacing: "0.02em" },
};
