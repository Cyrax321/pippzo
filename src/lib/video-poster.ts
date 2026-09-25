// Client-side poster-frame capture for videos. No server imports — this runs
// in the browser (library page and the chat generateVideo flow) where a
// <video> + <canvas> pair is the only way to get a thumbnail without a
// server-side ffmpeg dependency.

/**
 * Loads a video URL, seeks a beat in, and captures a JPEG poster frame.
 *
 * Never rejects: any failure mode (CORS-tainted canvas, decode error, a URL
 * that never loads) resolves with an empty posterDataUrl instead, because a
 * missing thumbnail must not sink the save of a video that already cost real
 * money to generate. A 10s watchdog guarantees the promise settles even if
 * the element never fires an event.
 */
export async function capturePosterFromUrl(
  videoUrl: string,
): Promise<{ posterDataUrl: string; durationSec: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (posterDataUrl: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
      // Detach the source so the element stops buffering in the background.
      video.removeAttribute("src");
      video.load();
      resolve({ posterDataUrl, durationSec });
    };
    const timer = setTimeout(() => finish(""), 10_000);

    // crossOrigin lets us draw remote (CORS-enabled) frames without tainting
    // the canvas; when the host sends no CORS headers the draw/toDataURL
    // throws and we fall through to the empty-poster path.
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      // Seek a fraction in — frame zero is often black on generated clips.
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish("");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.8));
      } catch {
        finish("");
      }
    };
    video.onerror = () => finish("");
    video.src = videoUrl;
  });
}
