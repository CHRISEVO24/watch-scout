const { ApifyClient } = require("apify-client");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const LATEST_FILE = path.join(DATA_DIR, "fbmarketplace-latest.json");
const HISTORY_FILE = path.join(DATA_DIR, "fbmarketplace-history.json");

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) {
  console.error("Set APIFY_TOKEN in your environment before running this script.");
  process.exit(1);
}

const QUERY = args.query || "rolex watch";
const CITY_SLUG = args.citySlug || "westpalmbeach";
const LATITUDE = args.latitude || "26.60";
const LONGITUDE = args.longitude || "-80.24";
const RADIUS_MILES = args.radius || "100";
const MAX_ITEMS = Number(args.maxItems || 60);

const BRAND_KEYWORDS = [
  "rolex", "patek philippe", "audemars piguet", "richard mille", "omega",
  "tudor", "cartier", "panerai", "iwc", "breitling", "jaeger-lecoultre",
  "vacheron constantin", "grand seiko", "seiko", "tag heuer", "longines",
  "hamilton", "oris", "tissot", "zenith", "breguet",
];
function extractBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const hit = BRAND_KEYWORDS.find((b) => lower.includes(b));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
function extractRef(text) {
  if (!text) return null;
  const m = text.match(/\b(\d{4,6}[A-Z]{0,3})\b/);
  return m ? m[1] : null;
}

const ORIGIN_LAT = parseFloat(LATITUDE);
const ORIGIN_LON = parseFloat(LONGITUDE);

