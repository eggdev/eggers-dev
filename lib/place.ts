// Where a posting may be: in or near New York, or remote and open to someone in the United States.
// A posting's place is free text from a job board ("San Francisco, CA | New York City, NY",
// "London, Remote", "Remote - USA"), often several places in one line. The answer comes from three
// plain questions, asked of the whole line:
//   Does it name the New York area? Then yes, whatever else it names.
//   Is it remote? If not, no: an office anywhere else is too far. A line that names only the
//     country ("United States") is taken as open to the whole country, so as remote.
//   Is the remote work held to somewhere outside the United States ("Remote - Canada", "Berlin,
//     Remote", "EMEA")? Then no, unless the line also names the United States or a place in it.
//   Is it held to named states or cities ("Remote - Texas", "Florida-Remote")? Then no, unless the
//     line also names the whole country. A town beside a board's own remote mark ("Austin, Remote")
//     is not that: it says where the office is, so it passes.
// An empty place, or a bare "Remote", says nothing against, so it passes.
// The lists are of what job boards really write. Add to them when a far place gets through.

const NEW_YORK = /new york|\bnyc\b|\bny\b|manhattan|brooklyn|queens\b|\bbronx\b|long island city|jersey city|hoboken|newark|weehawken|secaucus|stamford|greenwich|norwalk|westport|fairfield county|white plains|westchester|tri.?state|north.?east/i;
// New York State is large: these are a day's travel from the city.
const UPSTATE = /buffalo|rochester|albany|syracuse|ithaca|binghamton|saratoga/i;

const REMOTE = /\bremote\b|anywhere|any location|home.?based|work from home|\bwfh\b|distributed|\bvirtual\b|telecommute/i;

