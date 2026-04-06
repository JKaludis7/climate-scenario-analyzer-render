import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Serve the built React frontend
app.use(express.static(join(__dirname, "dist")));

// Health check
app.get("/api/health", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({ status: "FAIL", error: "No ANTHROPIC_API_KEY set" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 50, messages: [{ role: "user", content: "Say ok" }] }),
    });
    if (r.status === 200) return res.json({ status: "PASS", message: "API working!" });
    return res.json({ status: "FAIL", error: "API returned " + r.status });
  } catch (e) { return res.json({ status: "FAIL", error: e.message }); }
});

// Main climate analysis endpoint
app.post("/api/climate", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured." });

  try {
    const { system, userMessage } = req.body;
    if (!system || !userMessage) return res.status(400).json({ error: "Missing required fields" });

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
"anthropic-beta": "web-search-2025-03-05",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        }),
      });

      if (response.status === 429) {
        if (attempt < maxRetries) {
          const wait = Math.min((parseInt(response.headers.get("retry-after") || "2")) * 1000 * Math.pow(2, attempt), 20000);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return res.status(429).json({ error: "Rate limited. Please wait 60 seconds and try again." });
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
        return res.status(response.status).json({ error: errText.substring(0, 300) });
      }

      const data = await response.json();
      let text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

      // Strip ALL XML/HTML tags aggressively
      text = text.replace(/<[^>]+>/g, "");
      text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "");
      text = text.replace(/  +/g, " ");

      return res.json({ text });
    }
    return res.status(500).json({ error: "Failed after retries" });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// Catch-all: serve React app for any non-API route
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log("Climate Scenario Analyzer running on port " + PORT);
});