const CITY_COORDS = {
  "New York, NY": [40.7128, -74.0060], "Los Angeles, CA": [34.0522, -118.2437],
  "Chicago, IL": [41.8781, -87.6298], "Houston, TX": [29.7604, -95.3698],
  "Phoenix, AZ": [33.4484, -112.0740], "Philadelphia, PA": [39.9526, -75.1652],
  "San Antonio, TX": [29.4241, -98.4936], "San Diego, CA": [32.7157, -117.1611],
  "Dallas, TX": [32.7767, -96.7970], "San Jose, CA": [37.3382, -121.8863],
  "Austin, TX": [30.2672, -97.7431], "Jacksonville, FL": [30.3322, -81.6557],
  "Fort Worth, TX": [32.7555, -97.3308], "Columbus, OH": [39.9612, -82.9988],
  "Charlotte, NC": [35.2271, -80.8431], "San Francisco, CA": [37.7749, -122.4194],
  "Indianapolis, IN": [39.7684, -86.1581], "Seattle, WA": [47.6062, -122.3321],
  "Denver, CO": [39.7392, -104.9903], "Washington, DC": [38.9072, -77.0369],
  "Boston, MA": [42.3601, -71.0589], "Nashville, TN": [36.1627, -86.7816],
  "Detroit, MI": [42.3314, -83.0458], "Portland, OR": [45.5152, -122.6784],
  "Memphis, TN": [35.1495, -90.0490], "Las Vegas, NV": [36.1699, -115.1398],
  "Louisville, KY": [38.2527, -85.7585], "Baltimore, MD": [39.2904, -76.6122],
  "Milwaukee, WI": [43.0389, -87.9065], "Albuquerque, NM": [35.0844, -106.6504],
  "Tucson, AZ": [32.2226, -110.9747], "Fresno, CA": [36.7378, -119.7871],
  "Sacramento, CA": [38.5816, -121.4944], "Mesa, AZ": [33.4152, -111.8315],
  "Atlanta, GA": [33.7490, -84.3880], "Kansas City, MO": [39.0997, -94.5786],
  "Colorado Springs, CO": [38.8339, -104.8214], "Raleigh, NC": [35.7796, -78.6382],
  "Omaha, NE": [41.2565, -95.9345], "Miami, FL": [25.7617, -80.1918],
  "Oakland, CA": [37.8044, -122.2712], "Minneapolis, MN": [44.9778, -93.2650],
  "Tulsa, OK": [36.1540, -95.9928], "Cleveland, OH": [41.4993, -81.6944],
  "Wichita, KS": [37.6872, -97.3301], "Arlington, TX": [32.7357, -97.1081],
  "Tampa, FL": [27.9506, -82.4572], "New Orleans, LA": [29.9511, -90.0715],
  "Bakersfield, CA": [35.3733, -119.0187], "Honolulu, HI": [21.3069, -157.8583],
  "Anaheim, CA": [33.8366, -117.9143], "Santa Ana, CA": [33.7455, -117.8677],
  "St. Louis, MO": [38.6270, -90.1994], "Riverside, CA": [33.9533, -117.3962],
  "Corpus Christi, TX": [27.8006, -97.3964], "Lexington, KY": [38.0406, -84.5037],
  "Pittsburgh, PA": [40.4406, -79.9959], "Anchorage, AK": [61.2181, -149.9003],
  "Stockton, CA": [37.9577, -121.2908], "Cincinnati, OH": [39.1031, -84.5120],
  "St. Paul, MN": [44.9537, -93.0900], "Toledo, OH": [41.6528, -83.5379],
  "Greensboro, NC": [36.0726, -79.7920], "Newark, NJ": [40.7357, -74.1724],
  "Plano, TX": [33.0198, -96.6989], "Henderson, NV": [36.0395, -114.9817],
  "Lincoln, NE": [40.8136, -96.7026], "Buffalo, NY": [42.8864, -78.8784],
  "Fort Wayne, IN": [41.0793, -85.1394], "Jersey City, NJ": [40.7178, -74.0431],
  "Chula Vista, CA": [32.6401, -117.0842], "Orlando, FL": [28.5383, -81.3792],
  "St. Petersburg, FL": [27.7676, -82.6403], "Chandler, AZ": [33.3062, -111.8413],
  "Laredo, TX": [27.5306, -99.4803], "Norfolk, VA": [36.8508, -76.2859],
  "Durham, NC": [35.9940, -78.8986], "Madison, WI": [43.0731, -89.4012],
  "Lubbock, TX": [33.5779, -101.8552], "Winston-Salem, NC": [36.0999, -80.2442],
  "Garland, TX": [32.9126, -96.6389], "Glendale, AZ": [33.5387, -112.1860],
  "Hialeah, FL": [25.8576, -80.2781], "Reno, NV": [39.5296, -119.8138],
  "Baton Rouge, LA": [30.4515, -91.1871], "Irvine, CA": [33.6846, -117.8265],
  "Chesapeake, VA": [36.7682, -76.2875], "Irving, TX": [32.8140, -96.9489],
  "Scottsdale, AZ": [33.4942, -111.9261], "North Las Vegas, NV": [36.1989, -115.1175],
  "Fremont, CA": [37.5485, -121.9886], "Gilbert, AZ": [33.3528, -111.7890],
  "San Bernardino, CA": [34.1083, -117.2898], "Boise, ID": [43.6150, -116.2023],
  "Birmingham, AL": [33.5207, -86.8025], "Spokane, WA": [47.6588, -117.4260],
  "Rochester, NY": [43.1566, -77.6088], "Des Moines, IA": [41.5868, -93.6250],
  "Modesto, CA": [37.6391, -120.9969], "Fayetteville, NC": [35.0527, -78.8784],
  "Tacoma, WA": [47.2529, -122.4443], "Oxnard, CA": [34.1975, -119.1771],
  "Fontana, CA": [34.0922, -117.4350], "Columbus, GA": [32.4610, -84.9877],
  "Montgomery, AL": [32.3792, -86.3077], "Moreno Valley, CA": [33.9425, -117.2297],
  "Shreveport, LA": [32.5252, -93.7502], "Aurora, CO": [39.7294, -104.8319],
  "Yonkers, NY": [40.9312, -73.8988], "Akron, OH": [41.0814, -81.5190],
  "Huntington Beach, CA": [33.6595, -117.9988], "Little Rock, AR": [34.7465, -92.2896],
  "Augusta, GA": [33.4735, -82.0105], "Amarillo, TX": [35.2220, -101.8313],
  "Glendale, CA": [34.1425, -118.2551], "Mobile, AL": [30.6954, -88.0399],
  "Grand Rapids, MI": [42.9634, -85.6681], "Salt Lake City, UT": [40.7608, -111.8910],
  "Tallahassee, FL": [30.4383, -84.2807], "Huntsville, AL": [34.7304, -86.5861],
  "Grand Prairie, TX": [32.7460, -96.9978], "Knoxville, TN": [35.9606, -83.9207],
  "Worcester, MA": [42.2626, -71.8023], "Newport News, VA": [37.0871, -76.4730],
  "Brownsville, TX": [25.9017, -97.4975], "Overland Park, KS": [38.9822, -94.6708],
  "Santa Clarita, CA": [34.3917, -118.5426], "Providence, RI": [41.8240, -71.4128],
  "Garden Grove, CA": [33.7739, -117.9414], "Chattanooga, TN": [35.0456, -85.3097],
  "Oceanside, CA": [33.1959, -117.3795], "Jackson, MS": [32.2988, -90.1848],
  "Fort Lauderdale, FL": [26.1224, -80.1373], "Santa Rosa, CA": [38.4404, -122.7141],
  "Rancho Cucamonga, CA": [34.1064, -117.5931], "Port St. Lucie, FL": [27.2939, -80.3503],
  "Ontario, CA": [34.0633, -117.6509], "Vancouver, WA": [45.6387, -122.6615],
  "Tempe, AZ": [33.4255, -111.9400], "Springfield, MO": [37.2090, -93.2923],
  "Cape Coral, FL": [26.5629, -81.9495], "Pembroke Pines, FL": [26.0078, -80.2963],
  "Hollywood, FL": [26.0112, -80.1495], "West Palm Beach, FL": [26.7153, -80.0534],
  "Coral Springs, FL": [26.2712, -80.2706], "Palm Bay, FL": [28.0345, -80.5887],
  "Miami Gardens, FL": [25.9420, -80.2456], "Boca Raton, FL": [26.3683, -80.1289],
  "Deerfield Beach, FL": [26.3184, -80.0998], "Lake Worth, FL": [26.6168, -80.0576],
  "Wellington, FL": [26.6617, -80.2417], "Royal Palm Beach, FL": [26.7000, -80.2331],
  "San Mateo, CA": [37.5630, -122.3255], "Palo Alto, CA": [37.4419, -122.1430],
  "Sunnyvale, CA": [37.3688, -122.0363], "Mountain View, CA": [37.3861, -122.0839],
};

