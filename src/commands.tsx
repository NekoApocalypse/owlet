import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronRight } from "lucide-react";
export type CommandArgs = Record<string, any>;
export type Command = {
  id: string;
  title: string;
  keywords?: string[];
  shortcut?: string;
  enabled?: boolean;
  parameters?: Record<string, string>;
  run(args: CommandArgs): unknown | Promise<unknown>;
};
export type CommandInfo = Omit<Command, "run">;
declare global {
  interface Window {
    owletCommands: Window["lwrCommands"];
    lwrCommands: {
      list(): CommandInfo[];
      execute(id: string, args?: CommandArgs): Promise<unknown>;
    };
  }
}
export function useCommands(
  commands: Command[],
  onError: (error: unknown) => void,
) {
  const latest = useRef(commands);
  latest.current = commands;
  const error = useRef(onError);
  error.current = onError;
  const api = useMemo(
    () => ({
      list: () =>
        latest.current.map(({ run: _, ...info }) => ({
          ...info,
          enabled: info.enabled !== false,
        })),
      execute: async (id: string, args: CommandArgs = {}) => {
        const command = latest.current.find((item) => item.id === id);
        if (!command) throw new Error(`Unknown command: ${id}`);
        if (command.enabled === false)
          throw new Error(`Command is unavailable: ${command.title}`);
        return command.run(args);
      },
    }),
    [],
  );
  useEffect(() => {
    window.lwrCommands = api;
    window.owletCommands = api;
  }, [api]);
  return {
    api,
    execute: (id: string, args: CommandArgs = {}) => {
      void api.execute(id, args).catch(error.current);
    },
  };
}
function score(title: string, query: string) {
  title = title.toLowerCase();
  query = query.toLowerCase().trim();
  if (!query) return 1;
  if (title.includes(query)) return 100 - title.indexOf(query);
  let position = 0;
  for (const character of query.replace(/\s/g, "")) {
    const next = title.indexOf(character, position);
    if (next < 0) return 0;
    position = next + 1;
  }
  return 1;
}
export default function CommandPalette({
  commands,
  onExecute,
  onClose,
}: {
  commands: CommandInfo[];
  onExecute(id: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const results = commands
    .map((command) => ({
      command,
      score: Math.max(
        score(command.title, query),
        ...(command.keywords || []).map((keyword) => score(keyword, query)),
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSelected(0);
  }, [query]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div
      className="palette-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelected((value) => Math.min(value + 1, results.length - 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((value) => Math.max(0, value - 1));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const item = results[selected]?.command;
            if (item && item.enabled !== false) {
              onClose();
              onExecute(item.id);
            }
          }
        }}
      >
        <div className="palette-search">
          <Search size={17} />
          <input
            autoFocus
            aria-label="Search commands"
            placeholder="Type a command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-list" role="listbox" ref={list}>
          {results.map(({ command }, index) => (
            <button
              key={command.id}
              role="option"
              aria-selected={selected === index}
              disabled={command.enabled === false}
              className={`command-option ${selected === index ? "highlighted" : ""}`}
              onMouseMove={() => setSelected(index)}
              onClick={() => {
                onClose();
                onExecute(command.id);
              }}
            >
              <span>
                <ChevronRight size={12} />
                {command.title}
              </span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
          {!results.length && (
            <div className="no-commands">No matching commands</div>
          )}
        </div>
        <div className="palette-footer">
          <span>↑ ↓ navigate · Enter run</span>
          <span>{commands.length} commands · same actions as the UI</span>
        </div>
      </div>
    </div>
  );
}
