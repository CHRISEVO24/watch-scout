const DATA_BASE_URL = "https://raw.githubusercontent.com/CHRISEVO24/watch-scout/main/data";

function normalizeRef(ref) {
  if (!ref) return null;
  return String(ref).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scoreMatch(item, wtb) {
  let score = 0;
  const itemText = [item.brand, item.model, item.ref, item.title, item.name].filter(Boolean).join(" ").toLowerCase();
  if (wtb.ref && item.ref) {
    const ni = normalizeRef(item.ref), nw = normalizeRef(wtb.ref);
    if (ni === nw) score += 100;
    else if (ni && nw && (ni.startsWith(nw) || nw.startsWith(ni))) score += 60;
  }
  if (wtb.brand && itemText.includes(wtb.brand.toLowerCase())) score += 30;
  if (wtb.model) {
    const words = wtb.model.toLowerCase().split(/\s+/);
    words.filter(w => w.length > 3 && itemText.includes(w)).forEach(() => score += 10);
  }
  if (wtb.budgetMax && item.price) {
    const p = typeof item.price === "string" ? parseFloat(item.price.replace(/[^0-9.]/g, "")) : item.price;
    if (!isNaN(p) && p > wtb.budgetMax * 1.2) score = Math.max(0, score - 40);
  }
  return score;
}

async function fetchJson(path) {
  try {
    const res = await fetch(`${DATA_BASE_URL}/${path}`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function fmtPrice(p) {
  if (!p) return "—";
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? String(p) : "$" + Math.round(n).toLocaleString();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const { firstName, lastName, email, phone, brand, model, ref, budgetMax, condition, boxPapers, notes } = req.body;
  if (!brand || !email) return res.status(400).json({ ok: false, error: "brand and email required" });

  try {
    // Fetch all data sources in parallel
    const [wpb, eci, combined, ic] = await Promise.all([
      fetchJson("inventory-latest.json"),
      fetchJson("eci-inventory-latest.json"),
      fetchJson("combined.json"),
      fetchJson("inventoryconnect-latest.json"),
    ]);

    const allInventory = [
      ...wpb.map(i => ({ ...i, _store: "WPB Watch Co" })),
      ...eci.map(i => ({ ...i, _store: "ECI Jewelers" })),
    ].filter(i => (i.stockStatus || "").toLowerCase() !== "out of stock");

    const wtb = { brand, model, ref, budgetMax: budgetMax ? Number(budgetMax) : null, keywords: notes };

    const invMatches = allInventory
      .map(item => ({ item, score: scoreMatch(item, wtb) }))
      .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 10)
      .map(m => ({ score: m.score, store: m.item._store, name: m.item.name, ref: m.item.referenceNumber || m.item.ref, price: m.item.price, url: m.item.url }));

    const mktMatches = combined
      .map(item => ({ item, score: scoreMatch(item, wtb) }))
      .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 12)
      .map(m => ({ score: m.score, source: m.item.source, title: m.item.title || m.item.name, ref: m.item.ref, price: m.item.price, url: m.item.url }));

    const icMatches = (ic || []).filter(i => i.intent === "sell")
      .map(item => ({ item, score: scoreMatch(item, wtb) }))
      .filter(m => m.score >= 30).sort((a, b) => b.score - a.score).slice(0, 8)
      .map(m => ({ score: m.score, seller: m.item.seller, name: m.item.title || m.item.model, ref: m.item.ref, price: m.item.price, url: m.item.url }));

    const totalMatches = invMatches.length + mktMatches.length + icMatches.length;

    // Build HTML email body
    const invRows = invMatches.map(m => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#111;">${m.name || ""}</strong><br>
          <span style="color:#6b7280;font-size:13px;">${m.store}${m.ref ? " · Ref. " + m.ref : ""}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
          <strong style="color:#92400e;font-size:16px;">${fmtPrice(m.price)}</strong><br>
          <a href="mailto:chris@wpbwatchco.com?subject=Interested in ${encodeURIComponent(m.name || "")}" style="font-size:12px;color:#2563eb;">Contact WPB Watch Co</a>
        </td>
      </tr>`).join("");

    const icRows = icMatches.map(m => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#111;">${m.name || ""}</strong><br>
          <span style="color:#6b7280;font-size:13px;">${m.seller || "Dealer"}${m.ref ? " · Ref. " + m.ref : ""}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
          <strong style="color:#92400e;font-size:16px;">${fmtPrice(m.price)}</strong><br>
          ${m.url ? `<a href="${m.url}" style="font-size:12px;color:#2563eb;">Message Seller on InventoryConnect</a>` : ""}
        </td>
      </tr>`).join("");

    const mktRows = mktMatches.slice(0, 8).map(m => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#111;">${m.title || ""}</strong><br>
          <span style="color:#6b7280;font-size:13px;">${m.source}${m.ref ? " · Ref. " + m.ref : ""}</span>
        </td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">
          <strong style="color:#92400e;font-size:16px;">${fmtPrice(m.price)}</strong><br>
          ${m.url ? `<a href="${m.url}" style="font-size:12px;color:#2563eb;">View Listing</a>` : ""}
        </td>
      </tr>`).join("");

    const clientHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#f9fafb;margin:0;padding:24px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <div style="background:#0f1117;padding:24px 28px;">
    <div style="font-size:20px;font-weight:700;color:#c9a05b;">WPB Watch Co</div>
    <div style="font-size:13px;color:#9a9691;margin-top:2px;">West Palm Beach, FL · 844-972-9282 · chris@wpbwatchco.com</div>
  </div>
  <div style="padding:24px 28px;border-bottom:1px solid #e5e7eb;">
    <p style="font-size:15px;color:#111;margin:0 0 8px;">Hi ${firstName || "there"},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0;">
      Thank you for your watch request. We searched our inventory and the full pre-owned market for your
      <strong>${brand} ${model || ""} ${ref ? "· Ref. " + ref : ""}</strong>${budgetMax ? " (budget up to $" + Number(budgetMax).toLocaleString() + ")" : ""}.
      Here's what we found (${totalMatches} total matches):
    </p>
  </div>
  ${invRows ? `<div style="padding:20px 28px 0;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#059669;margin-bottom:10px;">● Available in Our Inventory</div>
    <table style="width:100%;border-collapse:collapse;">${invRows}</table>
    <p style="font-size:12px;color:#6b7280;margin:8px 0 20px;">Call us at <a href="tel:8449729282" style="color:#2563eb;">844-972-9282</a> or email <a href="mailto:chris@wpbwatchco.com" style="color:#2563eb;">chris@wpbwatchco.com</a></p>
  </div>` : ""}
  ${icRows ? `<div style="padding:20px 28px 0;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#0284c7;margin-bottom:10px;">● Available from Verified Dealers</div>
    <table style="width:100%;border-collapse:collapse;">${icRows}</table>
  </div>` : ""}
  ${mktRows ? `<div style="padding:20px 28px 0;">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:10px;">● Market Listings</div>
    <table style="width:100%;border-collapse:collapse;">${mktRows}</table>
  </div>` : ""}
  <div style="padding:24px 28px;background:#f9fafb;margin-top:24px;">
    <p style="font-size:13px;color:#6b7280;margin:0 0 6px;">Questions? We're here to help.</p>
    <p style="font-size:13px;color:#374151;margin:0;"><strong>WPB Watch Co</strong> · 1601 Forum Pl, West Palm Beach, FL 33401<br>
    <a href="tel:8449729282" style="color:#2563eb;">844-972-9282</a> · <a href="mailto:chris@wpbwatchco.com" style="color:#2563eb;">chris@wpbwatchco.com</a></p>
  </div>
</div></body></html>`;

    // Email notification to Chris using Resend (free tier)
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (RESEND_KEY) {
      // Notify Chris
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "WPB Watch Scout <onboarding@resend.dev>",
          to: ["chris@wpbwatchco.com"],
          subject: `New WTB Request — ${brand} ${model || ""} ${ref ? "Ref. " + ref : ""} (${totalMatches} matches)`,
          html: `<h2>New WTB Request</h2>
<p><strong>Client:</strong> ${firstName} ${lastName} (${email}${phone ? " · " + phone : ""})</p>
<p><strong>Looking for:</strong> ${brand} ${model || ""} ${ref ? "Ref. " + ref : ""}</p>
<p><strong>Budget:</strong> ${budgetMax ? "$" + Number(budgetMax).toLocaleString() : "Not specified"}</p>
<p><strong>Matches found:</strong> ${totalMatches} (${invMatches.length} inventory, ${icMatches.length} IC dealers, ${mktMatches.length} market)</p>
<p><strong>Notes:</strong> ${notes || "None"}</p>
<hr>
<p>Review in Watch Scout and click "Send to Client" when ready.</p>
<p>Client email HTML is ready to send to: ${email}</p>`,
        }),
      });
    }

    return res.status(200).json({
      ok: true,
      totalMatches,
      invMatches: invMatches.length,
      mktMatches: mktMatches.length,
      icMatches: icMatches.length,
      clientHtml,
      submission: { firstName, lastName, email, phone, brand, model, ref, budgetMax, condition, boxPapers, notes, submittedAt: new Date().toISOString() },
    });

  } catch (err) {
    console.error("WTB submit error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
