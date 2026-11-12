import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, RotateCw, Square, X } from "lucide-react";
import type { Settings } from "./settings";
import { basename } from "./types";
import { FileIcon } from "./FileIcon";
export type SearchMatch = {
  path: string;
  line: number;
  column: number;
  match: string;
  text: string;
  start: number;
  end: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};
type Form = {
  query: string;
  directory: string;
  include: string;
  exclude?: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  includeHidden: boolean;
  includeIgnored: boolean;
};
type SearchState = {
  id?: string;
  status: "idle" | "running" | "complete" | "limited" | "stopped" | "error";
  matches: SearchMatch[];
  reason: string;
  scope: string;
  request?: Record<string, any>;
};
const initialForm: Form = {
  query: "",
  directory: "",
  include: "",
  caseSensitive: false,
  wholeWord: false,
  includeHidden: false,
  includeIgnored: false,
};
export function useProjectSearch(
  root: string,
  connected: boolean,
  settings: Settings,
) {
  const [form, setForm] = useState<Form>(initialForm),
    formRef = useRef(form);
  const [state, setState] = useState<SearchState>({
    status: "idle",
    matches: [],
    reason: "",
    scope: root,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const current = useRef<string | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  function configure(args: Record<string, any>) {
    const next = { ...formRef.current };
    for (const key of Object.keys(initialForm).concat(
      "exclude",
    ) as (keyof Form)[]) {
      if (args[key] === undefined) continue;
      if (
        typeof args[key] !==
        (typeof initialForm[key] === "boolean" ? "boolean" : "string")
      )
        throw Error(`Invalid search ${key}`);
      (next as any)[key] = args[key];
    }
    formRef.current = next;
    setForm(next);
    return next;
  }
  function stop() {
    clearTimeout(timer.current);
    const id = current.current;
    current.current = null;
    if (id) {
      void window.lwr.projectSearch("stop", { id }).catch(() => {});
      setState((previous) => ({
        ...previous,
        status: "stopped",
        reason: "Stopped by user",
      }));
    }
  }
  async function run(args: Record<string, any> = {}) {
    stop();
    if (!connected || !root)
      throw Error("Connect to a workspace before searching.");
    const next = configure(args);
    if (!next.query.trim()) {
      setState({ status: "idle", matches: [], reason: "", scope: root });
      return;
    }
    const limits = Object.fromEntries(
      [
        "maxResults",
        "timeoutSeconds",
        "maxResultMB",
        "maxFileSizeMB",
        "maxDepth",
        "threads",
      ].map((key) => [
        key,
        args[key] ?? settings[`search.${key}` as keyof Settings],
      ]),
    );
    const id = crypto.randomUUID(),
      request = {
        ...next,
        exclude: next.exclude ?? settings["search.exclude"],
        ...limits,
        id,
      };
    current.current = id;
    setCollapsed(new Set());
    setState({
      id,
      status: "running",
      matches: [],
      reason: "",
      scope: next.directory || root,
      request,
    });
    try {
      await window.lwr.projectSearch("start", request);
      const poll = async () => {
        if (current.current !== id) return;
        try {
          const result = await window.lwr.projectSearch("poll", { id });
          if (current.current !== id) return;
          setState((previous) => ({
            ...previous,
            matches: [...previous.matches, ...result.matches],
            status: result.pending ? "running" : result.status,
            reason: result.reason || "",
            scope: result.scope,
          }));
          if (result.pending || result.status === "running")
            timer.current = setTimeout(poll, 100);
          else current.current = null;
        } catch (error) {
          if (current.current !== id) return;
          current.current = null;
          setState((previous) => ({
            ...previous,
            status: "error",
            reason: String(error).replace(/^Error: /, ""),
          }));
        }
      };
      void poll();
      return { id };
    } catch (error) {
      if (current.current === id) {
        current.current = null;
        setState((previous) => ({
          ...previous,
          status: "error",
          reason: String(error).replace(/^Error: /, ""),
        }));
      }
      throw error;
    }
  }
  function edit(args: Partial<Form>) {
    stop();
    configure(args);
    setState({
      status: "idle",
      matches: [],
      reason: "",
      scope: formRef.current.directory || root,
    });
    if (formRef.current.query.trim())
      timer.current = setTimeout(() => {
        void window.owletCommands.execute("search.run").catch(() => {});
      }, 400);
  }
  function clear() {
    stop();
    configure({ query: "" });
    setState({ status: "idle", matches: [], reason: "", scope: root });
  }
  function more() {
    const previous = stateRef.current.request || {};
    return run({
      ...previous,
      maxResults: Math.min(10000, (previous.maxResults || 2000) * 2),
      timeoutSeconds: Math.min(120, (previous.timeoutSeconds || 15) * 2),
      maxResultMB: Math.min(8, (previous.maxResultMB || 2) * 2),
    });
  }
  function toggleFile(path: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }
  useEffect(() => {
    stop();
    configure({ directory: "" });
    setState((previous) => ({
      ...previous,
      status: previous.status === "running" ? "stopped" : "idle",
      matches: [],
      reason: "",
      scope: root,
    }));
    return stop;
  }, [root, connected]);
  return {
    form,
    state,
    input,
    collapsed,
    configure,
    run,
    stop,
    edit,
    clear,
    more,
    toggleFile,
  };
}
export default function ProjectSearch({
  model,
  settings,
  root,
  dirty,
  navigation,
  onCommand,
}: {
  model: ReturnType<typeof useProjectSearch>;
  settings: Settings;
  root: string;
  dirty: boolean;
  navigation: ReactNode;
  onCommand(id: string, args?: Record<string, any>): void;
}) {
  const { form, state, edit } = model;
  const viewport = useRef<HTMLDivElement>(null),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(500);
  const relative = (path: string) =>
    path
      .replaceAll("\\", "/")
      .slice(root.replaceAll("\\", "/").replace(/\/$/, "").length + 1);
  const rows = useMemo(() => {
    const files = new Map<string, { item: SearchMatch; index: number }[]>();
    state.matches.forEach((item, index) => {
      if (!files.has(item.path)) files.set(item.path, []);
      files.get(item.path)!.push({ item, index });
    });
    const result: (
      { path: string; count: number } | { item: SearchMatch; index: number }
    )[] = [];
    for (const [path, matches] of files) {
      result.push({ path, count: matches.length });
      if (!model.collapsed.has(path)) result.push(...matches);
    }
    return result;
  }, [state.matches, model.collapsed]);
  useEffect(() => {
    viewport.current?.scrollTo(0, 0);
    setScroll(0);
  }, [state.id]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const first = Math.max(
      0,
      Math.min(Math.floor(scroll / 22) - 5, Math.max(0, rows.length - 1)),
    ),
    last = Math.min(rows.length, first + Math.ceil(height / 22) + 10);
  const request = state.request;
  return (
    <section className="project-search" aria-label="Project search">
      <div className="section-label">
        {navigation}
        <div className="actions">
          <button
            aria-label="Rerun search"
            title="Rerun search"
            onClick={() => onCommand("search.run")}
          >
            <RotateCw size={13} />
          </button>
          <button
            aria-label="Stop search"
            title="Stop search"
            disabled={state.status !== "running"}
            onClick={() => onCommand("search.stop")}
          >
            <Square size={12} />
          </button>
          <button
            aria-label="Clear search"
            title="Clear search"
            onClick={() => onCommand("search.clear")}
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <form
        className="project-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCommand("search.run");
        }}
      >
        <div className="project-query">
          <input
            ref={model.input}
            aria-label="Search project text"
            placeholder="Search text"
            value={form.query}
            maxLength={512}
            onChange={(event) => edit({ query: event.target.value })}
          />
          <button
            type="button"
            title="Match case"
            aria-label="Match case"
            aria-pressed={form.caseSensitive}
            onClick={() =>
              onCommand("search.run", { caseSensitive: !form.caseSensitive })
            }
          >
            Aa
          </button>
          <button
            type="button"
            title="Match whole word"
            aria-label="Match whole word"
            aria-pressed={form.wholeWord}
            onClick={() =>
              onCommand("search.run", { wholeWord: !form.wholeWord })
            }
          >
            ab
          </button>
        </div>
        <label>
          Search folder
          <input
            aria-label="Search folder"
            placeholder="Entire workspace"
            value={form.directory}
            onChange={(event) => edit({ directory: event.target.value })}
          />
        </label>
        <label>
          Files to include
          <input
            aria-label="Files to include"
            placeholder="e.g. *.md, docs/**"
            value={form.include}
            onChange={(event) => edit({ include: event.target.value })}
          />
        </label>
        <label>
          Files to exclude
          <input
            aria-label="Files to exclude"
            value={form.exclude ?? settings["search.exclude"]}
            onChange={(event) => edit({ exclude: event.target.value })}
          />
        </label>
        <div className="project-search-options">
          <label>
            <input
              type="checkbox"
              checked={form.includeIgnored}
              onChange={(event) =>
                onCommand("search.run", {
                  includeIgnored: event.target.checked,
                })
              }
            />
            Ignored files
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.includeHidden}
              onChange={(event) =>
                onCommand("search.run", { includeHidden: event.target.checked })
              }
            />
            Hidden files
          </label>
        </div>
      </form>
      <div className="project-search-summary" role="status">
        <span>
          {state.status === "idle"
            ? "Search saved text in this workspace"
            : `${state.matches.length} matching line${state.matches.length === 1 ? "" : "s"} · ${{ running: "Searching…", complete: "Complete within scope", limited: "Limited", stopped: "Stopped", error: "Search failed" }[state.status]}`}
        </span>
        {state.reason && (
          <span className={state.status === "error" ? "search-error" : ""}>
            {state.reason}
          </span>
        )}
        {request && (
          <span className="search-scope-note" title={state.scope}>
            {relative(state.scope) || basename(state.scope)} · ≤
            {request.maxFileSizeMB} MiB/file ·{" "}
            {request.maxDepth ? `depth ${request.maxDepth}` : "all depths"} ·{" "}
            {request.timeoutSeconds}s limit
            {!request.includeIgnored ? " · ignore files apply" : ""}
            {!request.includeHidden ? " · hidden excluded" : ""}
          </span>
        )}
        {dirty && <span>Unsaved changes are not included.</span>}
        {request?.include && (
          <span>Explicit includes override ignore and hidden-file rules.</span>
        )}
        {state.status === "limited" && (
          <div className="search-limit-actions">
            <button onClick={() => onCommand("search.scope")}>
              Narrow scope
            </button>
            <button onClick={() => onCommand("search.more")}>
              Rerun with higher limits
            </button>
          </div>
        )}
      </div>
      <div
        className="project-results"
        ref={viewport}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
        aria-label="Project search results"
      >
        <div style={{ height: rows.length * 22, position: "relative" }}>
          {rows.slice(first, last).map((row, offset) =>
            "path" in row ? (
              <button
                key={row.path}
                className="project-result-file"
                style={{ top: (first + offset) * 22 }}
                title={row.path}
                aria-expanded={!model.collapsed.has(row.path)}
                onClick={() =>
                  onCommand("search.toggleFile", { path: row.path })
                }
              >
                {model.collapsed.has(row.path) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <FileIcon path={row.path} />
                <span>{relative(row.path)}</span>
                <small>{row.count}</small>
              </button>
            ) : (
              <button
                key={row.item.path + ":" + row.item.line}
                className="project-result-line"
                style={{ top: (first + offset) * 22 }}
                title={`${row.item.path}:${row.item.line}\n${row.item.text}`}
                onClick={() =>
                  onCommand("search.openResult", { index: row.index })
                }
              >
                <small>{row.item.line}</small>
                <span>
                  {row.item.clippedStart && "…"}
                  {row.item.text.slice(0, row.item.start)}
                  <mark>
                    {row.item.text.slice(row.item.start, row.item.end)}
                  </mark>
                  {row.item.text.slice(row.item.end)}
                  {row.item.clippedEnd && "…"}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
