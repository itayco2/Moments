// A searchable library: the NASA demo (built ahead of time) or your own videos (built in this browser).

import { fp16ToFloat32 } from "./format";
import type { Row } from "./search";

export interface VideoInfo {
  key: string;
  display: string;
  duration: number;
  src: string | null; // a URL to play; null until a local file is attached
}

export interface Library {
  name: string;
  dim: number;
  rows: Row[];
  vectors: Float32Array;
  videos: Record<string, VideoInfo>;
}

export interface Example {
  query: string;
  vector: Float32Array;
}

export interface DemoJson {
  name: string;
  dim: number;
  videos: { key: string; display: string; duration: number; src: string }[];
  rows: [number, number, number][];
  examples: { query: string; vector: string }[];
}

export function base64Fp16(b64: string): Float32Array {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return fp16ToFloat32(new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2));
}

export function parseDemo(json: DemoJson, vectorBytes: ArrayBuffer, base: string): { library: Library; examples: Example[] } {
  const vectors = fp16ToFloat32(new Uint16Array(vectorBytes));
  if (vectors.length !== json.rows.length * json.dim) {
    throw new Error(`demo vectors hold ${vectors.length / json.dim} rows, library.json lists ${json.rows.length}`);
  }
  const rows: Row[] = json.rows.map(([v, start, end], i) => ({
    video: json.videos[v].key,
    start,
    end,
    thumb: `${base}thumbs/${i}.webp`,
  }));
  const videos = Object.fromEntries(json.videos.map((v) => [v.key, { ...v }]));
  const examples = json.examples.map((e) => ({ query: e.query, vector: base64Fp16(e.vector) }));
  return { library: { name: json.name, dim: json.dim, rows, vectors, videos }, examples };
}

export function emptyLibrary(name: string, dim: number): Library {
  return { name, dim, rows: [], vectors: new Float32Array(0), videos: {} };
}

// Returns a new library with one more video; the old one is left untouched.
export function withVideo(lib: Library, info: VideoInfo, rows: Row[], vectors: Float32Array[]): Library {
  if (rows.length !== vectors.length) throw new Error(`${rows.length} rows but ${vectors.length} vectors`);
  if (vectors.some((v) => v.length !== lib.dim)) throw new Error(`vectors must have ${lib.dim} dims`);
  const merged = new Float32Array(lib.vectors.length + vectors.length * lib.dim);
  merged.set(lib.vectors);
  vectors.forEach((v, i) => merged.set(v, lib.vectors.length + i * lib.dim));
  return {
    ...lib,
    rows: [...lib.rows, ...rows],
    vectors: merged,
    videos: { ...lib.videos, [info.key]: info },
  };
}

export function withSource(lib: Library, key: string, src: string): Library {
  const info = lib.videos[key];
  if (!info) return lib;
  return { ...lib, videos: { ...lib.videos, [key]: { ...info, src } } };
}

// A local file is identified by name, size and modification time, so re-picking it finds its saved index.
export function fileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function displayName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}
