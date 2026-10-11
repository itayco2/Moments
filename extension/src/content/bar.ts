// The search bar under the player, sealed in a Shadow DOM so YouTube's styles and ours never meet. The template
// is static: no page or user text ever goes through innerHTML.
import { type BarState, canRetry, countText } from "./bar-state";
import { BAR_CSS, LOGO_SVG } from "./styles";

export interface BarHandlers {
  onSearch(query: string): void;
  onStep(by: 1 | -1): void;
  onClear(): void;
  onSkip(): void;
  onRetry(): void;
}

export type Place = "below" | "floating";

// Where the bar moves now, or null to stay: under the player as soon as that space exists (also from floating),
// floating on the player when it is nowhere yet and only the player exists.
export function nextPlace(current: Place | null, hasBelow: boolean, hasPlayer: boolean): Place | null {
  if (hasBelow) return current === "below" ? null : "below";
  return current === null && hasPlayer ? "floating" : null;
}

export function canFocusBar(fullscreen: { contains(node: Node | null): boolean } | null, bar: Node): boolean {
  return fullscreen === null || fullscreen.contains(bar);
}

export class Bar {
  readonly host = document.createElement("moments-bar");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private lastQuery = "";

  constructor(h: BarHandlers) {
    this.root.innerHTML = `<style>${BAR_CSS}</style>
      <div class="bar">
        <div class="row">${LOGO_SVG}
          <input type="text" maxlength="200" spellcheck="false" placeholder="Describe a moment in this video" aria-label="Search this video">
          <span class="count" aria-live="polite"></span>
          <button type="button" class="prev" aria-label="Previous match" disabled>&#8249;</button>
          <button type="button" class="next" aria-label="Next match" disabled>&#8250;</button>
        </div>
        <div class="foot"><div class="status"></div><button type="button" class="retry" hidden>Try again</button></div>
        <div class="line"><i></i></div>
      </div>`;
    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.input = q<HTMLInputElement>("input");
    this.count = q<HTMLElement>(".count");
    this.status = q<HTMLElement>(".status");
    this.fill = q<HTMLElement>(".line i");
    this.prev = q<HTMLButtonElement>(".prev");
    this.next = q<HTMLButtonElement>(".next");
    this.retry = q<HTMLButtonElement>(".retry");
    // YouTube listens for k, f, j, l and digits on the document: keys typed here stay here.
    for (const type of ["keydown", "keyup", "keypress"]) this.input.addEventListener(type, (e) => e.stopPropagation());
    // The shadow root is open, so the page can reach these elements: only the viewer's own keys and clicks count.
    this.input.addEventListener("keydown", (e) => {
      if (!e.isTrusted) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const query = this.input.value.trim();
        if (!query) return;
        if (query !== this.lastQuery) {
          this.lastQuery = query;
          h.onSearch(query);
        } else h.onStep(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.input.value = "";
        this.lastQuery = "";
        this.input.blur();
        h.onSkip();
        h.onClear();
      }
    });
    const click = (button: HTMLButtonElement, act: () => void) => button.addEventListener("click", (e) => e.isTrusted && act());
    click(this.prev, () => h.onStep(-1));
    click(this.next, () => h.onStep(1));
    click(this.retry, () => h.onRetry());
  }

  // Under the player when YouTube's layout allows; otherwise floating on the player itself, until the space under
  // the player exists (YouTube draws it after the player, and the video can be reported before that).
  mount(): void {
    const below = document.querySelector("ytd-watch-flexy #below");
    const player = document.getElementById("movie_player");
    const current = this.host.isConnected ? ((this.host.dataset.place as Place | undefined) ?? null) : null;
    const place = nextPlace(current, below !== null, player !== null);
    if (place === "below") below?.prepend(this.host);
    else if (place === "floating") player?.append(this.host);
    if (place) this.host.dataset.place = place;
  }

  // Alt+M. In fullscreen the bar under the player is off screen: focusing it would send the viewer's keys (f, k,
  // space) to a hidden field instead of YouTube, so it is left alone unless the bar is inside the fullscreen part.
  focus(): void {
    this.mount();
    if (!canFocusBar(document.fullscreenElement, this.host)) return;
    this.input.focus();
  }

  render(s: BarState, status: string): void {
    if (this.host.dataset.place !== "below" || !this.host.isConnected) this.mount();
    this.host.dataset.theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
    this.host.dataset.kind = s.kind;
    this.host.dataset.status = status;
    this.host.dataset.hits = JSON.stringify(s.hits.map((h) => h.start));
    this.host.dataset.current = String(s.current);
    if (!s.query) this.lastQuery = "";
    this.count.textContent = countText(s);
    this.status.textContent = status;
    this.prev.disabled = this.next.disabled = s.hits.length < 2;
    this.retry.hidden = !canRetry(s);
    const progress = s.full ?? s.preview ?? (s.model.phase === "loading" ? { done: s.model.loaded, total: s.model.total } : null);
    this.fill.style.width = progress && progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "0";
  }
}
