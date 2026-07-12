export type CountryBusinessLike = {
  location?: unknown;
  raw?: unknown;
};

const REGION_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GT","GU","GW","GY","HK","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ","TC","TD","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","YT","ZA","ZM","ZW"
];

const displayNames = (() => {
  try {
    const intl = (Intl as unknown as { DisplayNames?: new (locales: string[], options: { type: string }) => { of(code: string): string | undefined } }).DisplayNames;
    return intl ? new intl(["en"], { type: "region" }) : null;
  } catch {
    return null;
  }
})();

const COUNTRY_BY_CODE = new Map<string, string>();
for (const code of REGION_CODES) {
  const name = displayNames?.of(code) || code;
  COUNTRY_BY_CODE.set(code.toLowerCase(), name);
}
COUNTRY_BY_CODE.set("uk", "United Kingdom");

const EXTRA_ALIASES: Record<string, string> = {
  "usa": "United States",
  "u.s.a": "United States",
  "u.s.a.": "United States",
  "us": "United States",
  "u.s.": "United States",
  "america": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  "britain": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "uae": "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "emirates": "United Arab Emirates",
  "south korea": "South Korea",
  "republic of korea": "South Korea",
  "north korea": "North Korea",
  "russia": "Russia",
  "czech republic": "Czechia",
  "ivory coast": "Côte d’Ivoire",
  "cote d ivoire": "Côte d’Ivoire",
  "viet nam": "Vietnam",
  "hong kong": "Hong Kong",
  "macau": "Macao",
};

const COUNTRY_NAMES = new Map<string, string>();
for (const country of COUNTRY_BY_CODE.values()) COUNTRY_NAMES.set(normalizeForMatch(country), country);
for (const [alias, country] of Object.entries(EXTRA_ALIASES)) COUNTRY_NAMES.set(normalizeForMatch(alias), country);

const CITY_TO_COUNTRY: Record<string, string> = {
  "berlin": "Germany",
  "munich": "Germany",
  "hamburg": "Germany",
  "frankfurt": "Germany",
  "cologne": "Germany",
  "dusseldorf": "Germany",
  "stuttgart": "Germany",
  "paris": "France",
  "lyon": "France",
  "marseille": "France",
  "madrid": "Spain",
  "barcelona": "Spain",
  "valencia": "Spain",
  "rome": "Italy",
  "milan": "Italy",
  "naples": "Italy",
  "amsterdam": "Netherlands",
  "rotterdam": "Netherlands",
  "brussels": "Belgium",
  "antwerp": "Belgium",
  "london": "United Kingdom",
  "manchester": "United Kingdom",
  "birmingham": "United Kingdom",
  "glasgow": "United Kingdom",
  "dublin": "Ireland",
  "cork": "Ireland",
  "zurich": "Switzerland",
  "geneva": "Switzerland",
  "vienna": "Austria",
  "salzburg": "Austria",
  "stockholm": "Sweden",
  "gothenburg": "Sweden",
  "oslo": "Norway",
  "copenhagen": "Denmark",
  "helsinki": "Finland",
  "warsaw": "Poland",
  "krakow": "Poland",
  "prague": "Czechia",
  "lisbon": "Portugal",
  "porto": "Portugal",
  "athens": "Greece",
  "istanbul": "Turkey",
  "ankara": "Turkey",
  "dubai": "United Arab Emirates",
  "abu dhabi": "United Arab Emirates",
  "doha": "Qatar",
  "riyadh": "Saudi Arabia",
  "jeddah": "Saudi Arabia",
  "kuwait city": "Kuwait",
  "cairo": "Egypt",
  "alexandria": "Egypt",
  "lagos": "Nigeria",
  "abuja": "Nigeria",
  "accra": "Ghana",
  "nairobi": "Kenya",
  "johannesburg": "South Africa",
  "cape town": "South Africa",
  "new york": "United States",
  "los angeles": "United States",
  "chicago": "United States",
  "san francisco": "United States",
  "houston": "United States",
  "miami": "United States",
  "toronto": "Canada",
  "vancouver": "Canada",
  "montreal": "Canada",
  "ottawa": "Canada",
  "sydney": "Australia",
  "melbourne": "Australia",
  "brisbane": "Australia",
  "perth": "Australia",
  "auckland": "New Zealand",
  "wellington": "New Zealand",
  "singapore": "Singapore",
  "kuala lumpur": "Malaysia",
  "bangkok": "Thailand",
  "manila": "Philippines",
  "jakarta": "Indonesia",
  "hanoi": "Vietnam",
  "ho chi minh": "Vietnam",
  "tokyo": "Japan",
  "osaka": "Japan",
  "seoul": "South Korea",
  "beijing": "China",
  "shanghai": "China",
  "shenzhen": "China",
  "hong kong": "Hong Kong",
  "mumbai": "India",
  "delhi": "India",
  "bengaluru": "India",
  "bangalore": "India",
  "pune": "India",
  "mexico city": "Mexico",
  "sao paulo": "Brazil",
  "rio de janeiro": "Brazil",
  "buenos aires": "Argentina",
  "santiago": "Chile",
};

