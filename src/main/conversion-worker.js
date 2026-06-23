const parentPort = process.parentPort;
let convertBatch = null;

function postMessage(message) {
  if (!parentPort) {
    console.error("Conversion worker parent port is not available.");
    return;
  }

  parentPort.postMessage(message);
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || null
  };
}

function loadConversionService() {
  if (!convertBatch) {
    ({ convertBatch } = require("./services/conversion-service"));
  }

  return convertBatch;
}

async function handleMessage(message) {
  if (!message || message.type !== "convertBatch") {
    return;
  }

  const { id, request } = message;

  try {
    const convertBatchInWorker = loadConversionService();
    const results = await convertBatchInWorker(request, (progress) => {
      postMessage({
        type: "progress",
        id,
        progress
      });
    });

    postMessage({
      type: "result",
      id,
      results
    });
  } catch (error) {
    postMessage({
      type: "error",
      id,
      error: serializeError(error)
    });
  }
}

process.on("uncaughtException", (error) => {
  postMessage({
    type: "fatal-error",
    error: serializeError(error)
  });
});

process.on("unhandledRejection", (error) => {
  postMessage({
    type: "fatal-error",
    error: serializeError(error)
  });
});

if (parentPort) {
  parentPort.on("message", (event) => {
    handleMessage(event.data);
  });
} else {
  console.error("Conversion worker started without process.parentPort.");
  process.exitCode = 1;
}
