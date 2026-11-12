import { X, Minus } from "lucide-react";
import type { Upload } from "./types";
export const uploading = (item: Upload) =>
  ["queued", "uploading", "stopping", "finishing"].includes(item.status);
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
export function uploadLabel(item: Upload) {
  if (item.status === "uploading")
    return `${Math.floor((item.transferred / (item.size || 1)) * 100)}% · ${bytes(item.transferred)} / ${bytes(item.size)}`;
  return {
    queued: "Queued",
    stopping: "Stopping…",
    finishing: "Finishing…",
    completed: "Completed",
    cancelled: "Stopped",
    failed: "Failed",
  }[item.status];
}
export default function Uploads({
  items,
  onCommand,
}: {
  items: Upload[];
  onCommand(id: string, args?: Record<string, unknown>): void;
}) {
  return (
    <section className="uploads-popup" aria-label="File transfers">
      <header>
        <span>
          {items.some((item) => item.remote) ? "Uploads" : "File copies"}
        </span>
        <button
          title="Hide transfers"
          aria-label="Hide transfers"
          onClick={() => onCommand("uploads.hide")}
        >
          <Minus size={14} />
        </button>
      </header>
      <div className="uploads-list">
        {!items.length && (
          <div className="upload-item upload-status">
            No uploads in this window.
          </div>
        )}
        {items.map((item) => (
          <div
            className="upload-item"
            key={item.id}
            data-upload-id={item.id}
            data-status={item.status}
          >
            <div className="upload-details">
              <span className="upload-name" title={item.path}>
                {item.name}
              </span>
              <span className="upload-status">{uploadLabel(item)}</span>
              {uploading(item) && (
                <progress
                  aria-label={`Progress for ${item.name}`}
                  max={Math.max(1, item.size)}
                  value={item.transferred}
                />
              )}
              {item.error && <span className="upload-error">{item.error}</span>}
            </div>
            {uploading(item) && (
              <button
                aria-label={`Stop upload ${item.name}`}
                title="Stop upload"
                disabled={
                  item.status === "stopping" || item.status === "finishing"
                }
                onClick={() => onCommand("uploads.stop", { id: item.id })}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
