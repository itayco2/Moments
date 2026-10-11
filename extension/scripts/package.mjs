// extension/scripts/package.mjs: zips dist/ for the Chrome Web Store.  node scripts/package.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";
import { assertNoRemoteCode } from "./remote-code.mjs";

const dist = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
assertNoRemoteCode(dist); // the store refuses remote code; never zip a dist/ that names a script CDN
const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(dist, path).split("\\").join("/")] = readFileSync(path);
  }
};
walk(dist);
const out = `moments-youtube-${version}.zip`;
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`${Object.keys(files).length} files -> ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
