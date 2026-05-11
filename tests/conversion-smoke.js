const fs = require("fs/promises");
const path = require("path");
const { convertBatch } = require("../src/main/services/conversion-service");

const root = path.resolve(__dirname, "..");
const samples = path.join(root, "test_file");
const outputDir = path.join(samples, "conversion_output");

async function requireFile(filePath) {
  const stat = await fs.stat(filePath);

  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Expected output file at ${filePath}`);
  }
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
        target: "jpg"
      },
      {
        id: "png-to-pdf",
        path: path.join(samples, "rthjrtjjrtfjrtyf.png"),
        target: "pdf"
      },
      {
        id: "pdf-to-png",
        path: path.join(samples, "Reflection Paper 3_Answer Sheet Template.pdf"),
        target: "png"
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

  console.log(`Smoke conversion outputs written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
