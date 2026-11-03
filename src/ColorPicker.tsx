import { useEffect, useState, type PointerEvent } from "react";

type HSB = { h: number; s: number; b: number };
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
export const validHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

export function hexToHSB(
  hex: string,
  previous: HSB = { h: 0, s: 0, b: 0 },
): HSB {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const hue =
    delta === 0
      ? previous.h
      : 60 *
        (max === r
          ? ((g - b) / delta + 6) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4);
  // Keep hue for grays, and saturation at black, so dragging back restores color.
  return {
    h: hue,
    s: max === 0 ? previous.s : (delta / max) * 100,
    b: max * 100,
  };
}

export function hsbToHex({ h, s, b }: HSB) {
  const saturation = s / 100,
    brightness = b / 100;
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(
      255 * brightness * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1))),
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

function Channel({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const rounded = Math.round(value);
  const [text, setText] = useState(String(rounded));
  useEffect(() => setText(String(rounded)), [rounded]);
  return (
    <label>
      <span>{label === "Hue" ? "H" : label === "Saturation" ? "S" : "B"}</span>
      <input
        type="number"
        aria-label={label}
        min={0}
        max={max}
        step={1}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const n = Number(event.target.value);
          if (
            event.target.value !== "" &&
            Number.isFinite(n) &&
            n >= 0 &&
            n <= max
          )
            onChange(n);
        }}
        onBlur={() => {
          const n = Number(text);
          if (text !== "" && Number.isFinite(n)) onChange(clamp(n, max));
          setText(
            String(
              text !== "" && Number.isFinite(n)
                ? Math.round(clamp(n, max))
                : rounded,
            ),
          );
        }}
      />
      <span className="color-unit">{max === 360 ? "°" : "%"}</span>
    </label>
  );
}

export function ColorPicker({
  initial,
  palette,
  onChange,
}: {
  initial: string;
  palette: string[];
  onChange: (hex: string) => void;
}) {
  const [hsb, setHSB] = useState(() => hexToHSB(initial));
  const [hex, setHex] = useState(initial);
  const updateHSB = (next: HSB) => {
    setHSB(next);
    const value = hsbToHex(next);
    setHex(value);
    onChange(value);
  };
  const updateHex = (value: string) => {
    setHex(value);
    if (validHex(value)) setHSB(hexToHSB(value, hsb));
    onChange(value);
  };
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    updateHSB({
      ...hsb,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100, 100),
      b: 100 - clamp(((event.clientY - rect.top) / rect.height) * 100, 100),
    });
  };
  return (
    <>
      <div
        className="color-plane"
        tabIndex={0}
        role="group"
        aria-label="Saturation and brightness"
        aria-describedby="color-plane-help"
        style={{ backgroundColor: hsbToHex({ h: hsb.h, s: 100, b: 100 }) }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            pick(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          updateHSB({
            ...hsb,
            s: clamp(
              hsb.s +
                (event.key === "ArrowRight"
                  ? step
                  : event.key === "ArrowLeft"
                    ? -step
                    : 0),
              100,
            ),
            b: clamp(
              hsb.b +
                (event.key === "ArrowUp"
                  ? step
                  : event.key === "ArrowDown"
                    ? -step
                    : 0),
              100,
            ),
          });
        }}
      >
        <span
          className="color-plane-cursor"
          style={{ left: `${hsb.s}%`, top: `${100 - hsb.b}%` }}
        />
      </div>
      <span id="color-plane-help" className="color-sr-only">
        Left and right adjust saturation; up and down adjust brightness. Hold
        Shift for steps of ten.
      </span>
      <input
        className="color-hue"
        type="range"
        aria-label="Hue slider"
        min={0}
        max={360}
        step={1}
        value={hsb.h}
        onChange={(event) =>
          updateHSB({ ...hsb, h: Number(event.target.value) })
        }
      />
      <div className="color-channels">
        <Channel
          label="Hue"
          value={hsb.h}
          max={360}
          onChange={(h) => updateHSB({ ...hsb, h })}
        />
        <Channel
          label="Saturation"
          value={hsb.s}
          max={100}
          onChange={(s) => updateHSB({ ...hsb, s })}
        />
        <Channel
          label="Brightness"
          value={hsb.b}
          max={100}
          onChange={(b) => updateHSB({ ...hsb, b })}
        />
      </div>
      <label className="color-hex">
        <span>HEX</span>
        <input
          autoFocus
          aria-label="Project color hex"
          value={hex}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!validHex(hex)}
          onChange={(event) =>
            updateHex(
              event.target.value.startsWith("#")
                ? event.target.value
                : "#" + event.target.value,
            )
          }
        />
      </label>
      <div className="color-swatches" role="group" aria-label="Default palette">
        {palette.map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`Choose ${value}`}
            aria-pressed={hex.toLowerCase() === value}
            style={{ backgroundColor: value }}
            onClick={() => updateHex(value)}
          />
        ))}
      </div>
    </>
  );
}
