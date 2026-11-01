import { useEffect, useRef } from "react";
import { Maximize, Minus, Plus, X } from "lucide-react";
export type DiagramView = {
  svg: string;
  title: string;
  width: number;
  height: number;
  scale: number;
  x: number;
  y: number;
};
export default function DiagramViewer({
  diagram,
  onCommand,
}: {
  diagram: DiagramView;
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(
    undefined,
  );
  const commands = useRef(onCommand);
  commands.current = onCommand;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const observer = new ResizeObserver(() => commands.current("diagram.fit"));
    observer.observe(canvas.current!);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.current!.getBoundingClientRect();
      commands.current("diagram.zoom", {
        factor: Math.exp(-event.deltaY * 0.0015),
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    const element = canvas.current!;
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="diagram-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded Mermaid diagram"
      ref={dialog}
      onKeyDown={(event) => {
        let command: string | undefined;
        if (event.key === "Escape") command = "diagram.close";
        else if (["+", "="].includes(event.key)) command = "diagram.zoomIn";
        else if (event.key === "-") command = "diagram.zoomOut";
        else if (event.key === "0") command = "diagram.fit";
        else if (event.key === "1") command = "diagram.actualSize";
        if (command) {
          event.preventDefault();
          event.stopPropagation();
          onCommand(command);
        }
        if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          onCommand("diagram.pan", {
            dx:
              event.key === "ArrowLeft"
                ? 60
                : event.key === "ArrowRight"
                  ? -60
                  : 0,
            dy:
              event.key === "ArrowUp"
                ? 60
                : event.key === "ArrowDown"
                  ? -60
                  : 0,
          });
        }
        if (event.key === "Tab") {
          const controls = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              "button, [tabindex='0']",
            ),
          ];
          const at = controls.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          controls[
            (at + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
          ]?.focus();
        }
      }}
    >
      <div className="diagram-viewer-toolbar">
        <strong>{diagram.title}</strong>
        <span className="diagram-help">Drag to pan · Scroll to zoom</span>
        <button
          aria-label="Zoom diagram out"
          title="Zoom out (-)"
          onClick={() => onCommand("diagram.zoomOut")}
        >
          <Minus size={16} />
        </button>
        <button
          title="Actual size (1)"
          aria-label="Diagram actual size"
          onClick={() => onCommand("diagram.actualSize")}
        >
          {Math.round(diagram.scale * 100)}%
        </button>
        <button
          aria-label="Zoom diagram in"
          title="Zoom in (+)"
          onClick={() => onCommand("diagram.zoomIn")}
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="Fit diagram"
          title="Fit diagram (0)"
          onClick={() => onCommand("diagram.fit")}
        >
          <Maximize size={16} /> Fit
        </button>
        <button
          aria-label="Close diagram"
          title="Close (Esc)"
          onClick={() => onCommand("diagram.close")}
        >
          <X size={18} />
        </button>
      </div>
      <div
        className="diagram-canvas"
        ref={canvas}
        tabIndex={0}
        aria-label="Diagram canvas; drag to pan, scroll to zoom"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          onCommand("diagram.pan", {
            dx: event.clientX - start.x,
            dy: event.clientY - start.y,
          });
          drag.current = { ...start, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          drag.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
        onDoubleClick={() => onCommand("diagram.fit")}
      >
        <div
          className="diagram-transform"
          style={{
            width: diagram.width,
            height: diagram.height,
            transform: `translate(${diagram.x}px, ${diagram.y}px) scale(${diagram.scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: diagram.svg }}
        />
      </div>
    </div>
  );
}
