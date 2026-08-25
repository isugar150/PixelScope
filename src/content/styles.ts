export const overlayStyles = `
  :host { all: initial; }
  .box { position:fixed;display:none;box-sizing:border-box;border:1px solid #3b82f6;background:rgba(59,130,246,.14);pointer-events:none;z-index:2147483644; }
  .box.element { border-color:#22d3ee;background:rgba(6,182,212,.12); }
  .label { position:fixed;display:none;box-sizing:border-box;max-width:calc(100vw - 16px);padding:4px 7px;border-radius:4px;background:rgba(15,23,42,.92);color:#fff;font:600 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:2147483647; }
  .label .tag { margin-left:6px;color:#93c5fd;font-weight:500; }
  .line { position:fixed;display:none;background:rgba(239,68,68,.48);pointer-events:none;z-index:2147483643;will-change:transform; }
  .line.horizontal { left:0;top:0;width:100vw;height:1px; } .line.vertical { left:0;top:0;width:1px;height:100vh; }
  .panel { position:fixed;display:none;top:8px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 16px);padding:7px 11px;border:1px solid #334155;border-radius:7px;background:rgba(15,23,42,.93);box-shadow:0 6px 24px rgba(0,0,0,.3);color:#e2e8f0;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:2147483647; }
  .magnifier { position:fixed;display:none;width:136px;padding:7px;box-sizing:border-box;border:1px solid #475569;border-radius:9px;background:#0f172a;box-shadow:0 8px 26px rgba(0,0,0,.4);pointer-events:none;z-index:2147483647;will-change:transform; }
  .magnifier canvas { display:block;width:120px;height:120px;border-radius:4px;background:#111827;image-rendering:pixelated; }
  .magnifier .meta { display:block;padding-top:5px;color:#fff;font:600 11px/1.3 ui-monospace,monospace;text-align:center; }
  .magnifier.loading canvas { opacity:.25; } .magnifier.loading::after { content:'캡처 준비 중';position:absolute;left:0;right:0;top:61px;color:#cbd5e1;font:11px sans-serif;text-align:center; }
`;

export const interactionStyles = `
  html, html * {
    cursor: crosshair !important;
    -webkit-user-select: none !important;
    user-select: none !important;
  }
  html[data-pixelscope-touch-drag], html[data-pixelscope-touch-drag] * {
    touch-action: pan-x pan-y !important;
  }
`;

export const colorPickerInteractionStyles = `
  html, html * {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M2 30l5-9L18 10l4 4-11 11-9 5Z' fill='%23f8fafc' stroke='%230f172a' stroke-width='1.75' stroke-linejoin='round'/%3E%3Cpath d='m17 9 3-3 6 6-3 3-6-6Z' fill='%2393c5fd' stroke='%230f172a' stroke-width='1.75' stroke-linejoin='round'/%3E%3Cpath d='m20 6 3-3a3 3 0 0 1 4 4l-3 3-4-4Z' fill='%23f8fafc' stroke='%230f172a' stroke-width='1.75' stroke-linejoin='round'/%3E%3Ccircle cx='3' cy='29' r='1.5' fill='%2360a5fa' stroke='%23fff' stroke-width='.75'/%3E%3C/svg%3E") 3 29, crosshair !important;
  }
`;
