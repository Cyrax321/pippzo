import { useState, useRef, useEffect, useCallback, type DragEvent, type ClipboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Upload,
  Image as ImageIcon,
  Film,
  Sparkles,
  X,
  Settings,
  Eye,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Camera,
  Play,
  Pause,
  AlertCircle,
  FileCheck,
  Library,
  Maximize2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

export type AttachedMedia = {
  id: string;
  url: string; // dataUrl or public/storage URL
  type: "image" | "video";
  name: string;
  sizeBytes?: number;
  mimeType?: string;
  altText?: string;
  thumbnailUrl?: string; // Captured frame or custom image
  durationSec?: number;
};

const MAX_IMAGE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_MEDIA_ITEMS = 10;

export interface MediaUploaderProps {
  media: AttachedMedia[];
  onChange: (media: AttachedMedia[]) => void;
  onOpenLibrary?: () => void;
  onGenerateAiImage?: () => void;
  onGenerateAiVideo?: () => void;
  generatingAiImage?: boolean;
  generatingAiVideo?: boolean;
  canGenerateAiImage?: boolean;
  activePlatform?: string;
}

export function MediaUploader({
  media,
  onChange,
  onOpenLibrary,
  onGenerateAiImage,
  onGenerateAiVideo,
  generatingAiImage,
  generatingAiVideo,
  canGenerateAiImage,
  activePlatform = "x",
}: MediaUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Settings modal state
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const selectedMedia = selectedMediaIndex !== null ? media[selectedMediaIndex] : null;

  // Video scrubber state (inspired by Postiz media.settings.component)
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const [customThumbnailUrl, setCustomThumbnailUrl] = useState<string | null>(null);
  const [editingAltText, setEditingAltText] = useState("");

  // Fullscreen preview modal
  const [previewItem, setPreviewItem] = useState<AttachedMedia | null>(null);

  // Sync modal state when an item is selected for editing
  useEffect(() => {
    if (selectedMedia) {
      setEditingAltText(selectedMedia.altText || "");
      setCustomThumbnailUrl(selectedMedia.thumbnailUrl || null);
      setCurrentTime(0);
      setIsPlaying(false);
    }
  }, [selectedMedia]);

  const processFile = useCallback(
    async (file: File): Promise<AttachedMedia | null> => {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      if (!isImage && !isVideo) {
        toast.error(`File "${file.name}" is not a supported format. Please upload JPG, PNG, GIF, WebP, or MP4.`);
        return null;
      }

      if (isImage && file.size > MAX_IMAGE_SIZE_BYTES) {
        toast.error(`Image "${file.name}" exceeds the 30MB limit.`);
        return null;
      }

      if (isVideo && file.size > MAX_VIDEO_SIZE_BYTES) {
        toast.error(`Video "${file.name}" exceeds the 100MB limit.`);
        return null;
      }

      return new Promise<AttachedMedia | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result as string;
          const id = `media-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          if (isVideo) {
            // Attempt to get video duration & initial poster frame
            const tempVideo = document.createElement("video");
            tempVideo.preload = "metadata";
            tempVideo.src = url;
            tempVideo.onloadedmetadata = () => {
              const durationSec = Math.round(tempVideo.duration) || 0;
              resolve({
                id,
                url,
                type: "video",
                name: file.name,
                sizeBytes: file.size,
                mimeType: file.type,
                durationSec,
              });
            };
            tempVideo.onerror = () => {
              resolve({
                id,
                url,
                type: "video",
                name: file.name,
                sizeBytes: file.size,
                mimeType: file.type,
              });
            };
          } else {
            resolve({
              id,
              url,
              type: "image",
              name: file.name,
              sizeBytes: file.size,
              mimeType: file.type,
            });
          }
        };
        reader.onerror = () => {
          toast.error(`Failed to read "${file.name}".`);
          resolve(null);
        };
        reader.readAsDataURL(file);
      });
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files);
      if (fileArr.length === 0) return;

      const remainingSlots = MAX_MEDIA_ITEMS - media.length;
      if (remainingSlots <= 0) {
        toast.warning(`Maximum ${MAX_MEDIA_ITEMS} media items allowed.`);
        return;
      }

      const filesToProcess = fileArr.slice(0, remainingSlots);
      const loadingToast = toast.loading(`Processing ${filesToProcess.length} file(s)...`);

      const processed: AttachedMedia[] = [];
      for (const file of filesToProcess) {
        const item = await processFile(file);
        if (item) processed.push(item);
      }

      toast.dismiss(loadingToast);

      if (processed.length > 0) {
        onChange([...media, ...processed]);
        toast.success(`Added ${processed.length} media item(s).`);
      }
    },
    [media, onChange, processFile],
  );

  // Drag and Drop listeners
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  // Clipboard paste support (e.g. paste screenshot)
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (!e.clipboardData.files || e.clipboardData.files.length === 0) return;
    e.preventDefault();
    void handleFiles(e.clipboardData.files);
  };

  // Reordering items
  const moveMedia = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= media.length) return;
    const updated = [...media];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onChange(updated);
  };

  // Remove item
  const removeMedia = (index: number) => {
    const updated = media.filter((_, i) => i !== index);
    onChange(updated);
    if (selectedMediaIndex === index) {
      setSelectedMediaIndex(null);
    } else if (selectedMediaIndex !== null && selectedMediaIndex > index) {
      setSelectedMediaIndex(selectedMediaIndex - 1);
    }
    toast.info("Media item removed.");
  };

  // Video Scrubber & Frame Grabber (Postiz feature)
  const handleCaptureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsCapturingFrame(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setIsCapturingFrame(false);
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const posterDataUrl = canvas.toDataURL("image/jpeg", 0.88);
      setCustomThumbnailUrl(posterDataUrl);
      toast.success("Captured video frame as custom thumbnail!");
    } catch (err) {
      console.error(err);
      toast.error("Could not capture frame from video.");
    } finally {
      setIsCapturingFrame(false);
    }
  };

  // Save Settings Modal
  const saveMediaSettings = () => {
    if (selectedMediaIndex === null) return;
    const updated = [...media];
    updated[selectedMediaIndex] = {
      ...updated[selectedMediaIndex],
      altText: editingAltText.trim() || undefined,
      thumbnailUrl: customThumbnailUrl || undefined,
    };
    onChange(updated);
    setSelectedMediaIndex(null);
    toast.success("Media settings saved.");
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="space-y-3" onPaste={onPaste}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Main Dropzone / Action Area */}
      {media.length === 0 ? (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
            isDragging
              ? "border-primary bg-primary/5 scale-[1.008]"
              : "border-border hover:border-foreground/30 bg-muted/20"
          }`}
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-background border border-border shadow-xs">
            <Upload className={`h-5 w-5 ${isDragging ? "text-primary animate-bounce" : "text-muted-foreground"}`} />
          </div>

          <p className="mt-3 text-sm font-medium">
            {isDragging ? "Drop your images or videos here" : "Drag & drop media or paste from clipboard"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            Upload images (PNG, JPG, WebP, GIF up to 30MB) or videos (MP4, MOV up to 100MB). Supports multi-image carousels.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5 h-8 text-xs font-medium"
            >
              <Upload className="h-3.5 w-3.5" /> Choose Files
            </Button>

            {onOpenLibrary && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenLibrary}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <Library className="h-3.5 w-3.5" /> From Library
              </Button>
            )}

            {onGenerateAiImage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={generatingAiImage || !canGenerateAiImage}
                onClick={onGenerateAiImage}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {generatingAiImage ? "Generating..." : "AI Image"}
              </Button>
            )}

            {onGenerateAiVideo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={generatingAiVideo}
                onClick={onGenerateAiVideo}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <Film className="h-3.5 w-3.5 text-primary" />
                {generatingAiVideo ? "Rendering..." : "AI Video"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header with counter and add button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Attached Media ({media.length}/{MAX_MEDIA_ITEMS})
              </span>
              {activePlatform === "x" && media.length > 4 && (
                <Badge variant="destructive" className="text-[10px] h-4">
                  X allows max 4 photos
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-7 text-xs gap-1 px-2"
                title="Add more files"
              >
                <Upload className="h-3 w-3" /> Add More
              </Button>

              {onOpenLibrary && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onOpenLibrary}
                  className="h-7 text-xs gap-1 px-2"
                >
                  <Library className="h-3 w-3" /> Library
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                className="h-7 text-xs text-destructive hover:text-destructive gap-1 px-2"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </Button>
            </div>
          </div>

          {/* Media Grid / Filmstrip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {media.map((item, index) => (
              <div
                key={item.id}
                className="group relative rounded-lg border border-border bg-card overflow-hidden transition-all hover:border-foreground/30 shadow-xs"
              >
                {/* Media Preview Thumbnail */}
                <div
                  className="aspect-square relative cursor-pointer bg-neutral-900 overflow-hidden flex items-center justify-center"
                  onClick={() => setSelectedMediaIndex(index)}
                >
                  {item.type === "video" ? (
                    item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt={item.altText || item.name} className="w-full h-full object-cover" />
                    ) : (
                      <video src={item.url} className="w-full h-full object-cover" />
                    )
                  ) : (
                    <img src={item.url} alt={item.altText || item.name} className="w-full h-full object-cover" />
                  )}

                  {/* Play badge for videos */}
                  {item.type === "video" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="w-8 h-8 rounded-full bg-white/90 text-black flex items-center justify-center shadow-md">
                        <Play className="h-4 w-4 ml-0.5 fill-black" />
                      </div>
                    </div>
                  )}

                  {/* Order & Type Badges */}
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                    <Badge variant="secondary" className="text-[10px] h-4.5 px-1.5 font-mono bg-background/85 backdrop-blur-xs">
                      #{index + 1}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] h-4.5 px-1 bg-background/85 uppercase">
                      {item.type}
                    </Badge>
                  </div>

                  {/* Hover Overlay with Action Buttons */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewItem(item);
                        }}
                        className="p-1 rounded-md bg-white/20 hover:bg-white/40 text-white transition-colors"
                        title="View Full Preview"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMediaIndex(index);
                        }}
                        className="p-1 rounded-md bg-white/20 hover:bg-white/40 text-white transition-colors"
                        title="Edit Settings & Alt Text"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMedia(index);
                        }}
                        className="p-1 rounded-md bg-destructive/80 hover:bg-destructive text-white transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Reorder arrows */}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveMedia(index, index - 1);
                        }}
                        className="p-1 rounded-md bg-white/20 hover:bg-white/40 disabled:opacity-30 text-white"
                        title="Move Earlier"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>

                      <span className="text-[10px] text-white/90 truncate max-w-[80px]">
                        {item.name}
                      </span>

                      <button
                        type="button"
                        disabled={index === media.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveMedia(index, index + 1);
                        }}
                        className="p-1 rounded-md bg-white/20 hover:bg-white/40 disabled:opacity-30 text-white"
                        title="Move Later"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Caption / Alt status footer */}
                <div className="p-1.5 text-[11px] truncate text-muted-foreground flex items-center justify-between border-t border-border/50">
                  <span className="truncate">{item.altText ? `Alt: "${item.altText}"` : item.name}</span>
                  {item.altText && <FileCheck className="h-3 w-3 text-emerald-500 shrink-0" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden canvas for video frame extraction */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Postiz-Inspired Media Settings & Video Frame Scrubber Dialog */}
      <Dialog open={selectedMediaIndex !== null} onOpenChange={(open) => !open && setSelectedMediaIndex(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              <span>Media Settings & Accessibility</span>
            </DialogTitle>
            <DialogDescription>
              Configure alt text for accessibility, or scrub through video frames to pick a custom thumbnail.
            </DialogDescription>
          </DialogHeader>

          {selectedMedia && (
            <div className="space-y-4 pt-1">
              {/* If Video: Interactive Video Scrubber & Frame Grabber */}
              {selectedMedia.type === "video" ? (
                <div className="space-y-3 bg-muted/30 border border-border rounded-xl p-3">
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-black flex items-center justify-center">
                    <video
                      ref={videoRef}
                      src={selectedMedia.url}
                      onTimeUpdate={() => {
                        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                      }}
                      onLoadedMetadata={() => {
                        if (videoRef.current) setVideoDuration(videoRef.current.duration);
                      }}
                      onEnded={() => setIsPlaying(false)}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* Scrubber Controls */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono">{formatSeconds(currentTime)}</span>
                      <span className="font-medium text-foreground">Scrub timeline to pick thumbnail</span>
                      <span className="font-mono">{formatSeconds(videoDuration)}</span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max={videoDuration || 100}
                      step="0.05"
                      value={currentTime}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCurrentTime(val);
                        if (videoRef.current) {
                          videoRef.current.currentTime = val;
                        }
                      }}
                      className="w-full accent-primary h-1.5 cursor-pointer bg-muted rounded-lg"
                    />

                    <div className="flex items-center justify-between pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (!videoRef.current) return;
                          if (isPlaying) {
                            videoRef.current.pause();
                            setIsPlaying(false);
                          } else {
                            videoRef.current.play();
                            setIsPlaying(true);
                          }
                        }}
                        className="h-8 gap-1.5 text-xs"
                      >
                        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {isPlaying ? "Pause" : "Play"}
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isCapturingFrame}
                        onClick={handleCaptureFrame}
                        className="h-8 gap-1.5 text-xs font-medium"
                      >
                        <Camera className="h-3.5 w-3.5 text-primary" />
                        Capture Frame as Thumbnail
                      </Button>
                    </div>
                  </div>

                  {/* Thumbnail Preview */}
                  {customThumbnailUrl && (
                    <div className="pt-2 border-t border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img src={customThumbnailUrl} alt="Thumbnail preview" className="w-12 h-8 object-cover rounded border" />
                        <span className="text-xs font-medium">Custom thumbnail set</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCustomThumbnailUrl(null)}
                        className="h-7 text-xs text-destructive"
                      >
                        Reset to default
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                /* If Image: Image Preview */
                <div className="aspect-video relative rounded-lg overflow-hidden border border-border bg-neutral-900 flex items-center justify-center">
                  <img src={selectedMedia.url} alt={selectedMedia.name} className="max-w-full max-h-full object-contain" />
                </div>
              )}

              {/* Alt Text Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="alt-text" className="text-xs font-semibold uppercase tracking-wider">
                    Alt Text (Accessibility)
                  </Label>
                  <span className="text-[11px] text-muted-foreground">{editingAltText.length}/1000</span>
                </div>
                <Input
                  id="alt-text"
                  value={editingAltText}
                  onChange={(e) => setEditingAltText(e.target.value)}
                  placeholder="Describe this visual for people using screen readers..."
                  maxLength={1000}
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Platforms like X, LinkedIn, and Facebook use alt text to make your content accessible to visually impaired audiences.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSelectedMediaIndex(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveMediaSettings}>
              Save Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fullscreen Preview Modal */}
      <Dialog open={previewItem !== null} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="max-w-3xl p-4">
          <DialogHeader>
            <DialogTitle className="text-base truncate">{previewItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg overflow-hidden bg-black flex items-center justify-center min-h-[300px] max-h-[70vh]">
            {previewItem?.type === "video" ? (
              <video src={previewItem.url} controls autoPlay className="max-w-full max-h-[65vh] object-contain" />
            ) : (
              <img src={previewItem?.url} alt={previewItem?.altText || "Preview"} className="max-w-full max-h-[65vh] object-contain" />
            )}
          </div>
          {previewItem?.altText && (
            <p className="text-xs text-muted-foreground italic pt-1">
              Alt Text: "{previewItem.altText}"
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
