import type { ChatMessage } from "@/src/components/tribunal/ChatBubble";
import { backendUrl, type ImageCheckResponse } from "@/src/lib/api";

/**
 * Build chat messages for the image evidence check result.
 * One message per image, showing the uploaded photo + summary + status badge.
 */
export function imageCheckMessages(res: ImageCheckResponse | null): ChatMessage[] {
  if (!res || !res.images || res.images.length === 0) return [];

  return res.images.map((img) => ({
    id: `image-check-${img.image_id}`,
    side: "left" as const,
    speaker: "PROSECUTOR",
    speakerTitle: "Prosecutor",
    imageUrl: backendUrl(img.image_url),
    text: img.summary,
    badge: `Evidence Check · ${img.status}`,
  }));
}

/**
 * Build chat messages for verdict-rendered images.
 * Only for images whose verdict_image_url is not null.
 * Appends a cache-busting ?t= timestamp to prevent stale cached verdicts.
 */
export function verdictImageMessages(res: ImageCheckResponse | null): ChatMessage[] {
  if (!res || !res.images || res.images.length === 0) return [];

  return res.images
    .filter((img) => img.verdict_image_url)
    .map((img) => ({
      id: `verdict-image-${img.image_id}`,
      side: "left" as const,
      speaker: "PROSECUTOR",
      speakerTitle: "Prosecutor",
      imageUrl: `${backendUrl(img.verdict_image_url!)}?t=${Date.now()}`,
      text: img.summary,
      badge: "Evidence Verdict",
    }));
}
