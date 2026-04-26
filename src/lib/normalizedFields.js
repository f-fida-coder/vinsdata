// Mirror of NORMALIZED_FIELDS in api/pipeline.php. Keep these two in sync.

export const NORMALIZED_FIELDS = [
  { key: 'vin',              label: 'VIN' },
  { key: 'first_name',       label: 'First name' },
  { key: 'last_name',        label: 'Last name' },
  { key: 'full_name',        label: 'Full name' },
  { key: 'phone_primary',    label: 'Phone 1 (primary)' },
  { key: 'phone_secondary',  label: 'Phone 2' },
  { key: 'phone_3',          label: 'Phone 3' },
  { key: 'phone_4',          label: 'Phone 4' },
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

// Convenience: keys for the four phone slots in their fallback order.
export const PHONE_FIELD_KEYS = ['phone_primary', 'phone_secondary', 'phone_3', 'phone_4'];

export const NORMALIZED_FIELD_KEYS = NORMALIZED_FIELDS.map((f) => f.key);

// Heuristic for auto-suggesting a mapping when no template is selected.
// Compares a header string (lower-cased, stripped of punctuation) to a list of aliases per field.
const ALIASES = {
  vin:              ['vin', 'vehicleidentificationnumber', 'vinnumber'],
  first_name:       ['firstname', 'fname', 'givenname', 'first'],
  last_name:        ['lastname', 'lname', 'surname', 'familyname', 'last'],
  full_name:        ['fullname', 'name', 'customername', 'ownername'],
  phone_primary:    ['phone', 'phone1', 'primaryphone', 'mobile', 'cell', 'cellphone', 'phonenumber'],
  phone_secondary:  ['phone2', 'secondaryphone', 'altphone', 'alternatephone', 'homephone'],
  phone_3:          ['phone3', 'tertiaryphone', 'workphone', 'phonethree'],
  phone_4:          ['phone4', 'quaternaryphone', 'phonefour', 'otherphone'],
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

export function suggestFieldForHeader(header) {
  const key = normalizeHeader(header);
  if (!key) return '_ignore';
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  // Fuzzy: header contains an alias as a substring (e.g. "Primary Phone #" → phone_primary)
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => key.includes(a))) return field;
  }
  return '_ignore';
}
