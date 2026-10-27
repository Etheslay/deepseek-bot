"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { createRequire } = require("node:module");
const { promisify } = require("node:util");
const { parentPort } = require("node:worker_threads");
const { simd, relaxedSimd } = require("wasm-feature-detect");

function refuseNetwork() {
  throw new Error("offline OCR refuses network");
}

http.request = refuseNetwork;
http.get = refuseNetwork;
https.request = refuseNetwork;
https.get = refuseNetwork;
globalThis.fetch = refuseNetwork;

const protocol = require("tesseract.js/src/worker-script");
const coreDir = path.join(__dirname, "core");
const requireCore = createRequire(__filename);

const CORE_FILES = {
  relaxedLstm: "tesseract-core-relaxedsimd-lstm.js",
  relaxed: "tesseract-core-relaxedsimd.js",
  simdLstm: "tesseract-core-simd-lstm.js",
  simd: "tesseract-core-simd.js",
  lstm: "tesseract-core-lstm.js",
  plain: "tesseract-core.js",
};

async function getCore(lstmOnly) {
  const relaxed = await relaxedSimd();
  const hasSimd = await simd();
  const useLstm = Boolean(lstmOnly);
  let file = CORE_FILES.plain;
  if (relaxed && useLstm) file = CORE_FILES.relaxedLstm;
  else if (relaxed) file = CORE_FILES.relaxed;
  else if (hasSimd && useLstm) file = CORE_FILES.simdLstm;
  else if (hasSimd) file = CORE_FILES.simd;
  else if (useLstm) file = CORE_FILES.lstm;
  const full = path.resolve(coreDir, file);
  const relative = path.relative(coreDir, full);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("offline OCR core path escaped");
  }
  return requireCore(full);
}

if (parentPort === null) {
  throw new Error("offline OCR worker must run in a worker thread");
}

protocol.setAdapter({
  getCore,
  gunzip: require("node:zlib").gunzipSync,
  fetch: refuseNetwork,
  readCache: promisify(fs.readFile),
  writeCache: promisify(fs.writeFile),
  deleteCache: (file) => promisify(fs.unlink)(file).catch(() => {}),
  checkCache: (file) =>
    promisify(fs.access)(file, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false),
});

parentPort.on("message", (packet) => {
  protocol.dispatchHandlers(packet, (obj) => parentPort.postMessage(obj));
});
