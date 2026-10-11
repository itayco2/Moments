# Chrome Web Store listing

Name: Moments: search YouTube by what you see
Summary (132 characters max): Type what you want to see and jump to that second of any YouTube video. The AI runs on your computer.
Category: Productivity
Language: English

Description:
Remember a moment but not the minute? Type it. "a rocket lifting off", "the goal from the air", "slides with a bar chart". Moments jumps your YouTube video to that second.

How it works: an AI model (Google's EmbeddingGemma 2) runs inside your browser. It reads the video's frames and turns them into numbers; your sentence becomes numbers the same way, and the closest moment wins.

What to expect the first time:
- The AI model (about 400 MB) downloads once. The download starts when you open your first YouTube video after installing (with background reading off, at your first search); the bar under the player shows its progress.
- The first search of a video pauses your player and steps it through the video to read it in full detail, then puts it back at the same second. Skip or Esc stops it and keeps what was read. After that, search is instant.
- YouTube tabs that were already open when you installed Moments need a reload before the search bar appears.

Private by design: the AI runs on your computer and nothing you type leaves it. The only downloads are the AI model and YouTube's preview images of the video you are watching (sent to YouTube without your cookies). No account, no servers of ours, no ads, free and open source (github.com/itayco2/Moments).

Keys: Enter jumps to the next match, Shift+Enter to the previous one, Esc clears. Alt+M searches the video you are watching.

Single purpose: search inside the YouTube video you are watching by describing what is on screen.

Permission justifications:
- youtube.com: show the search bar on video pages and read the video's frames when you search.
- i.ytimg.com: download YouTube's preview images of the video to read it quickly.
- moments-video.vercel.app, huggingface.co, hf.co: download the AI model once.
- offscreen: run the AI model once for all tabs.
- storage: remember your setting and each video's search data (200 MB at most).
- alarms: unload the AI model about 10 minutes after the last YouTube video is closed, to free memory.

Data use disclosures: collects no user data. Privacy policy: https://moments-video.vercel.app/privacy.html
