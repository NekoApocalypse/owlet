import { parse, printParseErrorCode, modify, applyEdits } from "jsonc-parser";
import schema from "../electron/settings-schema.json";
export { schema };
export const SETTINGS_PATH = "owlet://user/settings.json";
export type Settings = {
  [K in keyof typeof schema]: (typeof schema)[K]["default"];
};
export type SettingKey = keyof Settings;
export type SettingDefinition = {
  group: string;
  label: string;
  description: string;
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  enum?: string[];
  allowEmpty?: boolean;
};
export const definitions = Object.entries(schema) as [
  SettingKey,
  SettingDefinition,
][];
export const defaults = Object.fromEntries(
  definitions.map(([key, item]) => [key, item.default]),
) as Settings;
export function parseSettings(text: string): Record<string, unknown> {
  const errors: import("jsonc-parser").ParseError[] = [];
  const data = parse(text, errors, { allowTrailingComma: true });
  if (errors.length)
    throw new Error(
      `Invalid JSON: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}.`,
    );
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Settings must be a JSON object.");
  return data;
}
export function settingError(key: SettingKey, value: unknown) {
  const d: SettingDefinition = schema[key];
  if (typeof value !== typeof d.default) return `Expected ${typeof d.default}.`;
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      value < d.min! ||
      value > d.max! ||
      (!d.step && !Number.isInteger(value)))
  )
    return `Use ${d.step ? "a number" : "an integer"} between ${d.min} and ${d.max}.`;
  if (
    typeof value === "string" &&
    ((!value.trim() && !d.allowEmpty) || value.length > 256)
  )
    return "Use 1–256 characters.";
  if (d.enum && !d.enum.includes(value as string))
    return `Choose ${d.enum.join(", ")}.`;
}
export function resolveSettings(text: string): Settings {
  const data = parseSettings(text);
  for (const [key] of definitions)
    if (Object.hasOwn(data, key)) {
      const error = settingError(key, data[key]);
      if (error) throw new Error(`${key}: ${error}`);
    }
  return Object.fromEntries(
    definitions.map(([key, d]) => [key, data[key] ?? d.default]),
  ) as Settings;
}
export function editSetting(text: string, key: string, value: unknown): string {
  if (!Object.hasOwn(schema, key)) throw new Error("Unknown setting: " + key);
  parseSettings(text);
  if (value !== undefined) {
    const error = settingError(key as SettingKey, value);
    if (error) throw new Error(`${key}: ${error}`);
  }
  return applyEdits(
    text,
    modify(text, [key], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    }),
  );
}
