import { useI18n } from "@/src/context/I18nContext";

/**
 * Lightweight translation hook.
 * Usage: const t = useTranslation(); t("home.headline")
 *
 * Supports nested keys via dot notation.
 */
export function useTranslation() {
  const { messages } = useI18n();

  function t(key: string): string {
    const parts = key.split(".");
    let current: unknown = messages;
    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return key;
      }
    }
    return typeof current === "string" ? current : key;
  }

  return t;
}
