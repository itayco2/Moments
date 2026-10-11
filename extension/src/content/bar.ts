// The search bar under the player, sealed in a Shadow DOM so YouTube's styles and ours never meet. The template
// is static: no page or user text ever goes through innerHTML.
import { type BarState, countText } from "./bar-state";
import { BAR_CSS, LOGO_SVG } from "./styles";

export interface BarHandlers {
  onSearch(query: string): void;
  onStep(by: 1 | -1): void;
  onClear(): void;
  onSkip(): void;
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
        <div class="status"></div>
        <div class="line"><i></i></div>
      </div>`;
    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.input = q<HTMLInputElement>("input");
    this.count = q<HTMLElement>(".count");
    this.status = q<HTMLElement>(".status");
    this.fill = q<HTMLElement>(".line i");
    this.prev = q<HTMLButtonElement>(".prev");
    this.next = q<HTMLButtonElement>(".next");
    // YouTube listens for k, f, j, l and digits on the document: keys typed here stay here.
    for (const type of ["keydown", "keyup", "keypress"]) this.input.addEventListener(type, (e) => e.stopPropagation());
    this.input.addEventListener("keydown", (e) => {
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
    this.prev.addEventListener("click", () => h.onStep(-1));
    this.next.addEventListener("click", () => h.onStep(1));
  }

  // Under the player when YouTube's layout allows; otherwise floating on the player itself.
  mount(): void {
    if (this.host.isConnected) return;
    const below = document.querySelector("ytd-watch-flexy #below");
    if (below) {
      this.host.dataset.place = "below";
      below.prepend(this.host);
      return;
    }
    const player = document.getElementById("movie_player");
    if (player) {
      this.host.dataset.place = "floating";
      player.append(this.host);
    }
  }

  focus(): void {
    this.mount();
    this.input.focus();
  }

  render(s: BarState, status: string): void {
    this.host.dataset.theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
    this.host.dataset.kind = s.kind;
    this.host.dataset.status = status;
    this.host.dataset.hits = JSON.stringify(s.hits.map((h) => h.start));
    this.host.dataset.current = String(s.current);
    if (!s.query) this.lastQuery = "";
    this.count.textContent = countText(s);
    this.status.textContent = status;
    this.prev.disabled = this.next.disabled = s.hits.length < 2;
    const progress = s.full ?? s.preview ?? (s.model.phase === "loading" ? { done: s.model.loaded, total: s.model.total } : null);
    this.fill.style.width = progress && progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "0";
  }
}
