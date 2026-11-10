export async function resizeStudentPhoto(file) {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your photo could not be processed.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) throw new Error("Your photo could not be processed.");
    return blob;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function resizeStudentPhotoDataUrl(file) {
  const blob = await resizeStudentPhoto(file);
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Your photo could not be read."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Your photo could not be read."));
    reader.readAsDataURL(blob);
  });
}
