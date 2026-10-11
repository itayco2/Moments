// Covers the player during a full-detail read: the frames show through above, status and Skip below. It also
// catches clicks, so a click on the video cannot start playback in the middle of the read.
import { OVERLAY_CSS } from "./styles";

export class Overlay {
  private readonly host = document.createElement("moments-overlay");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly text: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(onSkip: () => void) {
    this.root.innerHTML = `<style>${OVERLAY_CSS}</style>
      <div class="panel"><div class="text"><span></span><div class="line"><i></i></div></div><button type="button">Skip</button></div>`;
    this.text = this.root.querySelector(".text span") as HTMLElement;
    this.fill = this.root.querySelector(".line i") as HTMLElement;
    (this.root.querySelector("button") as HTMLButtonElement).addEventListener("click", (e) => {
      e.stopPropagation();
      onSkip();
    });
    for (const type of ["click", "dblclick", "mousedown", "mouseup"]) this.host.addEventListener(type, (e) => e.stopPropagation());
  }

  show(text: string, fraction: number): void {
    const player = document.getElementById("movie_player");
    if (!player) return;
    if (this.host.parentElement !== player) player.append(this.host);
    this.text.textContent = text;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  hide(): void {
    this.host.remove();
  }
}
