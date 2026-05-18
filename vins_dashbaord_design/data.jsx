// Mock data for VINVAULT CRM

const FIRST_NAMES = ["Bryan","Miles","Bryson","Boulder","Herbert","Katherine","Becky","Thomas","Esther","Jordan","Amelia","Caleb","Nora","Ezra","Iris","Wesley","Maya","Owen","Sienna","Theo","Zara","Felix","Hazel","Roman","Vera","Asher","Lila","Knox","Wren","Beau","Cora","Silas","Eden","Jude","Noemi","Cyrus","Margot","Reed","Tess","Dax","Juno","Otto","Mira","Lyle","Saoirse","Ivor","Thalia","Quinn","Rhea","Caspian"];
const CITIES = ["Charleston","Austin","Dallas","Boulder","Indianapolis","Auburn","Vestavia","Myersville","Aspen","Tacoma","Boise","Sedona","Ojai","Bend","Marfa","Hudson","Asheville","Savannah","Burlington","Carmel","Sausalito","Telluride","Park City","Truckee","Galena","Stowe","Bisbee","Taos","Whitefish","Mendocino"];
const MAKES = ["Toyota","Honda","Ford","Chevrolet","Nissan","Subaru","Jeep","BMW","Mercedes","Audi","Lexus","Porsche","Tesla","Mazda","Kia","Volvo","Acura","Infiniti","GMC","Ram"];
const MODELS = {
  Toyota: ["Land Cruiser","4Runner","Tacoma","Tundra","Highlander","RAV4","Camry"],
  Honda: ["Civic","CR-V","Pilot","Accord","Odyssey"],
  Ford: ["F-150","Mustang","Bronco","Explorer","Ranger"],
  Chevrolet: ["Silverado","Tahoe","Suburban","Camaro","Corvette"],
  Nissan: ["Frontier","Pathfinder","Altima","Titan"],
  Subaru: ["Outback","Forester","Crosstrek","WRX"],
  Jeep: ["Wrangler","Grand Cherokee","Gladiator","Cherokee"],
  BMW: ["X5","M3","3 Series","5 Series","X3"],
  Mercedes: ["G-Class","E-Class","GLE","C-Class"],
  Audi: ["Q5","A4","Q7","RS6"],
  Lexus: ["GX 460","LX 570","RX 350","IS 350"],
  Porsche: ["911","Cayenne","Macan","Taycan"],
  Tesla: ["Model S","Model 3","Model X","Model Y"],
  Mazda: ["CX-5","MX-5","CX-9","Mazda3"],
  Kia: ["Telluride","Sorento","Sportage"],
  Volvo: ["XC90","XC60","V60"],
  Acura: ["MDX","RDX","TLX"],
  Infiniti: ["QX80","Q50","QX60"],
  GMC: ["Sierra","Yukon","Acadia"],
  Ram: ["1500","2500","3500"]
};
const TIERS = ["T1","T2","T3"];
const STATUSES = ["New","Contacted","Callback","Interested","Not interested","Wrong number","No answer","Voicemail left","Deal closed","Nurture","Disqualified","Do not call","Marketing"];
const TEMPS = ["No answer","Cold","Warm","Hot","Closed"];
const PRIORITIES = ["Low","Medium","High"];
const AGENTS = ["Carfax1","Carfax2","Mitchell","Saad","Admin","Unassigned"];

