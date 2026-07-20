const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const YTDLP = "yt-dlp";

// ---------- helpers ----------

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `yt-dlp exited with code ${code}`));
    });
  });
}

function secondsToTimestamp(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

const TEMP_DIR = path.join(__dirname, "temp_downloads");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function tempFilePath(ext) {
  return path.join(TEMP_DIR, `dl_${crypto.randomBytes(8).toString("hex")}.${ext}`);
}

function cleanup(filePath) {
  fs.unlink(filePath, () => {});
}

// ---------- routes ----------

// 1) Get video info (title, thumbnail, duration)
app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const output = await runYtDlp(["-j", "--no-playlist", url]);
    const data = JSON.parse(output);
    res.json({
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration || 0,
      uploader: data.uploader,
      extractor: data.extractor,
    });
  } catch (e) {
    console.error("=== INFO FETCH ERROR ===");
    console.error(e.message);
    console.error("=========================");
    res.status(500).json({ error: "Could not fetch video info. Please check the link.", details: e.message });
  }
});

// 2) Download full video (best quality mp4)
app.post("/api/download", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const outPath = tempFilePath("mp4");

  try {
    await runYtDlp([
      "-f", "bv*+ba/b",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "-o", outPath,
      url,
    ]);

    res.download(outPath, "video.mp4", (err) => {
      cleanup(outPath);
      if (err) console.error("Download send error:", err.message);
    });
  } catch (e) {
    cleanup(outPath);
    console.error("=== FULL DOWNLOAD ERROR ===");
    console.error(e.message);
    console.error("============================");
    res.status(500).json({ error: "Download failed.", details: e.message });
  }
});

function getDirectStreamUrls(url) {
  // Returns array of direct media URLs (video, audio separately if applicable)
  return runYtDlp(["-f", "bv*+ba/b", "-g", "--no-playlist", url]).then((out) =>
    out.trim().split("\n").filter(Boolean)
  );
}

function ffmpegTrimFromUrls(urls, outputPath, startSeconds, endSeconds) {
  return new Promise((resolve, reject) => {
    const duration = endSeconds - startSeconds;
    const args = ["-y"];
    // Put -ss before each -i so ffmpeg seeks at the source (no full download)
    for (const u of urls) {
      args.push("-ss", String(startSeconds), "-i", u);
    }
    args.push("-t", String(duration));
    if (urls.length > 1) {
      args.push("-map", "0:v:0", "-map", "1:a:0");
    }
    args.push("-c:v", "libx264", "-c:a", "aac", "-avoid_negative_ts", "make_zero", outputPath);

    const proc = spawn("ffmpeg", args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `ffmpeg exited with code ${code}`));
    });
  });
}

function ffmpegTrim(inputPath, outputPath, startSeconds, endSeconds) {
  return new Promise((resolve, reject) => {
    const duration = endSeconds - startSeconds;
    const proc = spawn("ffmpeg", [
      "-y",
      "-ss", String(startSeconds),
      "-i", inputPath,
      "-t", String(duration),
      "-c:v", "libx264",
      "-c:a", "aac",
      "-avoid_negative_ts", "make_zero",
      outputPath,
    ]);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `ffmpeg exited with code ${code}`));
    });
  });
}

// 3) Download a clipped portion (start/end in seconds)
// Strategy:
//   - Most platforms (YouTube, Facebook, TikTok, Instagram): try yt-dlp
//     --download-sections first (fast, only fetches needed bytes).
//   - Twitch (and as a general fallback): HLS/m3u8 sections are unreliable,
//     so download the full video then trim precisely with ffmpeg.
app.post("/api/clip", async (req, res) => {
  const { url, startSeconds, endSeconds } = req.body;
  if (!url || startSeconds === undefined || endSeconds === undefined) {
    return res.status(400).json({ error: "URL, start time, and end time are required" });
  }
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (end <= start) {
    return res.status(400).json({ error: "End time must be after start time" });
  }

  const isTwitch = /twitch\.tv/i.test(url);
  const startTs = secondsToTimestamp(start);
  const endTs = secondsToTimestamp(end);
  const outPath = tempFilePath("mp4");
  const fileName = `clip_${startTs.replace(/:/g, "-")}_to_${endTs.replace(/:/g, "-")}.mp4`;

  // --- Path A: direct section download (skip for Twitch) ---
  if (!isTwitch) {
    try {
      await runYtDlp([
        "-f", "bv*+ba/b",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--download-sections", `*${startTs}-${endTs}`,
        "--force-keyframes-at-cuts",
        "-o", outPath,
        url,
      ]);
      return res.download(outPath, fileName, (err) => {
        cleanup(outPath);
        if (err) console.error("Clip send error:", err.message);
      });
    } catch (e) {
      console.warn("Section download failed, trying full-download+trim:", e.message);
      cleanup(outPath);
    }
  }

  // --- Path B: direct-stream seek (no full download to disk) ---
  try {
    const urls = await getDirectStreamUrls(url);
    if (urls.length === 0) throw new Error("Direct stream URL not found");
    await ffmpegTrimFromUrls(urls, outPath, start, end);
    return res.download(outPath, fileName, (err) => {
      cleanup(outPath);
      if (err) console.error("Clip send error:", err.message);
    });
  } catch (e) {
    console.warn("Direct-stream trim failed, trying full-download+trim:", e.message);
    cleanup(outPath);
  }

  // --- Path C: full download then ffmpeg trim (last resort, uses more disk) ---
  const fullPath = tempFilePath("mp4");
  const trimmedPath = tempFilePath("mp4");
  try {
    const ytArgs = [
      "-f", "bv*+ba/b",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "-o", fullPath,
      url,
    ];
    // Twitch VODs sometimes need ads skipped for a clean stream
    if (isTwitch) ytArgs.splice(0, 0, "--extractor-args", "twitch:disable-ads");

    await runYtDlp(ytArgs);
    await ffmpegTrim(fullPath, trimmedPath, start, end);

    res.download(trimmedPath, fileName, (err) => {
      cleanup(fullPath);
      cleanup(trimmedPath);
      if (err) console.error("Clip send error:", err.message);
    });
  } catch (e) {
    cleanup(fullPath);
    cleanup(trimmedPath);
    console.error("=== CLIP DOWNLOAD ERROR ===");
    console.error(e.message);
    console.error("===========================");
    res.status(500).json({
      error: isTwitch
        ? "Twitch clip download failed. This won't work if the VOD is subscriber-only or has expired."
        : "Clip download failed.",
      details: e.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
