import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Download, Check, Loader2, Maximize2 } from "lucide-react";
import { PromptInputBox } from "./components/PromptInputBox";
import { streamGeneration, type DoneEvent, type Stage } from "./lib/api";
import { downloadImage } from "./lib/download";
import { aspectRatioCss, aspectRatioValue, type GenerateOptions } from "./lib/generate-options";

const VIDEO_URL = "/bg.mp4";
const POSTER_URL = "/bg-start.jpg";

const LOADER_PHRASES = [
  "Warming up the pixels…",
  "Mixing the colors…",
  "Chasing the light…",
  "Developing the film…",
  "Focusing the lens…",
  "Setting the scene…",
  "Painting the backdrop…",
  "Gathering inspiration…",
];

type Status = "idle" | "generating";

const STAGE_LABELS: Record<Stage, string> = {
  enhancing: "Enhancing your prompt…",
  generating: "Painting the image…",
};

const ease = [0.22, 1, 0.36, 1] as const;

const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

// Loading screen: blurred first frame of the video + random text while it buffers fully.
function Loader({ progress }: { progress: number }) {
  const [phraseIndex, setPhraseIndex] = useState(() =>
    Math.floor(Math.random() * LOADER_PHRASES.length)
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setPhraseIndex((prev) => {
        let next = prev;
        while (next === prev) next = Math.floor(Math.random() * LOADER_PHRASES.length);
        return next;
      });
    }, 1600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.9, ease }}
      className="fixed inset-0 z-50 overflow-hidden bg-[#060607]"
    >
      <img
        src={POSTER_URL}
        alt=""
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-6">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease }}
          className="text-[11px] font-semibold uppercase tracking-[0.45em] text-white/70"
        >
          Lumina
        </motion.p>

        <div className="mt-5 flex h-5 items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={phraseIndex}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease }}
              className="text-sm text-white/50"
            >
              {LOADER_PHRASES[phraseIndex]}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="mt-8 h-[2px] w-44 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-white/80 transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="mt-3 font-mono text-[11px] tabular-nums text-white/35">
          {Math.round(progress * 100)}%
        </p>
      </div>
    </motion.div>
  );
}

// Save-to-disk for a finished image. Its own component so the button can own the fetch's
// pending/failed state without re-rendering the page around it. Rendered as an icon-only
// overlay on top of the image, so the metadata row below stays text-only.
function DownloadButton({
  result,
  className,
}: {
  result: DoneEvent;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  // A new image means a fresh button, so the tick from the previous one doesn't linger.
  useEffect(() => setState("idle"), [result.imageUrl]);

  const save = async () => {
    if (state === "saving") return;
    setState("saving");
    try {
      await downloadImage(result.imageUrl, `lumina-${result.seed}`);
      setState("saved");
    } catch {
      setState("failed");
    }
  };

  const label =
    state === "saving"
      ? "Saving image…"
      : state === "saved"
        ? "Image saved"
        : state === "failed"
          ? "Download failed — retry"
          : "Download image";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void save();
      }}
      disabled={state === "saving"}
      aria-label={label}
      title={label}
      className={cn(overlayButtonClass, state === "failed" && "text-red-200", className)}
    >
      {state === "saving" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === "saved" ? (
        <Check className="h-4 w-4 text-emerald-300" />
      ) : (
        <Download className="h-4 w-4" />
      )}
    </button>
  );
}

// Shared look for the icon buttons that sit on top of the image (and inside the lightbox).
const overlayButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white/85 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white disabled:opacity-60";

// Full-screen view of a finished image. Closes on Escape, on a backdrop click, or via the X.
function Lightbox({ result, onClose }: { result: DoneEvent; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    // Keep the page behind from scrolling while the overlay owns the viewport.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease }}
      role="dialog"
      aria-modal="true"
      aria-label="Full screen image"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm sm:p-8"
    >
      <motion.img
        key={result.imageUrl}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.3, ease }}
        src={result.imageUrl}
        alt={result.prompt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
      />

      <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
        <DownloadButton result={result} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full screen"
          title="Close full screen"
          className={overlayButtonClass}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </motion.div>
  );
}


