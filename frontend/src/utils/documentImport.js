const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_PDF_PAGE_PREVIEWS = 12;

const IMAGE_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export const getDocumentTitle = (fileName) =>
  fileName.replace(/\.(pdf|docx)$/i, "").trim() || "Imported document";

const normalizeArchivePath = (path) => {
  const parts = [];
  path.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
};

const extractWordContent = async (file, maxImages) => {
  const JSZipModule = await import("jszip");
  const JSZip = JSZipModule.default || JSZipModule;
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const documentFile = archive.file("word/document.xml");
  if (!documentFile) throw new Error(`${file.name} does not contain a readable Word document.`);

  const documentXml = new DOMParser().parseFromString(await documentFile.async("text"), "application/xml");
  if (documentXml.querySelector("parsererror")) {
    throw new Error(`${file.name} contains invalid Word document data.`);
  }

  const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const drawingNamespace = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const relationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const paragraphs = Array.from(documentXml.getElementsByTagNameNS(wordNamespace, "p"));
  const text = paragraphs
    .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(wordNamespace, "t"))
      .map((textNode) => textNode.textContent || "")
      .join(""))
    .filter(Boolean)
    .join("\n")
    .trim();

  const warnings = [];
  const images = [];
  const relationshipsFile = archive.file("word/_rels/document.xml.rels");
  const relationshipTargets = new Map();
  if (relationshipsFile) {
    const relationshipsXml = new DOMParser().parseFromString(
      await relationshipsFile.async("text"),
      "application/xml",
    );
    if (relationshipsXml.querySelector("parsererror")) {
      warnings.push("Embedded Word images could not be read because the document relationships are invalid.");
    } else {
      Array.from(relationshipsXml.getElementsByTagName("Relationship"))
        .forEach((relationship) => {
          relationshipTargets.set(relationship.getAttribute("Id"), relationship.getAttribute("Target"));
        });
    }
  }

  const imageRelationships = Array.from(documentXml.getElementsByTagNameNS(drawingNamespace, "blip"))
    .map((image) => image.getAttributeNS(relationshipNamespace, "embed"))
    .filter(Boolean);
  for (const [index, relationshipId] of imageRelationships.entries()) {
    if (images.length >= maxImages) {
      if (!warnings.includes(`Only the first ${maxImages} embedded Word images were included.`)) {
        warnings.push(`Only the first ${maxImages} embedded Word images were included.`);
      }
      break;
    }
    const target = relationshipTargets.get(relationshipId);
    if (!target) {
      warnings.push(`Word image ${index + 1} could not be located.`);
      continue;
    }
    const archivePath = normalizeArchivePath(target.startsWith("/") ? target.slice(1) : `word/${target}`);
    if (!archivePath.startsWith("word/media/")) {
      warnings.push(`Word image ${index + 1} references an unexpected document path and was skipped.`);
      continue;
    }
    const imageFile = archive.file(archivePath);
    if (!imageFile) {
      warnings.push(`Word image ${index + 1} could not be extracted.`);
      continue;
    }
    const extension = archivePath.split(".").pop()?.toLowerCase();
    const type = IMAGE_TYPES[extension];
    if (!type) {
      warnings.push(`Word image ${index + 1} uses an unsupported format and was skipped.`);
      continue;
    }
    const blob = await imageFile.async("blob");
    if (blob.size > MAX_DOCUMENT_SIZE) {
      warnings.push(`Word image ${index + 1} is larger than the 5 MB image limit and was skipped.`);
      continue;
    }
    images.push({
      blob: blob.type === type ? blob : new Blob([blob], { type }),
      name: `${getDocumentTitle(file.name)}-image-${index + 1}.${extension}`,
      alt: `Illustration ${index + 1} from ${getDocumentTitle(file.name)}`,
      contentType: type,
    });
  }

  return { text, images, warnings };
};

const renderPdfPagePreview = async (page, pageNumber, documentTitle) => {
  const initialViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1.25, 1000 / initialViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error(`Could not create a preview for page ${pageNumber}.`);
  return {
    blob,
    name: `${documentTitle}-page-${pageNumber}.jpg`,
    alt: `Page ${pageNumber} from ${documentTitle}`,
    contentType: "image/jpeg",
  };
};

const extractPdfContent = async (file, maxImages) => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/build/pdf.min.mjs"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  const images = [];
  const warnings = [];
  const documentTitle = getDocumentTitle(file.name);
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = [];
    let line = "";
    let previousY = null;
    textContent.items.forEach((item) => {
      if (!("str" in item) || !item.str) return;
      const y = Array.isArray(item.transform) ? item.transform[5] : null;
      if (line && y !== null && previousY !== null && Math.abs(y - previousY) > 2) {
        lines.push(line.trim());
        line = "";
      }
      const value = item.str.trim();
      if (value) line += line && !/\s$/.test(line) ? ` ${value}` : value;
      if (item.hasEOL && line) {
        lines.push(line.trim());
        line = "";
      }
      previousY = y;
    });
    if (line) lines.push(line.trim());
    pages.push(lines.filter(Boolean).join("\n"));

    if (pageNumber <= maxImages) {
      try {
        images.push(await renderPdfPagePreview(page, pageNumber, documentTitle));
      } catch (previewError) {
        warnings.push(`Visual preview for page ${pageNumber} could not be created: ${
          previewError.message || "Image rendering failed."
        }`);
      }
    }
  }

  if (document.numPages > images.length) {
    warnings.push(`Only ${images.length} page preview${images.length === 1 ? "" : "s"} were included to keep the course fast to load.`);
  }
  const text = pages.join("\n\n").trim();
  if (!text) {
    throw new Error(`${file.name} contains no selectable text. Scanned PDFs require OCR and cannot be imported.`);
  }
  return { text, images, warnings };
};

export const extractDocumentContent = async (file, { maxImages = MAX_PDF_PAGE_PREVIEWS } = {}) => {
  if (file.size > MAX_DOCUMENT_SIZE) {
    throw new Error(`${file.name} is larger than the 5 MB limit.`);
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "docx") {
    const content = await extractWordContent(file, Math.max(0, maxImages));
    if (!content.text && !content.images.length) {
      throw new Error(`${file.name} contains no readable text or supported images.`);
    }
    if (!content.text) {
      throw new Error(`${file.name} contains images but no readable text. Add lesson text before importing.`);
    }
    return content;
  }
  if (extension === "pdf") return extractPdfContent(file, Math.max(0, maxImages));
  throw new Error(`${file.name} is not supported. Choose a PDF or DOCX file.`);
};

export const extractDocumentText = async (file) =>
  (await extractDocumentContent(file)).text;