const US_WORDS = 'united states(?: of america)?|\\bu\\.s\\.a?\\.?|\\busa?\\b|north america|\\bamericas\\b|\\bamer\\b|nationwide';
const US_STATES = 'alabama|alaska|arizona|arkansas|california|colorado|delaware|florida|georgia|hawaii|idaho|illinois|indiana\\b|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming|connecticut|district of columbia';
const US_CITIES = 'san francisco|\\bsf\\b|bay area|silicon valley|los angeles|san diego|san jose|san mateo|palo alto|mountain view|sunnyvale|santa clara|menlo park|redwood city|foster city|oakland|berkeley|sacramento|irvine|santa monica|culver city|long beach|santa barbara|seattle|bellevue|redmond|portland|denver|boulder|austin|dallas|houston|san antonio|chicago|boston|atlanta|miami|tampa|orlando|philadelphia|pittsburgh|phoenix|scottsdale|salt lake|minneapolis|detroit|ann arbor|nashville|raleigh|durham|charlotte|las vegas|columbus|cincinnati|indianapolis|st\\.? louis|kansas city|baltimore';
const US_COUNTRY = new RegExp(`${US_WORDS}|\\bnamer\\b|\\beastern\\b|\\best\\b|east coast`, 'i');
const US_PLACE = new RegExp(`${US_STATES}|${US_CITIES}`, 'i');
// A state's two letters after a place ("Austin, TX"), capitals only. Left out: the ones that are also a word or another country's code (OR, IN, ME, OK, HI, ID, LA, DE, IL, CO, AR).
const US_STATE = /\b(?:AL|AK|AZ|CA|CT|DC|FL|GA|IA|KS|KY|MA|MD|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|OH|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
// Remote work held to a state or a city: "Remote - Texas", "Remote: CA", "Florida-Remote". After "Remote -" every state's two letters are safe to read.
const HELD = new RegExp(`\\bremote\\s*[-–—:]+\\s*(?:${US_STATES}|${US_CITIES}|[A-Z]{2}\\b)|(?:${US_STATES})\\s*[-–—]\\s*remote`, 'i');

const ABROAD = new RegExp('\\bemea\\b|\\bapac\\b|\\bapj\\b|\\blatam\\b|latin america|south america|central america|caribbean|europe|\\beu\\b|\\basia\\b|africa|middle east|oceania|\\banz\\b|nordics?\\b|benelux|\\bdach\\b|\\bmena\\b'
  + '|canada|(?<!new )m[eé]xico|\\bcdmx\\b|bra[sz]il|argentina|\\bchile\\b|colombia|\\bperu\\b|uruguay|costa rica|panama(?! city)|ecuador|guatemala|united kingdom|\\buk\\b|\\bu\\.k\\.|england|scotland|\\bwales\\b|ireland|france|germany|deutschland|spain|portugal|italy|netherlands|belgium|luxembourg|switzerland|austria|sweden|norway|denmark|finland|iceland|poland|czech|slovakia|hungary|romania|bulgaria|greece|serbia|croatia|slovenia|estonia|latvia|lithuania|ukraine|turkey|türkiye|israel|\\buae\\b|united arab emirates|saudi arabia|\\bksa\\b|qatar|egypt|nigeria|kenya|ghana|morocco|\\bindia\\b|pakistan|bangladesh|sri lanka|nepal|china|hong kong|taiwan|japan|korea|singapore|malaysia|indonesia|thailand|vietnam|philippines|australia|new zealand|cyprus|\\bmalta\\b|armenia|kazakhstan'
  + '|london|manchester|edinburgh|glasgow|dublin|belfast|\\bcork\\b|paris|nantes|\\blyon\\b|toulouse|bordeaux|berlin|munich|münchen|hamburg|frankfurt|cologne|stuttgart|amsterdam|rotterdam|utrecht|brussels|zurich|zürich|geneva|lausanne|vienna|madrid|barcelona|valencia|lisbon|\\bporto\\b|\\brome\\b|milan|stockholm|gothenburg|\\boslo\\b|copenhagen|aarhus|helsinki|warsaw|krak[oó]w|wroc[lł]aw|gda[nń]sk|prague|\\bbrno\\b|budapest|bucharest|\\bcluj\\b|\\bsofia\\b|athens|belgrade|zagreb|ljubljana|tallinn|\\briga\\b|vilnius|kaunas|kyiv|yerevan|tbilisi|istanbul|tel aviv|dubai|abu dhabi|riyadh|\\bdoha\\b|cairo|\\blagos\\b|nairobi|cape town|johannesburg|bangalore|bengaluru|hyderabad|mumbai|\\bpune\\b|chennai|gurgaon|gurugram|noida|delhi|beijing|shanghai|shenzhen|hangzhou|tokyo|osaka|seoul|taipei|kuala lumpur|jakarta|bangkok|ho chi minh|hanoi|manila|sydney|melbourne|brisbane|\\bperth\\b|adelaide|canberra|auckland|wellington|toronto|vancouver|montr[eé]al|ottawa|calgary|edmonton|winnipeg|kitchener|ontario|qu[eé]bec|british columbia|alberta|nova scotia|guadalajara|monterrey|s[aã]o paulo|rio de janeiro|florian[oó]polis|buenos aires|bogot[aá]|medell[ií]n|santiago|\\blima\\b|montevideo', 'i');
// A country's code as some boards prefix it ("CAN: Vancouver", "AU: Sydney"), capitals only.
const ABROAD_CODE = /\b(?:CAN|AUS?|GBR|IND|DEU|FRA|IRL|NLD|SGP|JPN|BRA|MEX|POL|ESP|ISR)\b/;

// True when a line names countries and regions and nothing smaller: no town, state or office.
const onlyCountry = (place: string) => new RegExp(US_WORDS, 'i').test(place)
  && place.replace(new RegExp(US_WORDS, 'gi'), ' ').replace(new RegExp(ABROAD.source, 'gi'), ' ').replace(/\b(?:remote|only|based|within|in|the|of|america|and|or)\b/gi, ' ').replace(/[^a-z]/gi, '') === '';

export function nearby(place: string): boolean {
  const p = place.trim();
  if (p === '') return true;
  if (NEW_YORK.test(p) && !(UPSTATE.test(p) && !/new york city|\bnyc\b|manhattan|brooklyn/i.test(p))) return true;
  if (!REMOTE.test(p) && !onlyCountry(p)) return false;
  const country = US_COUNTRY.test(p);
  if (HELD.test(p) && !country) return false;
  const abroad = ABROAD.test(p) || ABROAD_CODE.test(p), here = country || US_PLACE.test(p) || US_STATE.test(p);
  return !abroad || here;
}
