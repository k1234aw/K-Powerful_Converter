const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const ffmpegPath = require("ffmpeg-static");
const { convertBatch } = require("../src/main/services/conversion-service");
const execFileAsync = promisify(execFile);

const root = path.resolve(__dirname, "..");
const samples = path.join(root, "test_file");
const outputDir = path.join(samples, "conversion_output");

async function requireFile(filePath) {
  const stat = await fs.stat(filePath);

  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Expected output file at ${filePath}`);
  }
}

async function createMediaSamples() {
  const audioPath = path.join(outputDir, "smoke-audio-source.wav");
  const videoPath = path.join(outputDir, "smoke-video-source.mp4");

  await execFileAsync(ffmpegPath, [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:duration=0.5",
    "-c:a",
    "pcm_s16le",
    audioPath
  ], { windowsHide: true });

  await execFileAsync(ffmpegPath, [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=15:duration=0.5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    videoPath
  ], { windowsHide: true });

  return { audioPath, videoPath };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const request = {
    files: [
      {
        id: "jpg-to-png",
        path: path.join(samples, "20260321_234320.jpg"),
        target: "png"
      },
      {
        id: "jpeg-to-jpg",
        path: path.join(samples, "Generated Image February 23, 2026 - 7_37PM.jpeg"),
        target: "jpg",
        options: {
          quality: 80
        }
      },
      {
        id: "png-to-pdf",
        path: path.join(samples, "rthjrtjjrtfjrtyf.png"),
        target: "pdf"
      },
      {
        id: "png-to-jxl",
        path: path.join(samples, "rthjrtjjrtfjrtyf.png"),
        target: "jxl"
      },
      {
        id: "pdf-to-png",
        path: path.join(samples, "Reflection Paper 3_Answer Sheet Template.pdf"),
        target: "png"
      },
      {
        id: "pdf-to-md",
        path: path.join(samples, "Reflection Paper 3_Answer Sheet Template.pdf"),
        target: "md"
      }
    ],
    output: {
      mode: "custom",
      directory: outputDir
    },
    imageToPdfMode: "individual",
    imagePdfDpi: 150,
    pdfDpi: 96
  };

  const results = await convertBatch(request, (progress) => {
    if (progress.status === "done" || progress.status === "error") {
      console.log(`${progress.id}: ${progress.message}`);
    }
  });

  for (const result of results) {
    if (result.status !== "done") {
      throw new Error(`${result.id} failed: ${result.error}`);
    }

    for (const outputPath of result.outputPaths) {
      await requireFile(outputPath);
    }
  }

  const combineResult = await convertBatch({
    files: [
      {
        id: "combine-1",
        path: path.join(samples, "mix_to_pdf", "1244.png"),
        target: "pdf"
      },
      {
        id: "combine-2",
        path: path.join(samples, "mix_to_pdf", "453.png"),
        target: "pdf"
      }
    ],
    output: {
      mode: "custom",
      directory: outputDir
    },
    imageToPdfMode: "combine",
    imagePdfDpi: 150,
    pdfDpi: 96
  });

  for (const result of combineResult) {
    if (result.status !== "done") {
      throw new Error(`${result.id} failed: ${result.error}`);
    }

    await requireFile(result.outputPaths[0]);
  }

  const namedResult = await convertBatch({
    files: [
      {
        id: "custom-name",
        path: path.join(samples, "rthjrtjjrtfjrtyf.jpg"),
        target: "png"
      }
    ],
    output: {
      mode: "custom",
      directory: outputDir,
      fileNameFormat: {
        usePrefix: true,
        prefix: "pre_",
        useOriginal: true,
        useSuffix: true,
        suffix: "_done_",
        useConvertedText: true
      }
    },
    imageToPdfMode: "individual",
    imagePdfDpi: 150,
    pdfDpi: 96
  });
  const namedOutput = namedResult[0]?.outputPaths?.[0] || "";

  await requireFile(namedOutput);

  if (!path.basename(namedOutput).startsWith("pre_rthjrtjjrtfjrtyf_done_Converted_File")) {
    throw new Error(`Custom file name format was not applied: ${namedOutput}`);
  }

  const icoResult = await convertBatch({
    files: [
      {
        id: "png-to-ico",
        path: path.join(samples, "rthjrtjjrtfjrtyf.png"),
        target: "ico"
      }
    ],
    output: {
      mode: "custom",
      directory: outputDir
    },
    imageToPdfMode: "individual",
    imagePdfDpi: 150,
    pdfDpi: 96
  });
  const icoPath = icoResult[0]?.outputPaths?.[0] || "";

  await requireFile(icoPath);

  const icoInputResult = await convertBatch({
    files: [
      {
        id: "ico-to-jpg",
        path: icoPath,
        target: "jpg"
      }
    ],
    output: {
      mode: "custom",
      directory: outputDir
    },
    imageToPdfMode: "individual",
    imagePdfDpi: 150,
    pdfDpi: 96
  });

  if (icoInputResult[0]?.status !== "done") {
    throw new Error(`ICO input conversion failed: ${icoInputResult[0]?.error}`);
  }

  await requireFile(icoInputResult[0].outputPaths[0]);

  const { audioPath, videoPath } = await createMediaSamples();
  const mediaResult = await convertBatch({
    files: [
      {
        id: "audio-to-mp3",
        path: audioPath,
        target: "mp3"
      },
      {
        id: "video-to-webm",
        path: videoPath,
        target: "webm",
        options: {
          videoResolution: "720"
        }
      },
      {
        id: "video-to-gif",
        path: videoPath,
        target: "gif",
        options: {
          gifFps: 10,
          gifResolution: "360"
        }
      },
      {
        id: "video-to-audio",
        path: videoPath,
        target: "mp3",
        options: {
          audioNormalize: true
        }
      }
    ],
    output: {
      mode: "custom",
      directory: outputDir
    },
    mediaEncodingMode: "auto",
    imageToPdfMode: "individual",
    imagePdfDpi: 150,
    pdfDpi: 96
  });

  for (const result of mediaResult) {
    if (result.status !== "done") {
      throw new Error(`${result.id} failed: ${result.error}`);
    }

    for (const outputPath of result.outputPaths) {
      await requireFile(outputPath);
    }
  }

  console.log(`Smoke conversion outputs written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
