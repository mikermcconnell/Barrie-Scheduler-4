/**
 * Peer agencies the weekly Peer Agency Watch researches, and the Barrie context the editor
 * uses to judge relevance. Edit this list to add or drop an agency; no other file changes.
 *
 * `start` pages are where the researcher begins (news, council, service changes). `news` are
 * local outlets that cover the agency. Both are hints, not limits: the researcher may search
 * the open web. Leave out outlets whose sites refuse search crawlers (the 2026-11-22 sample run found
 * guelphmercury.com, thewhig.com, intelligencer.ca and saultstar.com refused); they only waste searches.
 */

export interface PeerAgency {
  id: string;
  name: string;
  /** Who runs it and where, as one phrase. */
  area: string;
  group: 'benchmark' | 'similar' | 'neighbour' | 'large' | 'industry';
  start: string[];
  news: string[];
}

export const PEER_AGENCIES: PeerAgency[] = [
  // Barrie's benchmark peers
  { id: 'guelph', name: 'Guelph Transit', area: 'City of Guelph', group: 'benchmark',
    start: ['https://guelph.ca/living/getting-around/bus/', 'https://guelph.ca/news/'],
    news: ['guelphtoday.com'] },
  { id: 'kingston', name: 'Kingston Transit', area: 'City of Kingston', group: 'benchmark',
    start: ['https://www.cityofkingston.ca/residents/transit', 'https://www.cityofkingston.ca/news'],
    news: ['kingstonist.com', 'yourkingston.ca'] },
  { id: 'thunder-bay', name: 'Thunder Bay Transit', area: 'City of Thunder Bay', group: 'benchmark',
    start: ['https://www.thunderbay.ca/en/city-services/transit.aspx', 'https://www.thunderbay.ca/en/news/'],
    news: ['tbnewswatch.com', 'yourthunderbay.ca', 'netnewsledger.com'] },

  // Similar-size Ontario systems
  { id: 'peterborough', name: 'Peterborough Transit', area: 'City of Peterborough', group: 'similar',
    start: ['https://www.peterborough.ca/en/city-services/transit.aspx'],
    news: ['kawarthanow.com', 'ptbocanada.com', 'peterboroughexaminer.com'] },
  { id: 'sudbury', name: 'GOVA Transit', area: 'City of Greater Sudbury', group: 'similar',
    start: ['https://www.greatersudbury.ca/live/transit/', 'https://www.greatersudbury.ca/city-hall/news-and-public-notices/'],
    news: ['sudbury.com', 'ctvnews.ca/northern-ontario'] },
  { id: 'belleville', name: 'Belleville Transit', area: 'City of Belleville', group: 'similar',
    start: ['https://www.belleville.ca/en/getting-around/transit.aspx'],
    news: ['quintenewsnow.com', 'inquinte.ca'] },
  { id: 'sault', name: 'Sault Ste. Marie Transit', area: 'City of Sault Ste. Marie', group: 'similar',
    start: ['https://saultstemarie.ca/City-Hall/City-Departments/Community-Development-Enterprise-Services/Transit-and-Parking.aspx'],
    news: ['sootoday.com'] },

  // Neighbours
  { id: 'orillia', name: 'Orillia Transit', area: 'City of Orillia', group: 'neighbour',
    start: ['https://www.orillia.ca/en/living-here/transit.aspx'],
    news: ['orilliamatters.com'] },
  { id: 'innisfil', name: 'Innisfil Transit', area: 'Town of Innisfil (on-demand)', group: 'neighbour',
    start: ['https://innisfil.ca/en/living-here/innisfil-transit.aspx'],
    news: ['innisfiltoday.ca', 'bradfordtoday.ca'] },
  { id: 'linx', name: 'LINX Transit', area: 'County of Simcoe', group: 'neighbour',
    start: ['https://www.simcoe.ca/linx'],
    news: ['simcoe.com', 'barrietoday.com', 'collingwoodtoday.ca'] },
  { id: 'yrt', name: 'York Region Transit', area: 'York Region', group: 'neighbour',
    start: ['https://www.yrt.ca/en/news/', 'https://www.york.ca/newsroom'],
    news: ['yorkregion.com', 'newmarkettoday.ca'] },
  { id: 'metrolinx', name: 'Metrolinx (GO Transit, Barrie line)', area: 'Province of Ontario', group: 'neighbour',
    start: ['https://www.metrolinx.com/en/news', 'https://www.metrolinx.com/en/projects-and-programs/barrie-line-expansion'],
    news: ['barrietoday.com', 'urbantoronto.ca'] },

  // Larger systems setting trends
  { id: 'grt', name: 'Grand River Transit', area: 'Region of Waterloo', group: 'large',
    start: ['https://www.grt.ca/en/news/', 'https://www.regionofwaterloo.ca/en/regional-government/news.aspx'],
    news: ['therecord.com', 'cambridgetoday.ca', 'kitchenertoday.com'] },
  { id: 'london', name: 'London Transit Commission', area: 'City of London', group: 'large',
    start: ['https://www.londontransit.ca/news/'],
    news: ['lfpress.com', 'londonon.ctvnews.ca', 'cbc.ca/news/canada/london'] },
  { id: 'durham', name: 'Durham Region Transit', area: 'Region of Durham', group: 'large',
    start: ['https://www.durhamregiontransit.com/en/news/'],
    news: ['durhamregion.com', 'oshawaexpress.ca'] },

  // Industry and funding
  { id: 'cuta', name: 'Canadian Urban Transit Association (CUTA)', area: 'National industry association', group: 'industry',
    start: ['https://cutaactu.ca/news/'],
    news: ['masstransitmag.com'] },
  { id: 'opta', name: 'Ontario Public Transit Association (OPTA)', area: 'Provincial industry association', group: 'industry',
    start: ['https://www.ontariopublictransit.ca/'],
    news: [] },
  { id: 'funding', name: 'Provincial and federal transit funding', area: 'Ontario Ministry of Transportation; Housing, Infrastructure and Communities Canada (Canada Public Transit Fund, gas tax)', group: 'industry',
    start: ['https://news.ontario.ca/en', 'https://housing-infrastructure.canada.ca/plan/cptf-fcctc/index-eng.html'],
    news: [] },
];

/**
 * What the editor knows about Barrie when it judges relevance. Public facts only: this text is
 * sent to the Anthropic API. Override it per run with `barrieContext` in the settings document.
 */
export const DEFAULT_BARRIE_CONTEXT = `Barrie Transit is the City of Barrie's transit service (Ontario, population about 160,000), in the Transit & Parking division of Access Barrie. Daily operations are contracted to MVT Canadian Bus. It runs conventional fixed routes, Specialized Transit (door-to-door paratransit) and Transit ON Demand (cutaway vans in select areas). Hubs: Allandale Waterfront GO / terminal and Downtown. It connects with the GO Transit Barrie line and County of Simcoe LINX. Benchmark peers: Guelph, Kingston, Thunder Bay.

Current work the readers care about:
- A transit strategic plan (consultant procurement and scope)
- Performance reporting and dashboards (on-time performance, ridership, cost per trip, service hours)
- Employer pass and discount fare programs
- Point-of-sale and fare technology at the terminal
- On-demand and specialized transit service design
- Route and schedule changes, the downtown and Allandale hubs
- Funding: provincial gas tax, the Canada Public Transit Fund, council budgets`;
