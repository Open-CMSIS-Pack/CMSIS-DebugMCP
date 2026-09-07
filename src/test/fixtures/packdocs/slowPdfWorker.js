// Copyright 2026 Arm Limited — Apache-2.0 OR MIT
// A stand-in for pdfWorker.js: answers `version` at once, never answers an
// `extract` of a file named hang.pdf, and otherwise returns its own thread id
// as the single page, so a test can tell whether the thread was reused.
const { parentPort, threadId } = require('worker_threads');
const path = require('path');
parentPort.on('message', (msg) => {
    if (msg.kind === 'version') { parentPort.postMessage({ id: msg.id, ok: true, version: 'fake' }); return; }
    if (msg.kind === 'extract') {
        if (path.basename(msg.file) === 'hang.pdf') { return; }
        parentPort.postMessage({ id: msg.id, ok: true, pages: [String(threadId)] });
    }
});
