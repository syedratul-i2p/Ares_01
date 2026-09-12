export const extractCurrentFrameBase64 = async (): Promise<string | null> => {
  try {
    const imgElement = document.getElementById("rover-video-stream") as HTMLImageElement;
    if (!imgElement) return null;
    
    // We get the stream url from the img src, for example http://192.168.4.1:82/stream&t=...
    // We want to fetch http://192.168.4.1:82/capture
    const streamUrl = imgElement.src;
    if (!streamUrl) return null;
    
    const baseUrl = streamUrl.split(':82')[0]; // Extract http://IP
    const captureUrl = `${baseUrl}/capture?t=${Date.now()}`;
    
    const response = await fetch(captureUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("[FrameExtractor] Error extracting frame:", error);
    return null;
  }
};
