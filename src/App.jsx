import { useEffect, useRef, useState } from "react";
import "./veridex.css";

// Address of the FastAPI server (app.py). Override with VITE_API_URL in a .env file.
const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
// Score thresholds used by app.py (LOW / HIGH). Keep them in sync: they draw the zones on the gauge.
const LOW = 0.35;
const HIGH = 0.65;
const MAX_MB = 100; // same limit as the server

// What each label from the server means for the person looking at the screen.
const VERDICTS = {
  FAKE: { word: "Likely fake", tone: "fake", note: "The model found signs of manipulation in the face." },
  REAL: { word: "Likely real", tone: "real", note: "The model found no strong signs of manipulation." },
  UNCERTAIN: {
    word: "Can’t tell",
    tone: "unsure",
    note: "The score sits between the two thresholds, so this result is inconclusive.",
  },
};

const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp)$/i;

// Maps a 0-1 score to the zone it falls in (used to colour frame bars).
const zoneOf = (s) => (s < LOW ? "real" : s > HIGH ? "fake" : "unsure");

// Logo: four viewfinder corners around a dot.
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="square">
      <path d="M4 12V4h8M20 4h8v8M28 20v8h-8M12 28H4v-8" />
      <circle cx="16" cy="16" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Horizontal scale from 0 (real) to 1 (fake) with the three zones and a marker at the score.
function Gauge({ score }) {
  const [pos, setPos] = useState(0); // starts at 0, then slides to the score so the move is visible
  useEffect(() => {
    const id = requestAnimationFrame(() => setPos(score));
    return () => cancelAnimationFrame(id);
  }, [score]);

  return (
    <div className="gauge">
      <div className="gauge-track" role="img" aria-label={`Fake score ${score.toFixed(2)} on a scale from 0 to 1`}>
        <span className="zone zone-real" style={{ width: `${LOW * 100}%` }} />
        <span className="zone zone-unsure" style={{ width: `${(HIGH - LOW) * 100}%` }} />
        <span className="zone zone-fake" style={{ width: `${(1 - HIGH) * 100}%` }} />
        <span className="gauge-marker" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="gauge-names" aria-hidden="true">
        <span style={{ width: `${LOW * 100}%` }}>Real</span>
        <span style={{ width: `${(HIGH - LOW) * 100}%` }}>Inconclusive</span>
        <span style={{ width: `${(1 - HIGH) * 100}%` }}>Fake</span>
      </div>
      <div className="gauge-ticks" aria-hidden="true">
        <span style={{ left: "0%" }}>0</span>
        <span style={{ left: `${LOW * 100}%` }}>{LOW}</span>
        <span style={{ left: `${HIGH * 100}%` }}>{HIGH}</span>
        <span style={{ left: "100%" }}>1</span>
      </div>
    </div>
  );
}

