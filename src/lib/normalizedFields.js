// Mirror of NORMALIZED_FIELDS in api/pipeline.php. Keep these two in sync.

export const NORMALIZED_FIELDS = [
  { key: 'vin',              label: 'VIN' },
  { key: 'first_name',       label: 'First name' },
  { key: 'last_name',        label: 'Last name' },
  { key: 'full_name',        label: 'Full name' },
  { key: 'phone_primary',    label: 'Phone (primary)' },
  { key: 'phone_secondary',  label: 'Phone (secondary)' },
  { key: 'email_primary',    label: 'Email' },
  { key: 'full_address',     label: 'Full address' },
  { key: 'city',             label: 'City' },
  { key: 'state',            label: 'State' },
  { key: 'zip_code',         label: 'ZIP code' },
  { key: 'make',             label: 'Make' },
  { key: 'model',            label: 'Model' },
  { key: 'year',             label: 'Year' },
  { key: 'mileage',          label: 'Mileage' },
  { key: '_ignore',          label: '— Ignore this column —' },
];

export const NORMALIZED_FIELD_KEYS = NORMALIZED_FIELDS.map((f) => f.key);

// Heuristic for auto-suggesting a mapping when no template is selected.
// Compares a header string against a list of aliases per field.
//
// Bare position modifiers like 'first' / 'last' / 'name' are intentionally NOT
// listed as standalone aliases. They are too generic and used to false-match
// headers like "LastReportedCity" / "LastServiceDate" / "Service Center Name"
// to last_name / full_name. Real headers use compound forms (firstname,
// lastname, customername, ownername) which still match exactly.
const ALIASES = {
  vin:              ['vin', 'vehicleidentificationnumber', 'vinnumber'],
  first_name:       ['firstname', 'fname', 'givenname'],
  last_name:        ['lastname', 'lname', 'surname', 'familyname'],
  full_name:        ['fullname', 'customername', 'ownername'],
  phone_primary:    ['phone', 'phone1', 'primaryphone', 'mobile', 'mobilephone', 'cell', 'cellphone', 'phonenumber', 'phonenumber1'],
  phone_secondary:  ['phone2', 'phonenumber2', 'secondaryphone', 'altphone', 'alternatephone', 'homephone'],
  email_primary:    ['email', 'emailaddress', 'email1', 'primaryemail'],
  full_address:     ['address', 'fulladdress', 'streetaddress', 'mailingaddress'],
  city:             ['city', 'town'],
  state:            ['state', 'province', 'region'],
  zip_code:         ['zip', 'zipcode', 'postalcode', 'postcode'],
  make:             ['make', 'brand', 'manufacturer'],
  model:            ['model'],
  year:             ['year', 'vehicleyear', 'modelyear'],
  mileage:          ['mileage', 'odometer', 'miles', 'kilometers', 'km'],
};

function normalizeHeader(header) {
  return String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Split a header into word tokens, treating camelCase boundaries and any
// non-alphanumeric run as a separator. "LastReportedCity" → ["last","reported","city"].
function tokenizeHeader(header) {
  return String(header || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function suggestFieldForHeader(header) {
  const key = normalizeHeader(header);
  if (!key) return '_ignore';

  // Pass 1: exact match on the fully-normalized header.
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(key)) return field;
  }

  // Pass 2: longest contiguous-token-N-gram match. Why N-grams instead of
  // String.includes: 'last' must not match inside 'lastreportedcity', because
  // "LastReportedCity" is a city, not a last name. Tokenizing first ensures
  // 'last' only matches when it's actually a separate word — which the
  // alias list no longer allows for 'last'/'first'/'name' anyway, but the
  // structure protects against future false positives too.
  //
  // Tiebreakers for matches of equal length: prefer the one whose start
  // token is later (the trailing word is usually the noun — "Reported City"
  // is about a city, "Customer First Name" is about a first name).
  const tokens = tokenizeHeader(header);
  if (tokens.length === 0) return '_ignore';

  let best = null;
  for (let len = tokens.length; len >= 1; len--) {
    for (let start = 0; start + len <= tokens.length; start++) {
      const ngram = tokens.slice(start, start + len).join('');
      for (const [field, aliases] of Object.entries(ALIASES)) {
        if (!aliases.includes(ngram)) continue;
        if (
          !best ||
          len > best.length ||
          (len === best.length && start > best.start)
        ) {
          best = { field, length: len, start };
        }
      }
    }
  }

  return best ? best.field : '_ignore';
}
