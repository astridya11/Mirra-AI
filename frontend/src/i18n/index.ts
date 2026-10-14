import { enMessages } from "./messages/en";
import { zhMessages } from "./messages/zh";
import type { Locale } from "./config";
import type { Messages } from "./types";

const messagesByLocale: Record<Locale, Messages> = {
  en: enMessages,
  zh: zhMessages,
};

export type { Messages } from "./types";

export function getMessages(locale: Locale): Messages {
  return messagesByLocale[locale] ?? enMessages;
}
