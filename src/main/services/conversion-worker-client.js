const path = require("path");
const { app, utilityProcess } = require("electron");

let nextRequestId = 1;

function createWorkerError(message, details = "") {
  const error = new Error(details ? `${message} ${details}` : message);
  error.name = "ConversionWorkerError";
  return error;
}

function normalizeWorkerError(error) {
  if (!error) {
    return createWorkerError("Conversion worker failed.");
  }

  return createWorkerError(error.message || "Conversion worker failed.");
}

function appendStreamLog(stream, label, log) {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      log(`${label}: ${text}`);
    }
  });
}

function convertBatchInUtilityProcess(request, onProgress = () => {}, log = () => {}) {
  const id = nextRequestId++;
  const workerPath = path.join(__dirname, "..", "conversion-worker.js");
  const worker = utilityProcess.fork(workerPath, [], {
    cwd: app.getAppPath(),
    serviceName: "Powerful Converter Conversion Worker",
    stdio: "pipe"
  });

  appendStreamLog(worker.stdout, "conversion-worker stdout", log);
  appendStreamLog(worker.stderr, "conversion-worker stderr", log);

  return new Promise((resolve, reject) => {
    let settled = false;

    function finish(callback, value) {
      if (settled) {
        return;
      }

      settled = true;
      worker.off("message", handleMessage);
      worker.off("exit", handleExit);

      if (worker.pid !== undefined) {
        worker.kill();
      }

      callback(value);
    }

    function handleMessage(message) {
      if (!message || (message.id !== undefined && message.id !== id)) {
        return;
      }

      if (message.type === "progress") {
        onProgress(message.progress);
        return;
      }

      if (message.type === "result") {
        finish(resolve, message.results);
        return;
      }

      if (message.type === "error" || message.type === "fatal-error") {
        finish(reject, normalizeWorkerError(message.error));
      }
    }

    function handleExit(code) {
      if (settled) {
        return;
      }

      finish(
        reject,
        createWorkerError("Conversion worker exited before finishing.", `Exit code: ${code}`)
      );
    }

    worker.on("message", handleMessage);
    worker.once("exit", handleExit);
    worker.once("spawn", () => {
      worker.postMessage({
        type: "convertBatch",
        id,
        request
      });
    });
  });
}

module.exports = {
  convertBatchInUtilityProcess
};