export default function App() {  const [status, setStatus] = useState<Status>("idle");
  const [stage, setStage] = useState<Stage>("enhancing");
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
  const [result, setResult] = useState<DoneEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const markReady = useCallback(() => setVideoReady(true), []);

  // Track buffering; the site only reveals once the whole video is downloaded.
  const handleBufferProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration || !v.buffered.length) return;
    const pct = Math.min(1, v.buffered.end(v.buffered.length - 1) / v.duration);
    setProgress(pct);
    if (pct >= 0.995) markReady();
  }, [markReady]);

  // Safety nets: never trap the user on the loading screen.
  useEffect(() => {
    const t = window.setTimeout(markReady, 20000);
    return () => window.clearTimeout(t);
  }, [markReady]);

  const handleSend = useCallback(
    (message: string, _files: File[], options: GenerateOptions) => {
      const prompt = message.trim();
      if (!prompt) return;

      controller.current?.abort(); // a second submit supersedes the in-flight one
      const ac = new AbortController();
      controller.current = ac;

      setResult(null);
      setEnhancedPrompt(null);
      setError(null);
      setLightboxOpen(false); // a new run replaces whatever the overlay was showing
      setStage("enhancing");
      setStatus("generating");

      void streamGeneration(
        { prompt, ...options },
        {
          onStage: setStage,
          onEnhanced: (event) => setEnhancedPrompt(event.enhanced ? event.prompt : null),
          onWarning: setError,
          onDone: (event) => {
            setResult(event);
            setStatus("idle");
          },
          onError: (message) => {
            setError(message);
            setStatus("idle");
          },
        },
        ac.signal
      ).finally(() => {
        if (controller.current === ac) {
          controller.current = null;
          setStatus("idle");
        }
      });
    },
    []
  );

  const handleStop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setStatus("idle");
  }, []);

  // Cancel any in-flight generation if the page unmounts.
  useEffect(() => () => controller.current?.abort(), []);

  // Once there is something to show, the hero gives up room to it. Same type, same spacing
  // rhythm — just scaled down so a desktop viewport holds the whole thing without scrolling.
  const compact = status === "generating" || result !== null;

  return (
    <div className="relative min-h-screen w-full overflow-x-clip">
      {/* Video background — fully buffered behind the loading screen */}
      <div className="fixed inset-0 -z-10 bg-[#060607]">
        <video
          ref={videoRef}
          className="video-drift h-full w-full object-cover"
          src={VIDEO_URL}
          poster={POSTER_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onProgress={handleBufferProgress}
          onCanPlayThrough={handleBufferProgress}
          onError={markReady}
        />
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <AnimatePresence>{!videoReady && <Loader progress={progress} />}</AnimatePresence>

      {videoReady && (
        <main
          className={cn(
            "relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-4 transition-[padding] duration-700 ease-out sm:px-6",
            // Idle keeps the original hero placement. Once there is work to show, desktop
            // switches to a fixed-height, vertically centred column so nothing spills below
            // the fold; mobile keeps scrolling, where a full-width image is the point.
            compact
              ? "min-h-screen pb-10 pt-[8vh] md:h-screen md:min-h-0 md:justify-center md:pb-6 md:pt-6"
              : "min-h-screen pt-[13vh]"
          )}
        >
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease, delay: 0.1 }}
            className="text-[11px] font-semibold uppercase tracking-[0.45em] text-white/50"
          >
            Lumina
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease, delay: 0.2 }}
            className={cn(
              "mt-4 text-center font-black leading-[0.95] tracking-[-0.045em] text-white transition-all duration-700 ease-out",
              compact
                ? "text-[clamp(2rem,5vw,3.25rem)] md:mt-2"
                : "text-[clamp(3rem,9vw,6.5rem)]"
            )}
          >
            Type it.
            {/* One line once the page is working, so the headline costs a band instead of a screen. */}
            {compact ? " See it." : <><br />See it.</>}
          </motion.h1>

          {/* Center chat box */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease, delay: 0.35 }}
            className={cn(
              "w-full max-w-2xl transition-all duration-700 ease-out",
              compact ? "mt-5" : "mt-10"
            )}
          >
            <PromptInputBox
              onSend={handleSend}
              onStop={handleStop}
              isLoading={status === "generating"}
              statusLabel={status === "generating" ? STAGE_LABELS[stage] : null}
              placeholder="Describe the image you want to create…"
            />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="mt-4 text-xs text-white/35"
          >
            Press Enter to generate · Shift+Enter for a new line
          </motion.p>

          {/* Result. The stage text now lives inside the prompt box, so this band only ever
              holds the finished image — and it is sized off the viewport height (see
              --result-max-h in index.css) so desktop never has to scroll to see it. */}
          <div className="mt-6 flex w-full max-w-2xl min-h-0 flex-col items-center pb-4">
            <AnimatePresence mode="wait">
              {status === "idle" && result && (
                <motion.div
                  key={result.imageUrl}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease }}
                  className="flex w-full min-h-0 flex-col items-center"
                >
                  <div
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
                    style={{
                      aspectRatio: aspectRatioCss(result.aspectRatio),
                      // Height-first: whichever of the two budgets is smaller wins, so a tall
                      // portrait shrinks to fit rather than pushing the page into a scroll.
                      width: `min(100%, calc(var(--result-max-h) * ${aspectRatioValue(result.aspectRatio)}))`,
                      maxHeight: "var(--result-max-h)",
                    }}
                  >
                    <img
                      src={result.imageUrl}
                      alt={result.prompt}
                      className="h-full w-full cursor-zoom-in object-cover"
                      loading="eager"
                      onClick={() => setLightboxOpen(true)}
                    />

                    {/* Actions live over the image: always visible on touch, and on desktop
                        they fade in on hover so they stay out of the picture's way. */}
                    <div className="absolute right-3 top-3 flex items-center gap-2 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => setLightboxOpen(true)}
                        aria-label="View full screen"
                        title="View full screen"
                        className={overlayButtonClass}
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                      <DownloadButton result={result} />
                    </div>
                  </div>

                  <p className="mt-3 flex w-full items-start gap-2.5 text-sm leading-relaxed text-white/60">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
                    <span className="line-clamp-3 md:line-clamp-2">
                      {enhancedPrompt ?? result.prompt}
                    </span>
                  </p>
                  <p className="mt-2.5 w-full font-mono text-[11px] text-white/30">
                    {result.mode} · {result.width}×{result.height} · seed {result.seed} ·{" "}
                    {result.textModel} → {result.imageModel}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  key={error}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease }}
                  className="mt-4 flex w-full items-start gap-3 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100"
                >
                  <span className="flex-1">{error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="Dismiss"
                    className="mt-0.5 text-red-100/60 transition-colors hover:text-red-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      )}

      <AnimatePresence>
        {lightboxOpen && result && (
          <Lightbox result={result} onClose={() => setLightboxOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
