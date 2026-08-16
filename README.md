# Watch Scout — setup notes

## What's here

- `watch-scout-dashboard.html` — the dashboard. Open it directly in a browser,
  or drag-and-drop onto Netlify like your other dashboards. Currently loaded
  with sample data in the exact shape the scrapers below produce, so you can
  see the design and filtering before wiring up live data.
- `scrapers/watchrecon-scraper.js` — scrapes watchrecon.com.
- `scrapers/watchpatrol-api.js` — calls watchpatrol.net's REST API (not a
  scraper — they have a real public API).
- `scrapers/apify-fb-groups.js` — pulls posts from public Facebook groups via
  Apify's official actor.
- `scrapers/merge.js` — combines all three into `data/combined.json`.

## Before you run anything: source notes

**watchpatrol.net (your typo'd watchpatrol.com) is the best source here.**
It's not a site to scrape — it's a proper meta-search engine with a typed
REST API: <https://www.watchpatrol.net/api/public/v1/docs/>. As of this
write-up it covers 419 brands, 4,679 models, and 119,970+ listings across 22
sources, with endpoints like `GET /listings/?brand=rolex&max_price=15000`,
plus pricing aggregates and even an image-based watch identifier. They're
onboarding API partners manually during their beta — request access at
<https://www.watchpatrol.net/contact/>, mention you want listings + pricing
endpoint access for a dealer-side monitoring tool. I couldn't pull their
exact response schema (their docs page blocks automated fetches), so
`watchpatrol-api.js` ships with reasonable field-name guesses — run it with
`--inspect` once you have a key and adjust `normalizeListing()` to match
what actually comes back.

**Facebook Marketplace isn't covered.** Apify has no official, well-maintained
actor for Marketplace listings — only community ones with spotty reliability.
I built against the official `apify/facebook-groups-scraper` actor instead,
which covers public groups cleanly. If you want to take a shot at Marketplace
later, point me at a specific Apify Store actor and I'll evaluate it, but I'd
hold off building a workflow around it until one looks stable.

**WhatsApp can't be scraped.** Not an Apify limitation specifically — there's
no compliant way to pull data out of WhatsApp groups or chats short of the
WhatsApp Business API, which is a different kind of integration entirely
(you'd need Meta Business approval and it's webhook-based, not a scraper).
If leads come to you over WhatsApp today, the realistic options are: forward
them manually into the dashboard, or set up Business API down the line as a
separate project.

## Setup

```bash
cd watch-scout
npm install axios cheerio apify-client
```

### WatchPatrol (recommended primary source)

```bash
export WATCHPATROL_API_KEY=your_key_here   # request at watchpatrol.net/contact
node scrapers/watchpatrol-api.js --brand=rolex --inspect   # run --inspect first
```

Check `data/watchpatrol-raw-sample.json` against `normalizeListing()` in the
script and adjust field names if needed, then drop `--inspect` for normal runs.

### WatchRecon (secondary — free, no key, HTML scrape)

```bash
node scrapers/watchrecon-scraper.js --brand=rolex --days=7
```

No API key needed — it's a public site. Run `--inspect` once first to dump
raw HTML to `data/watchrecon-raw.html` and sanity-check the selectors still
match (Watchrecon ships markup tweaks occasionally — their own homepage
currently has a banner saying WatchUSeek listings are temporarily down on
their end).

### Facebook Groups (Apify)

```bash
export APIFY_TOKEN=your_token_here
node scrapers/apify-fb-groups.js --groups="https://www.facebook.com/groups/your-group-id"
```

Get your token from Apify Console → Settings → Integrations. Only public
groups work — pass the URLs of the watch trading groups you're already a
member of and want monitored. Pricing is roughly $2.60 per 1,000 posts on
Apify's end.

### Merge and feed the dashboard

```bash
node scrapers/merge.js
```

This writes `data/combined.json`. Easiest way to get it into the dashboard:
open `data/combined.json`, copy the array, and paste it in place of the
`LISTINGS` array near the top of the `<script>` block in
`watch-scout-dashboard.html`. If you'd rather automate that swap (or serve
the dashboard from a folder where it can `fetch()` the JSON directly instead
of a hardcoded array), say the word and I'll wire it up — it's a small
change once you've confirmed the sources are pulling what you want.

## Nickname matching

The dashboard's "Hot leads" panel matches against a watchlist array
(`NICKNAME_WATCHLIST`) near the top of the script — currently seeded with
Hulk, Bruce Wayne, Batgirl, Pepsi GMT, and a few others. Edit that array to
match whatever nicknames you're actively hunting for.
