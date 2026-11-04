import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AboutInfo } from "./types";
import type { Command } from "./commands";
const logo = new URL("../assets/icon.png", import.meta.url).href;
export function versionText(info: AboutInfo) {
  return [
    `Owlet ${info.version}`,
    `Build: ${info.build.label}${info.build.dirty ? " (modified source)" : ""}`,
    `Commit: ${info.build.commit || "not recorded"}`,
    `Built: ${info.build.builtAt || "not recorded"}`,
    `Platform: ${info.platform} ${info.arch}`,
    `Electron: ${info.runtime.electron}`,
    `Chromium: ${info.runtime.chromium}`,
    `Node.js: ${info.runtime.node}`,
  ].join("\n");
}
function AboutDialog({
  info,
  onClose,
  onError,
}: {
  info: AboutInfo;
  onClose(): void;
  onError(error: unknown): void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
        if (event.key === "Tab") {
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button",
            ),
          ];
          const first = buttons[0],
            last = buttons.at(-1);
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
      <section
        className="modal about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="About Owlet"
      >
        <div className="about-header">
          <img src={logo} alt="" />
          <div>
            <h2>Owlet</h2>
            <p>Less between you and your work</p>
          </div>
          <button ref={close} onClick={onClose} aria-label="Close About Owlet">
            <X size={16} />
          </button>
        </div>
        <dl>
          <dt>Version</dt>
          <dd>{info.version}</dd>
          <dt>Build</dt>
          <dd title={info.build.commit || undefined}>
            {info.build.label}
            {info.build.commit ? ` · ${info.build.commit.slice(0, 7)}` : ""}
            {info.build.dirty ? " · modified source" : ""}
          </dd>
          <dt>Platform</dt>
          <dd>
            {info.platform === "win32" ? "Windows" : info.platform} {info.arch}
          </dd>
        </dl>
        <div className="modal-actions">
          <button
            onClick={() =>
              void window.owletCommands
                .execute("link.openExternal", {
                  url: "https://github.com/NekoApocalypse/owlet",
                })
                .catch(onError)
            }
          >
            GitHub
          </button>
          <button
            className="primary-button"
            onClick={() =>
              void window.owletCommands
                .execute("help.copyVersion")
                .catch(onError)
            }
          >
            Copy version info
          </button>
        </div>
      </section>
    </div>
  );
}
export function useAbout(report: (error: unknown) => void) {
  const [info, setInfo] = useState<AboutInfo>();
  const commands: Command[] = [
    {
      id: "help.about",
      title: "Help: About Owlet",
      keywords: ["version", "build", "diagnostics"],
      parameters: {
        readOnly:
          "true returns version/build information without opening the dialog",
      },
      run: async (args) => {
        const value = await window.lwr.about();
        if (!args.readOnly) setInfo(value);
        return value;
      },
    },
    {
      id: "help.copyVersion",
      title: "Help: Copy Version Info",
      keywords: ["diagnostics", "build"],
      run: async () => {
        const value = await window.lwr.about();
        await navigator.clipboard.writeText(versionText(value));
        report("Copied version info");
        return value;
      },
    },
  ];
  return {
    commands,
    dialog: info ? (
      <AboutDialog
        info={info}
        onClose={() => setInfo(undefined)}
        onError={report}
      />
    ) : null,
  };
}
