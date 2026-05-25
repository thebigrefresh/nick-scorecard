// Vercel Serverless Function — creates a new Monthly Pulse entry in Notion.
// Companion to scores.js (reads latest) and history.js (reads all).
// Reads the SAME environment variables the read functions already use, so it
// writes to whatever database this deployment is wired to:
//   NOTION_SECRET             - the Notion integration token
//   NOTION_PULSE_DATABASE_ID  - the Monthly Pulse database to write into
// A third variable, PULSE_WRITE_TOKEN, is a simple shared password so that
// only your own GPT can call this endpoint, not a random passer-by.

const NOTION_SECRET = process.env.NOTION_SECRET;
const DATABASE_ID   = process.env.NOTION_PULSE_DATABASE_ID;
const WRITE_TOKEN   = process.env.PULSE_WRITE_TOKEN;

// The 21 score properties, named exactly as the Notion columns.
const SCORE_FIELDS = [
  "Best Self", "Fear Patterns", "North Star", "Internal Success Metrics",
  "Presence", "Energy", "Early Signals", "Inner-Shared Alignment",
  "Trust", "Delegation", "Courageous Conversations", "Team Development",
  "Shared Purpose", "Shared-Owned Alignment", "Time Clarity", "Stakeholders",
  "Leadership Rhythm", "Personal Practices", "Blueprint & Rules",
  "System Integration", "System Health",
];

// Long-text fields: the key sent in, mapped to the Notion property name.
const TEXT_FIELDS = {
  aiSummary:       "AI Summary",
  focusArea:       "Focus Area",
  suddenShifts:    "Sudden Shifts",
  reflectiveNotes: "Reflective Notes",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST to create a Pulse entry." });
  }

  // Make sure the environment is configured.
  if (!NOTION_SECRET || !DATABASE_ID) {
    return res.status(500).json({
      error: "Missing environment variables. Set NOTION_SECRET and NOTION_PULSE_DATABASE_ID in your Vercel project settings.",
    });
  }
  if (!WRITE_TOKEN) {
    return res.status(500).json({
      error: "Missing PULSE_WRITE_TOKEN environment variable in your Vercel project settings.",
    });
  }

  // Check the shared password.
  const authHeader = req.headers["authorization"] || "";
  const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (provided !== WRITE_TOKEN) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  // Parse the body (Vercel usually parses JSON automatically).
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Body is not valid JSON." });
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Missing JSON body." });
  }

  // Scores can arrive as a nested "scores" object or as top-level fields.
  const scoreObj =
    body.scores && typeof body.scores === "object" ? body.scores : body;

  const properties = {};

  // Entry (title)
  if (body.entry) {
    properties["Entry"] = { title: [{ text: { content: String(body.entry) } }] };
  }

  // Month (date, expects YYYY-MM-DD)
  if (body.month) {
    properties["Month"] = { date: { start: String(body.month) } };
  }

  // The 21 numeric scores
  for (const name of SCORE_FIELDS) {
    const val = scoreObj[name];
    if (val !== undefined && val !== null && val !== "") {
      const num = Number(val);
      if (!Number.isNaN(num)) {
        properties[name] = { number: num };
      }
    }
  }

  // The long-text fields
  for (const [key, propName] of Object.entries(TEXT_FIELDS)) {
    if (body[key]) {
      properties[propName] = {
        rich_text: [{ text: { content: String(body[key]) } }],
      };
    }
  }

  try {
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_SECRET}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: DATABASE_ID },
        properties,
      }),
    });

    const raw = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Notion API error ${response.status}`,
        detail: raw,
      });
    }

    const data = JSON.parse(raw);
    return res.status(200).json({ created: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
