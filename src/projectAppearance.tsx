import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Command } from "./commands";
import { ColorPicker, validHex } from "./ColorPicker";

type Settings = {
  path: string;
  color: string | null;
  revision: string | null;
  stamp: string | null;
};
export const projectColors = [
  "#fa9af4",
  "#355c7d",
  "#6b487d",
  "#376b62",
  "#80583b",
  "#774857",
  "#445b8a",
  "#665b32",
];
export function automaticColor(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360;
  const color = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(
      255 * (0.3 - 0.13 * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${color(0)}${color(8)}${color(4)}`;
}
export function contrastColor(color: string) {
  const rgb = [1, 3, 5].map((i) => {
    const value = parseInt(color.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return luminance > 0.179 ? "#101828" : "#ffffff";
}

export function useProjectAppearance(
  root: string,
  target: string,
  connected: boolean,
  report: (error: unknown) => void,
) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dialog, setDialog] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState("");
  const [working, setWorking] = useState(false);
  const latest = useRef<Settings | null>(null);
  const dialogRevision = useRef<string | null>(null);
  const errorHandler = useRef(report);
  errorHandler.current = report;
  const savedColor =
    settings?.color || (root ? automaticColor(`${target}:${root}`) : "#001126");
  const color = dialog && validHex(preview) ? preview : savedColor;
  const foreground = contrastColor(color);
  const accept = (value: Settings) => {
    latest.current = value;
    setSettings(value);
    return value;
  };
  async function reload() {
    return accept(
      await window.lwr.remote<Settings>("project-settings", { root }),
    );
  }
  useEffect(() => setDialog(false), [root, target, connected]);
  useEffect(() => {
    if (!root || !connected) return;
    let cancelled = false,
      pending = false,
      stamp: string | null | undefined;
    let lastError = "";
    const poll = async () => {
      if (pending || cancelled) return;
      pending = true;
      try {
        const [stat] = await window.lwr.remote<
          Array<{ stamp?: string; error?: string }>
        >("stats", { paths: [root + "/.owlet/settings.json"] });
        const next = stat.stamp ?? null;
        if (stamp === next) return;
        stamp = next;
        const value = await window.lwr.remote<Settings>("project-settings", {
          root,
        });
        if (!cancelled) {
          accept(value);
          lastError = "";
        }
      } catch (error) {
        if (!cancelled && String(error) !== lastError) {
          errorHandler.current(error);
          lastError = String(error);
        }
      } finally {
        pending = false;
      }
    };
    // Small, bounded config requests run alongside the directory listing.
    void poll();
    const timer = setInterval(poll, 2000);
    window.addEventListener("focus", poll);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [root, connected]);
  useEffect(() => {
    void window.lwr
      .appearance({
        color,
        foreground,
        title: `${root.split("/").filter(Boolean).pop() || "Workspace"} — Owlet · ${target}`,
      })
      .catch(errorHandler.current);
  }, [root, target, color, foreground]);
  async function save(value: string | null, revision?: string | null) {
    if (value !== null && !/^#[0-9a-f]{6}$/i.test(value))
      throw new Error("Use a six-digit color such as #fa9af4");
    const current = latest.current || (await reload());
    const result = await window.lwr.remote<Settings>("project-color", {
      root,
      color: value,
      revision: revision === undefined ? current.revision : revision,
    });
    accept(result);
    setDialog(false);
    return result;
  }
  const commands: Command[] = [
    {
      id: "project.color.importVSCode",
      title: "Project: Import Peacock Color from VS Code",
      enabled: connected && !!root,
      run: async () => {
        const current = await reload();
        const imported = await window.lwr.remote<{
          color: string;
          source: string;
          field: string;
        }>("import-peacock", { root });
        const result = await save(imported.color, current.revision);
        report(
          `Saved ${imported.color} to .owlet/settings.json from ${imported.field}. This is a one-time import.`,
        );
        return {
          ...result,
          importedFrom: imported.source,
          importedField: imported.field,
        };
      },
    },
    {
      id: "project.color.set",
      title: "Project: Choose Window Color",
      enabled: connected && !!root,
      parameters: {
        color: "Optional #RRGGBB; omit to open color chooser",
        revision: "Optional observed settings revision for conflict detection",
      },
      run: async (args) => {
        if (args.color !== undefined) return save(args.color, args.revision);
        const current = await reload();
        dialogRevision.current = current.revision;
        const initial = current.color || automaticColor(`${target}:${root}`);
        setDraft(initial);
        setPreview(initial);
        setDialog(true);
      },
    },
    {
      id: "project.color.reset",
      title: "Project: Use Automatic Window Color",
      enabled: connected && !!root,
      run: () => save(null),
    },
    {
      id: "project.settings.reload",
      title: "Project: Reload Settings",
      enabled: connected && !!root,
      run: reload,
    },
    {
      id: "project.settings.get",
      title: "Project: Inspect Window Color Settings",
      enabled: connected && !!root,
      run: async () => {
        const value = await reload();
        return {
          ...value,
          effectiveColor: value.color || automaticColor(`${target}:${root}`),
        };
      },
    },
  ];
  return {
    color,
    foreground,
    commands,
    style: {
      "--project-color": color,
      "--project-foreground": foreground,
    } as CSSProperties,
    dialog: dialog ? (
      <div
        className="modal-shade"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!working) setDialog(false);
          }
          if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
              ),
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <form
          className="modal color-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Project window color"
          onSubmit={async (event) => {
            event.preventDefault();
            setWorking(true);
            try {
              await window.lwrCommands.execute("project.color.set", {
                color: draft,
                revision: dialogRevision.current,
              });
            } catch (error) {
              report(error);
            } finally {
              setWorking(false);
            }
          }}
        >
          <h2>Project window color</h2>
          <fieldset
            className="color-controls"
            disabled={working}
            inert={working}
          >
            <ColorPicker
              initial={draft}
              palette={projectColors}
              onChange={(value) => {
                setDraft(value);
                if (validHex(value)) setPreview(value);
              }}
            />
          </fieldset>
          <div className="modal-actions">
            <button
              type="button"
              disabled={working}
              onClick={() => setDialog(false)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={working || !/^#[0-9a-f]{6}$/i.test(draft)}
              type="submit"
            >
              {working ? "Saving…" : "Save color"}
            </button>
          </div>
        </form>
      </div>
    ) : null,
  };
}
