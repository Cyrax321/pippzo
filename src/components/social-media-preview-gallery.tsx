import { useState } from "react";
import { Play, Maximize2 } from "lucide-react";
import type { AttachedMedia } from "@/components/media-uploader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SocialMediaPreviewGallery({
  media,
  fallbackUrl,
  platform = "x",
}: {
  media: AttachedMedia[];
  fallbackUrl?: string | null;
  platform?: string;
}) {
  const [activeModalItem, setActiveModalItem] = useState<AttachedMedia | { url: string; type: "image" | "video"; name: string; altText?: string } | null>(null);

  // If items exist in media array, use them; otherwise fallback to fallbackUrl
  const items =
    media.length > 0
      ? media
      : fallbackUrl
        ? [
            {
              id: "fallback",
              url: fallbackUrl,
              type: "image" as const,
              name: "Attachment",
              altText: undefined,
            },
          ]
        : [];

  if (items.length === 0) return null;

  // Single video check
  const videoItem = items.find((m) => m.type === "video");
  if (videoItem) {
    return (
      <div className="mt-2.5">
        <div
          onClick={() => setActiveModalItem(videoItem)}
          className="relative aspect-video rounded-xl overflow-hidden bg-neutral-900 border border-neutral-200 dark:border-neutral-800 cursor-pointer group"
        >
          {videoItem.thumbnailUrl ? (
            <img
              src={videoItem.thumbnailUrl}
              alt={videoItem.altText || videoItem.name}
              className="w-full h-full object-cover transition-transform group-hover:scale-102"
            />
          ) : (
            <video src={videoItem.url} className="w-full h-full object-cover" />
          )}

          {/* Centered Play Button */}
          <div className="absolute inset-0 bg-black/35 group-hover:bg-black/25 flex items-center justify-center transition-colors">
            <div className="w-12 h-12 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
              <Play className="h-5 w-5 ml-0.5 fill-black" />
            </div>
          </div>

          {/* Video Duration / Platform Pill */}
          {videoItem.durationSec && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/80 text-white text-[10px] rounded font-mono">
              {Math.floor(videoItem.durationSec / 60)}:
              {(videoItem.durationSec % 60).toString().padStart(2, "0")}
            </div>
          )}
        </div>

        {/* Modal Video Player */}
        <Dialog open={activeModalItem !== null} onOpenChange={(open) => !open && setActiveModalItem(null)}>
          <DialogContent className="max-w-3xl p-3 bg-black text-white">
            <DialogHeader className="sr-only">
              <DialogTitle>Video Preview</DialogTitle>
            </DialogHeader>
            <div className="aspect-video w-full flex items-center justify-center">
              <video src={activeModalItem?.url} controls autoPlay className="w-full h-full max-h-[70vh] object-contain" />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Multi-image layout calculations (X / Twitter & LinkedIn style)
  const images = items.filter((m) => m.type === "image");
  const count = images.length;

  return (
    <div className="mt-2.5">
      {count === 1 && (
        <div
          onClick={() => setActiveModalItem(images[0])}
          className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 cursor-pointer group"
        >
          <img
            src={images[0].url}
            alt={images[0].altText || "Post Attachment"}
            className="w-full max-h-80 object-cover transition-transform group-hover:scale-101"
          />
        </div>
      )}

      {count === 2 && (
        <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
          {images.map((img, i) => (
            <div
              key={img.id}
              onClick={() => setActiveModalItem(img)}
              className="aspect-square relative cursor-pointer overflow-hidden bg-neutral-900 group"
            >
              <img
                src={img.url}
                alt={img.altText || `Attachment ${i + 1}`}
                className="w-full h-full object-cover transition-transform group-hover:scale-103"
              />
            </div>
          ))}
        </div>
      )}

      {count === 3 && (
        <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 h-64">
          <div
            onClick={() => setActiveModalItem(images[0])}
            className="h-full relative cursor-pointer overflow-hidden bg-neutral-900 group"
          >
            <img
              src={images[0].url}
              alt={images[0].altText || "Attachment 1"}
              className="w-full h-full object-cover transition-transform group-hover:scale-103"
            />
          </div>
          <div className="grid grid-rows-2 gap-1 h-full">
            {images.slice(1, 3).map((img, i) => (
              <div
                key={img.id}
                onClick={() => setActiveModalItem(img)}
                className="h-full relative cursor-pointer overflow-hidden bg-neutral-900 group"
              >
                <img
                  src={img.url}
                  alt={img.altText || `Attachment ${i + 2}`}
                  className="w-full h-full object-cover transition-transform group-hover:scale-103"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {count >= 4 && (
        <div className="grid grid-cols-2 gap-1 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
          {images.slice(0, 4).map((img, i) => (
            <div
              key={img.id}
              onClick={() => setActiveModalItem(img)}
              className="aspect-square relative cursor-pointer overflow-hidden bg-neutral-900 group"
            >
              <img
                src={img.url}
                alt={img.altText || `Attachment ${i + 1}`}
                className="w-full h-full object-cover transition-transform group-hover:scale-103"
              />
              {count > 4 && i === 3 && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-lg font-bold">
                  +{count - 4}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      <Dialog open={activeModalItem !== null} onOpenChange={(open) => !open && setActiveModalItem(null)}>
        <DialogContent className="max-w-3xl p-3 bg-black/95 text-white border-neutral-800">
          <DialogHeader className="sr-only">
            <DialogTitle>Attachment Lightbox</DialogTitle>
          </DialogHeader>
          <div className="w-full flex items-center justify-center min-h-[300px]">
            <img
              src={activeModalItem?.url}
              alt={activeModalItem?.altText || "Full Preview"}
              className="max-w-full max-h-[75vh] object-contain rounded-md"
            />
          </div>
          {activeModalItem?.altText && (
            <p className="text-xs text-neutral-300 italic pt-1 text-center">
              Alt Text: "{activeModalItem.altText}"
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
