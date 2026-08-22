const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "CHRISEVO24/watch-scout";
const FILE_PATH = "data/wtb-pending.json";

async function getFile() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }
  });
  if (r.status === 404) return { content: [], sha: null };
  const data = await r.json();
  const content = JSON.parse(Buffer.from(data.content, "base64").toString());
  return { content, sha: data.sha };
}

async function saveFile(content, sha) {
  const body = { message: "WTB submission", content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64") };
  if (sha) body.sha = sha;
  await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: "PUT",
    headers: { Authorization: `token ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { content } = await getFile();
    return res.json({ ok: true, submissions: content });
  }
  if (req.method === "POST") {
    const { content, sha } = await getFile();
    const sub = { ...req.body, id: Date.now().toString(), submittedAt: new Date().toISOString() };
    content.push(sub);
    await saveFile(content, sha);
    return res.json({ ok: true, id: sub.id });
  }
}