const COUNTRY_FIELD_KEYWORDS = ["country", "nation"];
const LOCATION_FIELD_KEYWORDS = [
  "location",
  "market",
  "city",
  "region",
  "state",
  "province",
  "address",
  "territory",
  "headquarter",
  "hq",
];

function normalizeForMatch(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanPotentialLocation(value: unknown) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (cleaned.length > 240) return "";
  const lower = cleaned.toLowerCase();
  if (lower.includes("@")) return "";
  if (lower.startsWith("http")) return "";
  if (lower.includes("www.")) return "";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) return "";
  return cleaned;
}

function matchesWord(haystack: string, needle: string) {
  if (!needle) return false;
  return new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(haystack);
}

function countryFromText(value: unknown, key = "") {
  const cleaned = cleanPotentialLocation(value);
  if (!cleaned) return "";
  const normalized = normalizeForMatch(cleaned);
  const normalizedKey = normalizeForMatch(key);

  if (/^[a-z]{2}$/i.test(cleaned.trim())) {
    const fromCode = COUNTRY_BY_CODE.get(cleaned.trim().toLowerCase());
    if (fromCode) return fromCode;
  }

  const exact = COUNTRY_NAMES.get(normalized);
  if (exact) return exact;

  const commaParts = normalized.split(" ").length > 1 ? cleaned.split(",").map((part) => normalizeForMatch(part)).filter(Boolean) : [];
  for (let i = commaParts.length - 1; i >= 0; i -= 1) {
    const country = COUNTRY_NAMES.get(commaParts[i]);
    if (country) return country;
    const codeCountry = /^[a-z]{2}$/i.test(commaParts[i]) ? COUNTRY_BY_CODE.get(commaParts[i]) : "";
    if (codeCountry) return codeCountry;
  }

  for (const [alias, country] of COUNTRY_NAMES.entries()) {
    if (alias.length >= 4 && matchesWord(normalized, alias)) return country;
  }

  if (normalizedKey.includes("city") || normalizedKey.includes("location") || normalizedKey.includes("address") || normalizedKey.includes("market")) {
    for (const [city, country] of Object.entries(CITY_TO_COUNTRY)) {
      if (matchesWord(normalized, normalizeForMatch(city))) return country;
    }
  }

  return "";
}

function collectCountries(target: Set<string>, key: string, value: unknown) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCountries(target, key, item));
    return;
  }
  const country = countryFromText(value, key);
  if (country) target.add(country);
}

export function extractBusinessCountries(business: CountryBusinessLike) {
  const countries = new Set<string>();
  collectCountries(countries, "location", business.location);

  const raw = business.raw && typeof business.raw === "object" ? (business.raw as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeForMatch(key);
    const isCountryField = COUNTRY_FIELD_KEYWORDS.some((keyword) => normalizedKey.includes(keyword));
    const isLocationField = LOCATION_FIELD_KEYWORDS.some((keyword) => normalizedKey.includes(keyword));
    if (isCountryField || isLocationField) collectCountries(countries, key, value);
  }

  return Array.from(countries).sort((a, b) => a.localeCompare(b));
}

export function businessMatchesCountry(business: CountryBusinessLike, selectedCountry: string) {
  const selected = countryFromText(selectedCountry, "country") || selectedCountry;
  if (!selected) return true;
  return extractBusinessCountries(business).some((country) => country.toLowerCase() === selected.toLowerCase());
}

export function applyCountryFilter<T extends CountryBusinessLike>(rows: T[], selectedCountry: string) {
  const selected = countryFromText(selectedCountry, "country") || selectedCountry;
  if (!selected) return rows;
  return rows.filter((row) => businessMatchesCountry(row, selected));
}
