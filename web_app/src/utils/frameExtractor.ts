export const extractCurrentFrameBase64 = (): string | null => {
  try {
    const imgElement = document.getElementById("rover-video-stream") as HTMLImageElement;
    if (!imgElement) {
      console.warn("[FrameExtractor] Rover video stream element not found.");
      return null;
    }

    // Create a hidden canvas
    const canvas = document.createElement("canvas");
    canvas.width = imgElement.naturalWidth || imgElement.width || 640;
    canvas.height = imgElement.naturalHeight || imgElement.height || 480;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn("[FrameExtractor] Failed to get 2D context.");
      return null;
    }

    // Draw the image onto the canvas
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

    // Export as base64 JPEG
    return canvas.toDataURL("image/jpeg", 0.8); // 80% quality
  } catch (error) {
    console.error("[FrameExtractor] Error extracting frame:", error);
    return null;
  }
};