// One bar per sampled video frame; height is the frame's fake score, colour is its zone.
function FrameBars({ scores }) {
  return (
    <div className="frames" role="img" aria-label="Fake score for each sampled frame">
      {scores.map((s, i) => (
        <span
          key={i}
          className={`frame-bar ${zoneOf(s)}`}
          style={{ height: `${Math.max(s, 0.03) * 100}%` }}
          title={`Frame ${i + 1}: ${s.toFixed(2)}`}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState(null); // the chosen File object
  const [previewUrl, setPreviewUrl] = useState(""); // local blob URL for the preview
  const [status, setStatus] = useState("idle"); // idle | loading | done
  const [result, setResult] = useState(null); // JSON returned by POST /predict
  const [error, setError] = useState(""); // message shown in the notice
  const [server, setServer] = useState(null); // null = checking, true = reachable, false = not reachable
  const [dragging, setDragging] = useState(false); // true while a file is dragged over the drop zone
  const inputRef = useRef(null); // hidden <input type="file">

  // Ask the server if it is up (GET /health).
  function checkServer() {
    setServer(null);
    fetch(`${API}/health`)
      .then((r) => setServer(r.ok))
      .catch(() => setServer(false));
  }
  useEffect(() => {
    checkServer();
  }, []);

  // Free the old blob URL whenever the preview changes or the page closes.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isVideo = file ? file.type.startsWith("video/") || VIDEO_EXT.test(file.name) : false;

  // Validate and store a chosen or dropped file.
  function pickFile(f) {
    if (!f) return;
    const ok =
      f.type.startsWith("image/") || f.type.startsWith("video/") || IMAGE_EXT.test(f.name) || VIDEO_EXT.test(f.name);
    if (!ok) {
      setError("Choose a photo (JPG, PNG) or a video (MP4, MOV, AVI).");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_MB} MB. Choose a smaller one.`);
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setResult(null);
    setError("");
    setStatus("idle");
  }

  // Send the file to the model server and store the answer.
  async function analyze() {
    setStatus("loading");
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file); // field name must match the parameter name in app.py
      const res = await fetch(`${API}/predict`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `The server returned error ${res.status}.`);
      setResult(body);
      setStatus("done");
    } catch (e) {
      const unreachable = e instanceof TypeError; // fetch throws TypeError when nothing answers
      setError(
        unreachable
          ? `Can’t reach the model server at ${API}. Start it with: uvicorn app:app --port 8000`
          : e.message
      );
      if (unreachable) setServer(false);
      setStatus("idle");
    }
  }

  const verdict = result ? VERDICTS[result.label] : null;
  const score = result ? result.fake_probability : 0;

  // Viewfinder state: drives the bracket colour and the scan line.
  const frameState = status === "done" && verdict ? verdict.tone : !file ? "empty" : "ready";
  const showScan = !file || status === "loading";

  // Cases where the result should not be trusted.
  const warnings = [];
  if (result?.type === "image" && !result.face_detected) {
    warnings.push("No face was found, so the center of the image was analyzed instead. Treat this result as unreliable.");
  }
  if (result?.type === "video" && result.frames_with_face < result.frames_scored / 2) {
    warnings.push(
      `A face was found in only ${result.frames_with_face} of ${result.frames_scored} sampled frames. Treat this result as unreliable.`
    );
  }

  return (
    <div className="app">
      <header className="top">
        <p className="wordmark">
          <Mark /> Veridex
        </p>
        <p className="server" role="status">
          <span className={`dot ${server === true ? "ok" : server === false ? "bad" : ""}`} />
          {server === true && "Model server connected"}
          {server === null && "Checking model server…"}
          {server === false && (
            <>
              Model server not reachable.{" "}
              <button className="link-btn" onClick={checkServer}>
                Check again
              </button>
            </>
          )}
        </p>
      </header>

      <h1 className="hero">Is this face real?</h1>
      <p className="intro">
        Drop a photo or video. Veridex scores how likely the face has been generated or manipulated, and tells you when it
        can’t tell.
      </p>

      <main className="grid">
        <section className="input-side" aria-label="File to check">
          {/* Hidden real input; the drop zone label and the buttons trigger it. Must sit right before .viewfinder for focus styling. */}
          <input
            id="file-input"
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/*,video/*"
            onChange={(e) => {
              const f = e.target.files[0];
              e.target.value = ""; // lets the same file be chosen again later
              pickFile(f);
            }}
          />

          {/* The viewfinder: four corner brackets, a scan line, and either the drop zone or the preview inside. */}
          <div className={`viewfinder ${frameState} ${dragging ? "over" : ""}`}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            {showScan && <span className={`scan ${status === "loading" ? "active" : "idle"}`} />}

            {!file ? (
              <label
                htmlFor="file-input"
                className="drop"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files[0]);
                }}
              >
                <span className="drop-title">Drop a photo or video here</span>
                <span className="drop-sub">or click to choose a file</span>
                <span className="drop-formats">JPG, PNG, MP4, MOV or AVI, up to {MAX_MB} MB.</span>
              </label>
            ) : (
              <div className="preview">
                {isVideo ? (
                  <video src={previewUrl} controls muted playsInline />
                ) : (
                  <img src={previewUrl} alt="Preview of the selected file" />
                )}
              </div>
            )}
          </div>

          {file && (
            <>
              <p className="filename">
                {file.name} ({(file.size / 1048576).toFixed(1)} MB)
              </p>
              <div className="actions">
                <button className="btn primary" onClick={analyze} disabled={status === "loading"}>
                  {status === "loading" ? "Analyzing…" : "Analyze file"}
                </button>
                <button className="btn" onClick={() => inputRef.current.click()} disabled={status === "loading"}>
                  Choose another file
                </button>
              </div>
            </>
          )}

          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="result-side" aria-live="polite" aria-label="Result">
          {status === "idle" && !result && (
            <div>
              <p className="idle-hint">Your result appears here as a fake score from 0 to 1.</p>
              <ul className="legend">
                <li>
                  <span className="sw real" /> Below {LOW}: likely real
                </li>
                <li>
                  <span className="sw unsure" /> {LOW} to {HIGH}: can’t tell
                </li>
                <li>
                  <span className="sw fake" /> Above {HIGH}: likely fake
                </li>
              </ul>
            </div>
          )}

          {status === "loading" && (
            <div>
              <p className="idle-hint">Analyzing {isVideo ? "16 frames from the video" : "the image"}…</p>
              <div className="bar" />
            </div>
          )}

          {status === "done" && result && verdict && (
            <div>
              <div className={`verdict ${verdict.tone}`}>
                <h2 className="verdict-word">{verdict.word}</h2>
                <p className="verdict-note">{verdict.note}</p>
              </div>

              <p className="score">
                Fake score <strong>{score.toFixed(2)}</strong> out of 1
              </p>
              <Gauge score={score} />

              {result.type === "video" && (
                <>
                  <h3 className="sub-head">Score by frame</h3>
                  <FrameBars scores={result.per_frame} />
                  <p className="caption">
                    {result.frames_scored} frames sampled evenly across the video. The verdict uses their average.
                  </p>
                </>
              )}

              {warnings.map((w) => (
                <p key={w} className="notice warn">
                  {w}
                </p>
              ))}

              <p className="disclaimer">
                This is a screening result, not proof. Have a person review anything that matters.
              </p>
            </div>
          )}
        </section>
      </main>

      <details className="about">
        <summary>How accurate is this?</summary>
        <ul>
          <li>The model is EfficientNet-B0, fine-tuned on face crops resized to 224 × 224 pixels.</li>
          <li>On held-out photos it scores AUC 0.998.</li>
          <li>
            On frames from videos it never saw, it scores AUC 0.84: it catches about 7 in 10 fakes and wrongly flags
            about 2 in 10 real faces.
          </li>
          <li>The fake score is a model output, not a calibrated probability.</li>
          <li>It checks one face at a time (the largest) and works best on front-facing faces.</li>
          <li>Fakes made by generators it was not trained on can get through.</li>
        </ul>
      </details>
    </div>
  );
}