// Web Worker: builds chunk meshes off the main thread.
import { meshChunk } from "./mesher.js";

self.onmessage = (e) => {
  const { id, pad, top } = e.data;
  const m = meshChunk(pad, top);
  const transfer = [];
  for (const part of [m.solid, m.water]) {
    for (const k of ["positions", "normals", "uvs", "colors", "block", "wind", "indices"]) transfer.push(part[k].buffer);
  }
  self.postMessage({ id, mesh: m }, transfer);
};
