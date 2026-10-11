// YouTube's look: its font, its light and dark greys, one accent from the website.
export const BAR_CSS = `
:host { all: initial; display: block; margin: 12px 0 0; --bg: #f2f2f2; --ink: #0f0f0f; --muted: #606060;
  --line: #e5e5e5; --accent: #4b3fd6; --field: #ffffff; font-family: "Roboto", "Arial", sans-serif; }
:host([data-theme="dark"]) { --bg: #272727; --ink: #f1f1f1; --muted: #aaaaaa; --line: #3f3f3f; --accent: #9d92fa; --field: #121212; }
:host([data-place="floating"]) { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 60; margin: 0; }
.bar { direction: ltr; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 12px;
  background: var(--bg); color: var(--ink); }
.row { display: flex; align-items: center; gap: 10px; }
.logo { flex: none; display: block; }
input { flex: 1; min-width: 0; height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 18px;
  background: var(--field); color: var(--ink); font: 400 14px "Roboto", "Arial", sans-serif; outline: none; }
input:focus { border-color: var(--accent); }
input::placeholder { color: var(--muted); }
.count { min-width: 56px; text-align: right; font: 500 13px "Roboto", "Arial", sans-serif; color: var(--muted); }
button { height: 32px; min-width: 32px; padding: 0 8px; border: 0; border-radius: 16px; background: transparent;
  color: var(--ink); font: 500 16px "Roboto", "Arial", sans-serif; cursor: pointer; }
button:hover:not(:disabled) { background: var(--line); }
button:disabled { opacity: 0.35; cursor: default; }
.status { font: 400 12px/1.4 "Roboto", "Arial", sans-serif; color: var(--muted); }
.line { height: 2px; border-radius: 1px; background: var(--line); overflow: hidden; }
.line i { display: block; height: 100%; width: 0; background: var(--accent); transition: width 0.2s ease; }
`;

export const OVERLAY_CSS = `
:host { all: initial; position: absolute; inset: 0; z-index: 70; display: block; cursor: default; }
.panel { position: absolute; left: 0; right: 0; bottom: 0; padding: 48px 20px 16px; display: flex; align-items: flex-end;
  gap: 16px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.75)); color: #ffffff;
  font-family: "Roboto", "Arial", sans-serif; }
.text { flex: 1; display: flex; flex-direction: column; gap: 8px; font: 500 15px "Roboto", "Arial", sans-serif; }
.line { height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
.line i { display: block; height: 100%; width: 0; background: #9d92fa; }
button { flex: none; height: 36px; padding: 0 16px; border: 0; border-radius: 18px; background: rgba(255, 255, 255, 0.18);
  color: #ffffff; font: 500 14px "Roboto", "Arial", sans-serif; cursor: pointer; }
button:hover { background: rgba(255, 255, 255, 0.3); }
`;

export const LOGO_SVG = `<svg class="logo" width="22" height="22" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#16161A"/><path d="M6.5 18.5h15" stroke="#F7F6F3" stroke-width="2" stroke-linecap="round"/><rect x="15" y="8.5" width="3.2" height="13" rx="1.6" fill="#9D92FA"/></svg>`;
