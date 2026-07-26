import { en } from "./i18n/en.js";
import { zh } from "./i18n/zh.js";

type Translations = typeof en;

function detectLanguage(): "en" | "zh" {
	const locale = process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG ?? "";
	if (locale.toLowerCase().startsWith("zh")) return "zh";
	return "en";
}

const lang = detectLanguage();

const translations: Record<string, Translations> = { en, zh };

function t(path: string, ...args: Array<string | number>): string {
	const keys = path.split(".");
	let value: unknown = translations[lang];
	for (const key of keys) {
		if (value == null || typeof value !== "object") return path;
		value = (value as Record<string, unknown>)[key];
	}
	let text = typeof value === "string" ? value : path;
	for (let i = 0; i < args.length; i++) {
		text = text.replace(`{${i}}`, String(args[i]));
	}
	return text;
}

export { t, lang };
