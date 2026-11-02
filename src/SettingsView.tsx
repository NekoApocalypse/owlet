import { useEffect, useState, useId } from "react";
import { Search, RotateCcw } from "lucide-react";
import {
  definitions,
  parseSettings,
  settingError,
  type SettingKey,
  type SettingDefinition,
} from "./settings";
function SettingInput({
  setting,
  inputId,
  definition,
  value,
  onChange,
}: {
  setting: SettingKey;
  inputId: string;
  definition: SettingDefinition;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed =
    typeof definition.default === "number"
      ? draft.trim()
        ? Number(draft)
        : NaN
      : draft;
  const error = settingError(setting, parsed);
  return (
    <>
      <input
        id={inputId}
        type={typeof definition.default === "number" ? "number" : "text"}
        min={definition.min}
        max={definition.max}
        step={definition.step || 1}
        value={draft}
        aria-invalid={!!error}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const v =
            typeof definition.default === "number"
              ? next.trim()
                ? Number(next)
                : NaN
              : next;
          if (!settingError(setting, v)) onChange(v);
        }}
      />
      {error && (
        <span className="settings-error" role="alert">
          Not applied: {error}
        </span>
      )}
    </>
  );
}
export default function SettingsView({
  text,
  file,
  onCommand,
}: {
  text: string;
  file: string;
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  const prefix = useId();
  const [query, setQuery] = useState("");
  let data: Record<string, unknown> = {},
    error = "";
  try {
    data = parseSettings(text);
  } catch (err) {
    error = String(err).replace(/^Error: /, "");
  }
  const visible = definitions.filter(([key, d]) =>
    `${key} ${d.group} ${d.label} ${d.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="settings-view">
      <div className="settings-search">
        <Search size={15} />
        <input
          aria-label="Search settings"
          placeholder="Search settings — font size, Vim, word wrap…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="settings-intro">
        User settings · Applies to local and SSH windows after Save.{" "}
        <span title={file}>{file}</span>
      </p>
      {error ? (
        <div role="alert" className="settings-error">
          {error}{" "}
          <button onClick={() => onCommand("settings.json")}>
            Fix in JSON
          </button>
        </div>
      ) : (
        <>
          {!visible.length && <p>No matching settings.</p>}
          {visible.map(([key, d], index) => {
            const value = Object.hasOwn(data, key) ? data[key] : d.default;
            const invalid = settingError(key, value);
            return (
              <div key={key}>
                {(index === 0 || visible[index - 1][1].group !== d.group) && (
                  <h2>{d.group}</h2>
                )}
                <div className="setting-row" data-setting={key}>
                  <div className="setting-description">
                    <label htmlFor={prefix + key}>{d.label}</label>
                    <code>{key}</code>
                    <p>{d.description}</p>
                  </div>
                  <div className="setting-control">
                    {d.enum ? (
                      <select
                        id={prefix + key}
                        value={String(value)}
                        onChange={(e) =>
                          onCommand("settings.update", {
                            key,
                            value: e.target.value,
                          })
                        }
                      >
                        {d.enum.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    ) : typeof d.default === "boolean" ? (
                      <input
                        id={prefix + key}
                        type="checkbox"
                        checked={value === true}
                        onChange={(e) =>
                          onCommand("settings.update", {
                            key,
                            value: e.target.checked,
                          })
                        }
                      />
                    ) : (
                      <SettingInput
                        setting={key}
                        inputId={prefix + key}
                        definition={d}
                        value={value}
                        onChange={(value) =>
                          onCommand("settings.update", { key, value })
                        }
                      />
                    )}
                    <button
                      title={`Reset ${key} to default`}
                      aria-label={`Reset ${key}`}
                      disabled={!Object.hasOwn(data, key)}
                      onClick={() => onCommand("settings.reset", { key })}
                    >
                      <RotateCcw size={13} />
                    </button>
                    {invalid && (
                      <span role="alert" className="settings-error">
                        {invalid}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="settings-project">
            <h2>Project window color</h2>
            <p>
              Each project keeps its own color in{" "}
              <code>.owlet/settings.json</code>.
            </p>
            <button onClick={() => onCommand("project.color.set")}>
              Choose project color
            </button>
          </div>
          {Object.keys(data).some(
            (key) => !definitions.some(([known]) => known === key),
          ) && (
            <p className="settings-intro">
              Unrecognized keys are preserved in JSON and have no effect.
            </p>
          )}
        </>
      )}
    </div>
  );
}