function rand(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function randInt(min,max) { return Math.floor(Math.random()*(max-min+1))+min; }
function maybe(p, val, fallback="") { return Math.random() < p ? val : fallback; }

// Seeded RNG so data is stable across reloads
let SEED = 42;
function srand() { SEED = (SEED * 9301 + 49297) % 233280; return SEED / 233280; }
function spick(arr) { return arr[Math.floor(srand()*arr.length)]; }
function sint(min,max) { return Math.floor(srand()*(max-min+1))+min; }
function smaybe(p) { return srand() < p; }

function makePhone() {
  return `(${sint(200,989)}) ${sint(200,989)}-${String(sint(0,9999)).padStart(4,"0")}`;
}
function makeVin() {
  const chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let v = "";
  for (let i=0;i<17;i++) v += chars[Math.floor(srand()*chars.length)];
  return v;
}
function makeEmail(first, city) {
  const domains = ["gmail.com","yahoo.com","outlook.com","icloud.com","protonmail.com","parkerpoe.com","bermenhome.com","wdb-law.com"];
  return `${first.toLowerCase()}${sint(10,9999)}@${spick(domains)}`;
}

const VEHICLES = [
  { id: "v1", make: "Toyota", model: "Land Cruiser", year: 2006, leads: 36, files: 1, name: "Land Cruiser" },
  { id: "v2", make: "Chevrolet", model: "Silverado", year: 2018, leads: 12, files: 2, name: "chevy" },
  { id: "v3", make: "Toyota", model: "Land Cruiser", year: 2008, leads: 24, files: 1, name: "landcruiser" },
  { id: "v4", make: "Porsche", model: "911", year: 2015, leads: 8, files: 1, name: "porsche" },
  { id: "v5", make: "Ford", model: "Bronco", year: 1992, leads: 19, files: 1, name: "bronco" },
  { id: "v6", make: "Jeep", model: "Wrangler", year: 2010, leads: 14, files: 1, name: "wrangler" },
  { id: "v7", make: "Lexus", model: "GX 460", year: 2014, leads: 6, files: 1, name: "gx460" },
];

function makeLeads(n=84) {
  const leads = [];
  for (let i=0;i<n;i++) {
    const first = spick(FIRST_NAMES);
    const city = spick(CITIES);
    const tier = spick(TIERS);
    const temp = spick(TEMPS);
    const status = spick(STATUSES);
    const priority = spick(PRIORITIES);
    const agent = smaybe(0.55) ? spick(AGENTS.slice(0,5)) : "Unassigned";
    const vehicle = spick(VEHICLES);
    const wanted = smaybe(0.4) ? sint(8,45)*1000 : null;
    const offered = smaybe(0.35) ? sint(6,40)*1000 : null;
    const labels = [];
    if (smaybe(0.18)) labels.push("Hot");
    if (smaybe(0.14)) labels.push("Follow-up");
    if (smaybe(0.10)) labels.push("Owner-financed");
    leads.push({
      id: `L-${1000+i}`,
      name: `${first} ${city}`,
      vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      vehicleId: vehicle.id,
      vin: makeVin(),
      phone: makePhone(),
      email: makeEmail(first, city),
      tier, status, priority, temp, agent,
      labels,
      wanted, offered,
      location: smaybe(0.5) ? `${city}, ${spick(["TX","CA","FL","CO","WA","OR","UT","AZ","NV","TN"])}` : "",
      sourceFile: `LandCruiser_2006_VIN_v${sint(1,3)}.csv`,
      batch: `LandCruiser_2006_${sint(1,4)}`,
      imported: `2026-04-${String(sint(1,28)).padStart(2,"0")}`,
      lastTouch: smaybe(0.7) ? `${sint(1,30)}d ago` : "—",
      tasks: sint(0,3),
      notes: sint(0,8),
    });
  }
  return leads;
}

const LEADS = makeLeads(84);

const USERS = [
  { id: "u1", name: "Saad", email: "saad@gmail.com", phone: "+923438397671", role: "tlo", created: "2026-04-09" },
  { id: "u2", name: "Mitchell Briggs", email: "mitch@autocave.com", phone: "+14692163057", role: "admin", created: "2026-04-09" },
  { id: "u3", name: "Carfax2", email: "carfax2@gmail.com", phone: "+923241748920", role: "carfax", created: "2026-04-09" },
  { id: "u4", name: "Carfax1", email: "carfax1@gmail.com", phone: "+923298841654", role: "carfax", created: "2026-04-09" },
  { id: "u5", name: "Admin", email: "admin@vin.com", phone: "+923213531295", role: "admin", created: "2026-04-09" },
  { id: "u6", name: "Jordan Reyes", email: "jordan@vin.com", phone: "+15125553092", role: "tlo", created: "2026-04-12" },
  { id: "u7", name: "Amelia Park", email: "amelia@vin.com", phone: "+13105551883", role: "agent", created: "2026-04-15" },
];

const FILES = [
  { id: "f1", name: "LandCruiser_2006_VIN_v3 (1)", vehicle: "landcruiser", year: "—", status: "Complete", pipeline: [1,1,1,1], updated: "2026-04-18", flagged: false, owner: "Admin" },
  { id: "f2", name: "Bronco_1992_VIN_v2", vehicle: "bronco", year: "1992", status: "Processing", pipeline: [1,1,1,0], updated: "2026-04-22", flagged: false, owner: "Carfax1" },
  { id: "f3", name: "Wrangler_2010_VIN_v1", vehicle: "wrangler", year: "2010", status: "Complete", pipeline: [1,1,1,1], updated: "2026-04-20", flagged: false, owner: "Carfax2" },
  { id: "f4", name: "GX460_2014_VIN_v1", vehicle: "gx460", year: "2014", status: "Filtering", pipeline: [1,1,0,0], updated: "2026-04-26", flagged: true, owner: "Saad" },
  { id: "f5", name: "Silverado_2018_VIN_v4", vehicle: "chevy", year: "2018", status: "Complete", pipeline: [1,1,1,1], updated: "2026-04-15", flagged: false, owner: "Mitchell" },
  { id: "f6", name: "Porsche_2015_911_VIN_v1", vehicle: "porsche", year: "2015", status: "Carfax", pipeline: [1,0,0,0], updated: "2026-04-27", flagged: false, owner: "Admin" },
  { id: "f7", name: "LandCruiser_2008_VIN_v2", vehicle: "landcruiser", year: "2008", status: "Complete", pipeline: [1,1,1,1], updated: "2026-04-10", flagged: false, owner: "Jordan" },
  { id: "f8", name: "Tacoma_2019_VIN_v1", vehicle: "tacoma", year: "2019", status: "Generated", pipeline: [1,0,0,0], updated: "2026-04-28", flagged: false, owner: "Amelia" },
];

const CAMPAIGNS = [
  { id: "c1", name: "Land Cruiser owners — April outreach", channel: "Email", status: "Active", sent: 1842, opened: 0.42, clicked: 0.071, replies: 38, optOut: 6, created: "2026-04-12" },
  { id: "c2", name: "Hot tier — voicemail drop", channel: "Voicemail", status: "Active", sent: 312, opened: 0, clicked: 0, replies: 22, optOut: 1, created: "2026-04-18" },
  { id: "c3", name: "Bronco enthusiasts SMS", channel: "SMS", status: "Scheduled", sent: 0, opened: 0, clicked: 0, replies: 0, optOut: 0, created: "2026-04-26" },
  { id: "c4", name: "Q1 inactive — re-engage", channel: "Email", status: "Completed", sent: 4210, opened: 0.31, clicked: 0.044, replies: 51, optOut: 18, created: "2026-03-04" },
  { id: "c5", name: "Porsche 911 — sellers list", channel: "Email", status: "Draft", sent: 0, opened: 0, clicked: 0, replies: 0, optOut: 0, created: "2026-04-27" },
];

const TASKS = [
  { id: "t1", title: "Call Bryan Charleston re: Land Cruiser offer", lead: "Bryan Charleston", due: "2026-04-28", status: "open", priority: "High", assignee: "Carfax1" },
  { id: "t2", title: "Send Carfax follow-up to Miles Austin", lead: "Miles Austin", due: "2026-04-28", status: "open", priority: "Medium", assignee: "Carfax1" },
  { id: "t3", title: "Verify VIN on Bronco file", lead: "—", due: "2026-04-27", status: "overdue", priority: "High", assignee: "Saad" },
  { id: "t4", title: "Confirm offer with Becky Vestavia", lead: "Becky Vestavia", due: "2026-04-29", status: "open", priority: "Medium", assignee: "Mitchell" },
  { id: "t5", title: "Re-import LC batch #4 after dedupe", lead: "—", due: "2026-04-30", status: "open", priority: "Low", assignee: "Admin" },
  { id: "t6", title: "Schedule TLO refresh on flagged file", lead: "—", due: "2026-04-26", status: "overdue", priority: "High", assignee: "Saad" },
  { id: "t7", title: "Negotiate price — Herbert Indianapolis", lead: "Herbert Indianapolis", due: "2026-04-28", status: "open", priority: "High", assignee: "Carfax2" },
];

const DEALS = [
  { id: "d1", lead: "Bryan Charleston", vehicle: "2006 Toyota Land Cruiser", stage: "Sold", cost: 8500, sale: 14200, profit: 5700, days: 12, agent: "Carfax1", closed: "2026-04-22" },
  { id: "d2", lead: "Becky Vestavia", vehicle: "2010 Jeep Wrangler", stage: "Sold", cost: 11200, sale: 16800, profit: 5600, days: 18, agent: "Mitchell", closed: "2026-04-19" },
  { id: "d3", lead: "Owen Sausalito", vehicle: "2014 Lexus GX 460", stage: "Acquired", cost: 22000, sale: 0, profit: 0, days: 4, agent: "Saad", closed: "—" },
  { id: "d4", lead: "Roman Telluride", vehicle: "1992 Ford Bronco", stage: "Open", cost: 0, sale: 0, profit: 0, days: 2, agent: "Carfax2", closed: "—" },
  { id: "d5", lead: "Iris Marfa", vehicle: "2015 Porsche 911", stage: "Sold", cost: 78000, sale: 91500, profit: 13500, days: 22, agent: "Mitchell", closed: "2026-04-08" },
  { id: "d6", lead: "Caleb Bend", vehicle: "2018 Chevrolet Silverado", stage: "Acquired", cost: 19500, sale: 0, profit: 0, days: 7, agent: "Admin", closed: "—" },
];

const DUPLICATE_GROUPS = [
  { id: "g1", matchType: "VIN + Phone", confidence: 0.98, members: 3, key: "JTEHT05J5...8943", status: "Pending", primary: "—", preparedBy: "—" },
  { id: "g2", matchType: "Email", confidence: 0.92, members: 2, key: "kharam67@gmail.com", status: "Confirmed", primary: "Miles Austin", preparedBy: "Carfax1" },
  { id: "g3", matchType: "Name + Address", confidence: 0.78, members: 4, key: "Charleston, B.", status: "Pending", primary: "—", preparedBy: "—" },
  { id: "g4", matchType: "VIN", confidence: 1.00, members: 2, key: "1FTYR10D...7B14", status: "Confirmed", primary: "Roman Telluride", preparedBy: "Saad" },
  { id: "g5", matchType: "Phone", confidence: 0.88, members: 3, key: "(843) 693-1716", status: "Ignored", primary: "—", preparedBy: "Mitchell" },
];

const FILTER_RULES = [
  { id: "fr1", name: "Skip duplicates by VIN", scope: "All imports", priority: 1, active: true, hits: 1284 },
  { id: "fr2", name: "Drop wrong-number phones", scope: "Carfax stage", priority: 2, active: true, hits: 412 },
  { id: "fr3", name: "Tier 1 if owner ≥ 5y", scope: "Filter stage", priority: 3, active: true, hits: 207 },
  { id: "fr4", name: "Flag salvage titles", scope: "All imports", priority: 4, active: true, hits: 38 },
  { id: "fr5", name: "Mark commercial fleets", scope: "Filter stage", priority: 5, active: false, hits: 0 },
];

const SLA_RULES = [
  { id: "s1", name: "Hot lead — first call", target: "15 min", scope: "temp = Hot", breachAction: "Notify manager", breaches7d: 2 },
  { id: "s2", name: "New lead — first touch", target: "4 hours", scope: "status = New", breachAction: "Reassign", breaches7d: 8 },
  { id: "s3", name: "Callback request", target: "24 hours", scope: "status = Callback", breachAction: "Escalate", breaches7d: 1 },
  { id: "s4", name: "Carfax pull", target: "30 min", scope: "stage = Carfax", breachAction: "Auto-retry", breaches7d: 4 },
];

const NOTIFICATIONS = [
  { id: "n1", type: "lead", title: "New hot lead assigned to you", body: "Bryan Charleston · 2006 Land Cruiser", time: "2m" },
  { id: "n2", type: "task", title: "Task overdue", body: "Verify VIN on Bronco file", time: "1h" },
  { id: "n3", type: "deal", title: "Deal closed — $5,700 profit", body: "Becky Vestavia · 2010 Jeep Wrangler", time: "3h" },
  { id: "n4", type: "system", title: "TLO refresh complete", body: "GX460_2014_VIN_v1 · 6 leads enriched", time: "5h" },
  { id: "n5", type: "lead", title: "12 new leads imported", body: "Tacoma_2019_VIN_v1.csv", time: "1d" },
];

window.VINDATA = { LEADS, VEHICLES, USERS, FILES, CAMPAIGNS, TASKS, DEALS, DUPLICATE_GROUPS, FILTER_RULES, SLA_RULES, NOTIFICATIONS, STATUSES, TEMPS, PRIORITIES, TIERS, AGENTS, MAKES };
