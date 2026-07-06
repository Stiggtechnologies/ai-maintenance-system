// Minimal OpenAI-compatible mock for local verification of agent-loop-enrich.
// Usage: node scripts/mock-llm.mjs [port]
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 54400);
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                analysis:
                  "Elevated drive-end vibration with rising BPFO energy indicates stage-3 inner-race bearing degradation; unplanned failure would cascade to belt and gearbox damage.",
                recommended_window_hours: 48,
                confidence: 88,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 60 },
      }),
    );
  });
}).listen(port, () => console.log(`mock llm on :${port}`));
