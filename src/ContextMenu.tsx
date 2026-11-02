import { useEffect, useLayoutEffect, useRef, useState } from "react";
export type MenuItem = {
  label: string;
  id: string;
  args?: Record<string, unknown>;
  disabled?: boolean;
  danger?: boolean;
} | null;
export default function ContextMenu({
  x,
  y,
  items,
  onCommand,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onCommand(id: string, args?: Record<string, unknown>): void;
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const bounds = menu.current!.getBoundingClientRect();
    setPosition({
      x: Math.max(4, Math.min(x, innerWidth - bounds.width - 4)),
      y: Math.max(4, Math.min(y, innerHeight - bounds.height - 4)),
    });
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [x, y]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return (
    <div
      className="context-menu"
      role="menu"
      aria-label="File actions"
      ref={menu}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const buttons = Array.from(
            menu.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
      }}
    >
      {items.map((item, index) =>
        item ? (
          <button
            key={item.id + index}
            role="menuitem"
            disabled={item.disabled}
            className={item.danger ? "danger" : ""}
            onClick={() => {
              onClose();
              onCommand(item.id, item.args);
            }}
          >
            {item.label}
          </button>
        ) : (
          <div key={index} role="separator" className="context-separator" />
        ),
      )}
    </div>
  );
}
