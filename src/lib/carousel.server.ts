// Assembles a LinkedIn carousel document: a PDF where each page is one slide
// image at its native pixel size. LinkedIn renders document posts as swipeable
// carousels, so a stack of generated images becomes a carousel by way of PDF.
//
// Server-only: pdf-lib plus the service-role storage client live here, and the
// caller (a server fn) is responsible for auth/membership checks before
// handing over the admin client.

import { PDFDocument } from "pdf-lib";

const DATA_URL_RE = /^data:([\w./+-]+);base64,(.+)$/;

// LinkedIn caps documents at 100MB; stop at 90MB so we fail on our side with a
// clear message instead of letting LinkedIn reject the post later.
const MAX_PDF_BYTES = 90 * 1024 * 1024;

export async function assembleCarouselPdf(
  admin: { storage: any },
  workspaceId: string,
  images: string[],
  title: string,
): Promise<{ url: string; thumbnailUrl: string; pages: number; sizeBytes: number }> {
  if (images.length < 2 || images.length > 10) {
    throw new Error(`A carousel needs 2–10 pages, got ${images.length}.`);
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);

  for (let i = 0; i < images.length; i++) {
    const match = DATA_URL_RE.exec(images[i].trim());
    if (!match) throw new Error(`Carousel page ${i + 1} is not a base64 data URL.`);
    const mime = match[1].toLowerCase();
    const bytes = Buffer.from(match[2], "base64");
    // pdf-lib only embeds PNG and JPEG; anything else (webp, gif, svg) would
    // need a decode step we don't have server-side, so reject it up front.
    const embedded =
      mime === "image/png"
        ? await pdf.embedPng(bytes)
        : mime === "image/jpeg" || mime === "image/jpg"
          ? await pdf.embedJpg(bytes)
          : null;
    if (!embedded) {
      throw new Error(
        `Carousel page ${i + 1} is ${mime} — only image/png and image/jpeg can go into a carousel PDF.`,
      );
    }
    // Page size = the image's native pixel size, drawn full-bleed: no margins,
    // no scaling artefacts, and mixed aspect ratios each keep their own page.
    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }

  const pdfBytes = await pdf.save();
  if (pdfBytes.length > MAX_PDF_BYTES) {
    throw new Error(
      `Carousel PDF is ${(pdfBytes.length / (1024 * 1024)).toFixed(1)}MB — over the 90MB limit (LinkedIn caps documents at 100MB). Use fewer or smaller images.`,
    );
  }

  const path = `${workspaceId}/carousel-${crypto.randomUUID()}.pdf`;
  const up = await admin.storage.from("buffer-media").upload(path, Buffer.from(pdfBytes), {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);

  const signed = await admin.storage.from("buffer-media").createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(`Could not create public URL: ${signed.error?.message ?? "unknown"}`);
  }

  // Buffer downloads the document from its own servers, so the URL must
  // resolve publicly — same rewrite + guard as post images and videos.
  const { toPublicMediaUrl, assertPubliclyFetchable } = await import("./public-media.server");
  const url = toPublicMediaUrl(signed.data.signedUrl);
  assertPubliclyFetchable(url, "The carousel PDF");

  // Buffer's DocumentAssetInput REQUIRES thumbnailUrl (String!) — verified
  // against the live API, which rejects the mutation without it. The natural
  // thumbnail is the hook slide, hosted next to the PDF.
  const first = DATA_URL_RE.exec(images[0].trim());
  if (!first) throw new Error("Could not read the first slide for the thumbnail.");
  const thumbExt = first[1].split("/")[1]?.split("+")[0] || "png";
  const thumbPath = `${workspaceId}/carousel-thumb-${crypto.randomUUID()}.${thumbExt}`;
  const thumbUp = await admin.storage
    .from("buffer-media")
    .upload(thumbPath, Buffer.from(first[2], "base64"), {
      contentType: first[1],
      upsert: false,
    });
  if (thumbUp.error) throw new Error(`Thumbnail upload failed: ${thumbUp.error.message}`);
  const thumbSigned = await admin.storage
    .from("buffer-media")
    .createSignedUrl(thumbPath, 60 * 60 * 24 * 365);
  if (thumbSigned.error || !thumbSigned.data?.signedUrl) {
    throw new Error(
      `Could not create the thumbnail URL: ${thumbSigned.error?.message ?? "unknown"}`,
    );
  }
  const thumbnailUrl = toPublicMediaUrl(thumbSigned.data.signedUrl);

  return { url, thumbnailUrl, pages: images.length, sizeBytes: pdfBytes.length };
}