function toRad(deg) { return (deg * Math.PI) / 180; }
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
function distanceFromOrigin(locationLabel) {
  if (!locationLabel || !CITY_COORDS[locationLabel]) return null;
  const [lat, lon] = CITY_COORDS[locationLabel];
  return haversineMiles(ORIGIN_LAT, ORIGIN_LON, lat, lon);
}
function parsePrice(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/,/g, "").match(/\$?(\d+)/);
  return cleaned ? Number(cleaned[1]) : null;
}

async function run() {
  const client = new ApifyClient({ token: APIFY_TOKEN });

  const searchUrl = `https://www.facebook.com/marketplace/${CITY_SLUG}/search/?query=${encodeURIComponent(QUERY)}&latitude=${LATITUDE}&longitude=${LONGITUDE}&radius=${RADIUS_MILES}&exact=false&deliveryMethod=local_pick_up`;
  console.log(`Running apify/facebook-marketplace-scraper for: ${searchUrl}`);

  const run = await client.actor("apify/facebook-marketplace-scraper").call({
    startUrls: [{ url: searchUrl }],
    resultsLimit: MAX_ITEMS,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  console.log(`Apify returned ${items.length} raw items.`);
  if (items.length > 0 && args.inspect) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, "fbmarketplace-sample-raw.json"), JSON.stringify(items[0], null, 2), "utf8");
    console.log("Saved one raw item to data/fbmarketplace-sample-raw.json");
  }

  const listings = items.map((post, i) => {
    const title = post.marketplace_listing_title || post.title || null;
    const price = post.listing_price && post.listing_price.amount
      ? Math.round(parseFloat(post.listing_price.amount))
      : null;
    const city = post.location && post.location.reverse_geocode ? post.location.reverse_geocode.city : null;
    const state = post.location && post.location.reverse_geocode ? post.location.reverse_geocode.state : null;
    const locationLabel = city && state ? `${city}, ${state}` : (city || null);
    const distanceMiles = distanceFromOrigin(locationLabel);
    const distanceLabel = distanceMiles !== null ? `${distanceMiles.toLocaleString()} mi from WPB` : null;

    return {
      id: `fbm-${post.id || i}`,
      source: "FB Marketplace",
      sourceDetail: [locationLabel, distanceLabel].filter(Boolean).join(" · ") || "Marketplace",
      brand: extractBrand(title),
      model: null,
      ref: extractRef(title),
      title,
      dialColor: null,
      price,
      seller: null,
      condition: null,
      postedMinutesAgo: null,
      isNew: null,
      distanceMiles,
      url: post.listingUrl || null,
      scrapedAt: new Date().toISOString(),
    };
  });

  listings.sort((a, b) => (a.distanceMiles ?? 999999) - (b.distanceMiles ?? 999999));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(listings, null, 2), "utf8");

  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }
  }
  history.push({ scrapedAt: new Date().toISOString(), query: QUERY, citySlug: CITY_SLUG, count: listings.length });
  if (history.length > 20) history = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");

  console.log(`Done. ${listings.length} listings written to data/fbmarketplace-latest.json`);
}

run().catch((err) => {
  console.error("Apify Marketplace run failed:", err.message);
  process.exit(1);
});
