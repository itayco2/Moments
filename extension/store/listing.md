# Chrome Web Store listing

Name: Moments: search YouTube by what you see
Summary (132 characters max): Type what you want to see and jump to that second of any YouTube video. The AI runs on your computer.
Category: Productivity
Language: English

Description:
Remember a moment but not the minute? Type it. "a rocket lifting off", "the goal from the air", "slides with a bar chart". Moments jumps your YouTube video to that second.

How it works: an AI model (Google's EmbeddingGemma 2) runs inside your browser. It reads the video's frames and turns them into numbers; your sentence becomes numbers the same way, and the closest moment wins. The first search of a video reads it in full detail, once; after that, search is instant.

Private by design: nothing about you or your videos leaves your computer. No account, no servers, no ads, free and open source (github.com/itayco2/Moments).

Keys: Enter jumps to the next match, Shift+Enter to the previous one, Esc clears. Alt+M searches the video you are watching.

Single purpose: search inside the YouTube video you are watching by describing what is on screen.

Permission justifications:
- youtube.com: show the search bar on video pages and read the video's frames when you search.
- i.ytimg.com: download YouTube's preview images of the video to read it quickly.
- moments-video.vercel.app, huggingface.co, hf.co: download the AI model once.
- offscreen: run the AI model once for all tabs.
- storage: remember your setting and each video's search data (200 MB at most).
- alarms: unload the AI model after 10 minutes without a YouTube video, to free memory.

Data use disclosures: collects no user data. Privacy policy: https://moments-video.vercel.app/privacy.html
