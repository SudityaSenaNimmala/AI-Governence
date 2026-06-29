import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentStatus } from './types';

const STYLE_ID = 'cf-mouse-agent-styles';
const CSS = `
@keyframes cf-comet-pulse {
  0%,100% { box-shadow: 0 0 10px 3px rgba(37,99,235,0.55); }
  50%      { box-shadow: 0 0 18px 7px rgba(37,99,235,0.85); }
}
@keyframes cf-agent-fadein {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.cf-comet-head { animation: cf-comet-pulse 1.6s ease-in-out infinite; }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

interface Props {
  /** Called immediately after the overlay mounts so useMouseAgent can drive cursor position directly. */
  onRegisterElements: (head: HTMLDivElement | null, label: HTMLDivElement | null) => void;
  status: AgentStatus;
  currentLabel: string;
  currentStepIndex?: number;
  totalSteps?: number;
  onAbort: () => void;
  onPause: () => void;
  onResume: () => void;
  cursorPos: { x: number; y: number }; // 10fps throttled, used for tail particles only
}

export default function MouseAgentOverlay({
  onRegisterElements,
  status,
  currentLabel,
  currentStepIndex = 0,
  totalSteps = 0,
  onAbort,
  onPause,
  onResume,
  cursorPos,
}: Props) {
  const headRef  = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const [prevPos, setPrevPos] = useState(cursorPos);
  const prevPosRef = useRef(cursorPos);

  useEffect(() => { injectStyles(); }, []);

  // Register cursor DOM elements with useMouseAgent immediately after mount
  useLayoutEffect(() => {
    onRegisterElements(headRef.current, labelRef.current);
    return () => onRegisterElements(null, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track previous position for comet tail direction (10fps is fine for this)
  useEffect(() => {
    setPrevPos(prevPosRef.current);
    prevPosRef.current = cursorPos;
  }, [cursorPos]);

  const isExecuting = status === 'executing';
  const isPaused    = status === 'paused';
  const isDone      = status === 'done';
  const isAborted   = status === 'aborted';
  const isError     = status === 'error';

  // Comet tail direction — computed from 10fps state
  const dx   = cursorPos.x - prevPos.x;
  const dy   = cursorPos.y - prevPos.y;
  const len  = Math.sqrt(dx * dx + dy * dy) || 1;
  const normX = -dx / len;
  const normY = -dy / len;

  const tailParticles = [
    { offset: 1, opacity: 0.55, size: 10 },
    { offset: 2, opacity: 0.35, size: 7  },
    { offset: 3, opacity: 0.18, size: 5  },
  ];

  return (
    <>
      {/* ── Full-screen pointer-events:none layer — cursor lives here ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 200000, pointerEvents: 'none' }}>

        {/* Comet tail particles — use 10fps cursorPos, short CSS transition is fine */}
        {tailParticles.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: cursorPos.x + normX * p.offset * 12 - p.size / 2,
            top:  cursorPos.y + normY * p.offset * 12 - p.size / 2,
            width: p.size, height: p.size,
            borderRadius: '50%',
            background: `rgba(37,99,235,${p.opacity})`,
            transition: 'left 120ms ease-out, top 120ms ease-out',
            pointerEvents: 'none',
          }} />
        ))}

        {/* Comet head — position driven at 60fps via direct DOM, NO CSS transition */}
        <div
          ref={headRef}
          className="cf-comet-head"
          style={{
            position: 'absolute',
            // left/top are NOT set here — useMouseAgent writes them directly
            width: 16, height: 16,
            borderRadius: '50%',
            background: '#2563eb',
            pointerEvents: 'none',
          }}
        />

        {/* Action label tooltip — also driven at 60fps via direct DOM, NO CSS transition */}
        <div
          ref={labelRef}
          style={{
            position: 'absolute',
            // left/top driven directly by useMouseAgent
            display: currentLabel && !isPaused ? 'block' : 'none',
            background: '#fff',
            color: '#1e293b',
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 20,
            boxShadow: '0 2px 12px rgba(0,0,0,0.14)',
            border: '1px solid #e2e8f0',
            whiteSpace: 'nowrap',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            animation: 'cf-agent-fadein 0.15s ease',
          }}
        >
          {currentLabel}
        </div>
      </div>

      {/* ── Control bar — pointer-events:all ── */}
      <div style={{
        position: 'fixed',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200001,
        pointerEvents: 'all',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(255,255,255,0.97)',
        borderRadius: 40,
        padding: '5px 12px 5px 8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.16), 0 0 0 1px rgba(37,99,235,0.1)',
        animation: 'cf-agent-fadein 0.25s ease',
      }}>
        {/* Blue dot indicator */}
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />
        </div>

        {/* Step counter */}
        {totalSteps > 0 && (
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, minWidth: 56 }}>
            Step {Math.min(currentStepIndex + 1, totalSteps)}/{totalSteps}
          </span>
        )}

        {/* Status */}
        <span style={{ fontSize: 12, color: '#1e293b', fontWeight: 700, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isDone ? '✓ Done' : isAborted ? 'Stopped' : isError ? 'Error' : isPaused ? '⏸ Waiting' : 'Running…'}
        </span>

        {isExecuting && (
          <button onClick={onPause} style={btn('#2563eb', '#fff')}>Pause</button>
        )}
        {isPaused && (
          <button onClick={onResume} style={btn('#2563eb', '#fff')}>Resume</button>
        )}
        {!isDone && !isAborted && !isError && (
          <button onClick={onAbort} style={btn('#ef4444', '#fff')}>Stop</button>
        )}
      </div>

      {/* ── Done toast ── */}
      {isDone && (
        <div style={{
          position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200002, pointerEvents: 'none',
          background: '#16a34a', color: '#fff', borderRadius: 40,
          padding: '9px 22px', fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 20px rgba(22,163,74,0.4)',
          animation: 'cf-agent-fadein 0.2s ease',
        }}>
          ✓ Done
        </div>
      )}

      {/* ── Error / aborted toast ── */}
      {(isAborted || isError) && (
        <div style={{
          position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200002, pointerEvents: 'none',
          background: isError ? '#ef4444' : '#64748b', color: '#fff', borderRadius: 40,
          padding: '9px 22px', fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          animation: 'cf-agent-fadein 0.2s ease',
        }}>
          {isError ? '✕ Error — operation stopped' : '■ Stopped'}
        </div>
      )}
    </>
  );
}

function btn(bg: string, color: string): React.CSSProperties {
  return {
    background: bg, color, border: 'none', borderRadius: 20,
    padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}
