import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onCancelBanner?: () => void;
  busy: boolean;
  banner?: ReactNode;
  bannerLaneColor?: string;
  error?: string | null;
  placeholder: string;
}

export function Composer(p: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to the CSS max-height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [p.value]);

  useEffect(() => {
    if (p.banner) ref.current?.focus();
  }, [p.banner]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!p.busy && p.value.trim()) p.onSend();
    } else if (e.key === "Escape" && p.onCancelBanner) {
      p.onCancelBanner();
    }
  }

  return (
    <div className="composer">
      {p.banner && (
        <div className="composer-banner" style={p.bannerLaneColor ? ({ "--lane-color": p.bannerLaneColor } as React.CSSProperties) : undefined}>
          <span className="grow">{p.banner}</span>
          {p.onCancelBanner && (
            <button type="button" className="small ghost" onClick={p.onCancelBanner}>
              Cancel
            </button>
          )}
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={ref}
          rows={1}
          value={p.value}
          placeholder={p.placeholder}
          aria-label="Message"
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {p.busy ? (
          <button type="button" onClick={p.onStop}>
            Stop
          </button>
        ) : (
          <button type="button" onClick={p.onSend} disabled={!p.value.trim()}>
            Send
          </button>
        )}
      </div>
      {p.error ? (
        <div className="composer-hint error-text" role="alert">
          {p.error}
        </div>
      ) : (
        <div className="composer-hint">Enter to send · Shift+Enter for a new line</div>
      )}
    </div>
  );
}
