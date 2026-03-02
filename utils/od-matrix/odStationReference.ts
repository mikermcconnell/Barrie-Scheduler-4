/**
 * OD Station Reference Lookup
 *
 * Static lookup table of 306 Ontario Northland stops with precise coordinates.
 * Checked before Nominatim geocoding to avoid rate-limited API calls.
 * Source: "Stops with Geo-coordinates Feb 19 2026" CSV (authoritative).
 */

import type { GeocodedLocation } from './odMatrixTypes';

interface StationReference {
    stationId: number;
    name: string;
    province: string;
    lat: number;
    lon: number;
}

const STATION_DATA: StationReference[] = [
    { stationId: 457, name: 'AGAWA BAY', province: 'ON', lat: 47.331462, lon: -84.613299 },
    { stationId: 133, name: 'ALBAN', province: 'ON', lat: 46.10427, lon: -80.610499 },
    { stationId: 221, name: 'ALLANDALE GO STATION', province: 'ON', lat: 44.37385, lon: -79.68965 },
    { stationId: 436, name: 'ARCHIBALD RD', province: 'ON', lat: 46.317636, lon: -83.865064 },
    { stationId: 236, name: 'ARDTREA northbound', province: 'ON', lat: 44.679072, lon: -79.406371 },
    { stationId: 150, name: 'ARDTREA southbound', province: 'ON', lat: 44.686187, lon: -79.403222 },
    { stationId: 110, name: 'ARNPRIOR', province: 'ON', lat: 45.422733, lon: -76.368779 },
    { stationId: 542, name: 'ATIKOKAN', province: 'ON', lat: 48.753629, lon: -91.603901 },
    { stationId: 442, name: 'AUNDECK OMNI KANING', province: 'ON', lat: 45.961022, lon: -81.989411 },
    { stationId: 128, name: 'AZILDA', province: 'ON', lat: 46.551673, lon: -81.111308 },
    { stationId: 435, name: 'BARR RD', province: 'ON', lat: 46.338057, lon: -84.045044 },
    { stationId: 209, name: 'BARRIE', province: 'ON', lat: 44.388078, lon: -79.690971 },
    { stationId: 315, name: 'BARRIE ALLANDALE TERMINAL', province: 'ON', lat: 44.374099, lon: -79.690194 },
    { stationId: 166, name: 'BASS LAKE RD', province: 'ON', lat: 47.380902, lon: -79.731584 },
    { stationId: 420, name: 'BATCHAWANA BAY', province: 'ON', lat: 46.92686, lon: -84.42389 },
    { stationId: 465, name: 'BEARDMORE', province: 'ON', lat: 49.59306, lon: -87.94102 },
    { stationId: 434, name: 'BIG PERCH BAY RD', province: 'ON', lat: 46.288579, lon: -83.704712 },
    { stationId: 134, name: 'BIGWOOD', province: 'ON', lat: 46.03168, lon: -80.596522 },
    { stationId: 440, name: 'BIRCH ISLAND', province: 'ON', lat: 46.068339, lon: -81.772869 },
    { stationId: 403, name: 'BLIND RIVER', province: 'ON', lat: 46.185146, lon: -82.928996 },
    { stationId: 401, name: 'BLIND RIVER HOSPITAL', province: 'ON', lat: 46.187426, lon: -82.923583 },
    { stationId: 207, name: 'BRACEBRIDGE', province: 'ON', lat: 45.030707, lon: -79.313337 },
    { stationId: 480, name: 'BRACEBRIDGE - TRAIN DEPOT', province: 'ON', lat: 45.043102, lon: -79.310202 },
    { stationId: 235, name: 'BRACEBRIDGE REST STOP', province: 'ON', lat: 45.04373, lon: -79.322578 },
    { stationId: 433, name: 'BRANIFF RD', province: 'ON', lat: 46.287497, lon: -83.683706 },
    { stationId: 137, name: 'BRITT', province: 'ON', lat: 45.803096, lon: -80.53763 },
    { stationId: 603, name: 'BROWNRIGG', province: 'ON', lat: 49.681497, lon: -81.522305 },
    { stationId: 413, name: 'BRUCE MINES', province: 'ON', lat: 46.30042, lon: -83.79357 },
    { stationId: 156, name: 'BURK\'S FALLS', province: 'ON', lat: 45.623655, lon: -79.410127 },
    { stationId: 178, name: 'BUTLER LAKE', province: 'ON', lat: 48.342858, lon: -80.253077 },
    { stationId: 138, name: 'BYNG INLET', province: 'ON', lat: 45.770579, lon: -80.497424 },
    { stationId: 124, name: 'CARTIER', province: 'ON', lat: 46.700765, lon: -81.555914 },
    { stationId: 313, name: 'CASINO RAMA', province: 'ON', lat: 44.647996, lon: -79.349963 },
    { stationId: 105, name: 'CHALK RIVER eastbound', province: 'ON', lat: 46.019614, lon: -77.450261 },
    { stationId: 239, name: 'CHALK RIVER westbound', province: 'ON', lat: 46.019002, lon: -77.44955 },
    { stationId: 127, name: 'CHELMSFORD', province: 'ON', lat: 46.568962, lon: -81.200551 },
    { stationId: 550, name: 'CHEO HOSPITAL', province: 'ON', lat: 45.39966, lon: -75.65115 },
    { stationId: 472, name: 'CLEARWATER BAY', province: 'ON', lat: 49.71576, lon: -94.79548 },
    { stationId: 600, name: 'CLUTE', province: 'ON', lat: 49.188226, lon: -81.010151 },
    { stationId: 167, name: 'COBALT', province: 'ON', lat: 47.392927, lon: -79.686912 },
    { stationId: 483, name: 'COBALT-TRAIN DEPOT', province: 'ON', lat: 47.396176, lon: -79.684291 },
    { stationId: 108, name: 'COBDEN', province: 'ON', lat: 45.628947, lon: -76.879994 },
    { stationId: 192, name: 'COCHRANE', province: 'ON', lat: 49.060269, lon: -81.023339 },
    { stationId: 147, name: 'COLDWATER', province: 'ON', lat: 44.70786, lon: -79.643037 },
    { stationId: 515, name: 'CONFEDERATION COLLEGE', province: 'ON', lat: 48.402959, lon: -89.26966 },
    { stationId: 606, name: 'CORAL', province: 'ON', lat: 50.217951, lon: -81.683113 },
    { stationId: 541, name: 'COUCHICHING F.N.', province: 'ON', lat: 48.633116, lon: -93.36175 },
    { stationId: 173, name: 'DANE', province: 'ON', lat: 48.073012, lon: -80.035009 },
    { stationId: 104, name: 'DEEP RIVER', province: 'ON', lat: 46.103038, lon: -77.506242 },
    { stationId: 431, name: 'DESBARATS', province: 'ON', lat: 46.345873, lon: -83.92292 },
    { stationId: 427, name: 'DEUX RIVI\u00c8RES', province: 'ON', lat: 46.251993, lon: -78.286513 },
    { stationId: 539, name: 'DEVLIN', province: 'ON', lat: 48.621178, lon: -93.673294 },
    { stationId: 505, name: 'DORION', province: 'ON', lat: 48.832803, lon: -88.52534 },
    { stationId: 126, name: 'DOWLING', province: 'ON', lat: 46.586209, lon: -81.334613 },
    { stationId: 193, name: 'DRIFTWOOD', province: 'ON', lat: 49.121109, lon: -81.382218 },
    { stationId: 523, name: 'DRYDEN', province: 'ON', lat: 49.789325, lon: -92.828141 },
    { stationId: 561, name: 'DRYDEN REST STOP', province: 'ON', lat: 49.786833, lon: -92.832167 },
    { stationId: 555, name: 'DRYDEN REST STOP OLD', province: 'ON', lat: 49.785646, lon: -92.81689 },
    { stationId: 432, name: 'DUMOND RD', province: 'ON', lat: 46.282617, lon: -83.412115 },
    { stationId: 463, name: 'EAR FALLS', province: 'ON', lat: 50.63696, lon: -93.23054 },
    { stationId: 171, name: 'EARLTON', province: 'ON', lat: 47.711004, lon: -79.823446 },
    { stationId: 225, name: 'EAST GWILLIMBURY GO STATION', province: 'ON', lat: 44.07848, lon: -79.45655 },
    { stationId: 414, name: 'ECHO BAY', province: 'ON', lat: 46.48445, lon: -84.07021 },
    { stationId: 161, name: 'EDU CENTRE LOWER RES', province: 'ON', lat: 46.334234, lon: -79.488205 },
    { stationId: 119, name: 'EDUCATION CENTRE MAIN CAMPUS', province: 'ON', lat: 46.34392, lon: -79.49151 },
    { stationId: 232, name: 'ELM/PARIS', province: 'ON', lat: 46.49299, lon: -80.99059 },
    { stationId: 538, name: 'EMO', province: 'ON', lat: 48.633226, lon: -93.8304 },
    { stationId: 314, name: 'EMSDALE', province: 'ON', lat: 45.512179, lon: -79.303403 },
    { stationId: 155, name: 'EMSDALE OLD', province: 'ON', lat: 45.528169, lon: -79.32083 },
    { stationId: 172, name: 'ENGLEHART', province: 'ON', lat: 47.818775, lon: -79.866415 },
    { stationId: 218, name: 'ENGLEHART HOSPITAL', province: 'ON', lat: 47.823478, lon: -79.879238 },
    { stationId: 485, name: 'ENGLEHART STATION', province: 'ON', lat: 47.826567, lon: -79.873063 },
    { stationId: 405, name: 'ESPANOLA', province: 'ON', lat: 46.261208, lon: -81.769427 },
    { stationId: 473, name: 'ESPANOLA REST', province: 'ON', lat: 46.248531, lon: -81.761912 },
    { stationId: 131, name: 'ESTAIRE', province: 'ON', lat: 46.314673, lon: -80.799045 },
    { stationId: 446, name: 'EVANSVILLE', province: 'ON', lat: 45.821468, lon: -82.554803 },
    { stationId: 470, name: 'FALCON LAKE', province: 'MB', lat: 49.68565, lon: -95.32657 },
    { stationId: 196, name: 'FAUQUIER', province: 'ON', lat: 49.311564, lon: -82.033712 },
    { stationId: 437, name: 'FISHER RD', province: 'ON', lat: 46.315005, lon: -83.853179 },
    { stationId: 540, name: 'FORT FRANCES', province: 'ON', lat: 48.610282, lon: -93.38655 },
    { stationId: 545, name: 'FORT FRANCES REST STOP', province: 'ON', lat: 48.60692, lon: -93.424256 },
    { stationId: 547, name: 'FORT FRANCES.', province: 'ON', lat: 48.61355, lon: -93.40424 },
    { stationId: 604, name: 'FRASERDALE', province: 'ON', lat: 49.846906, lon: -81.617969 },
    { stationId: 611, name: 'GALETON', province: 'ON', lat: 51.133284, lon: -80.913724 },
    { stationId: 415, name: 'GARDEN RIVER', province: 'ON', lat: 46.54559, lon: -84.1629 },
    { stationId: 612, name: 'GARDINER', province: 'ON', lat: 49.307536, lon: -81.027914 },
    { stationId: 300, name: 'GEORGIAN COLLEGE', province: 'ON', lat: 44.581192, lon: -79.429608 },
    { stationId: 466, name: 'GERALDTON', province: 'ON', lat: 49.74984, lon: -86.981 },
    { stationId: 121, name: 'GOGAMA', province: 'ON', lat: 47.675405, lon: -81.724844 },
    { stationId: 118, name: 'GORDON BAY', province: 'ON', lat: 45.21072, lon: -79.792188 },
    { stationId: 445, name: 'GORE BAY', province: 'ON', lat: 45.896685, lon: -82.454805 },
    { stationId: 477, name: 'GORMLEY - TRAIN STATION', province: 'ON', lat: 43.940907, lon: -79.398523 },
    { stationId: 421, name: 'GOULAIS RIVER', province: 'ON', lat: 46.73365, lon: -84.34932 },
    { stationId: 208, name: 'GRAVENHURST', province: 'ON', lat: 44.917349, lon: -79.372233 },
    { stationId: 479, name: 'GRAVENHURST - TRAIN STATION', province: 'ON', lat: 44.920247, lon: -79.370568 },
    { stationId: 234, name: 'GRAVENHURST REST STOP', province: 'ON', lat: 44.88663, lon: -79.34885 },
    { stationId: 400, name: 'HAGAR', province: 'ON', lat: 46.45526, lon: -80.416 },
    { stationId: 168, name: 'HAILEYBURY', province: 'ON', lat: 47.442052, lon: -79.637523 },
    { stationId: 123, name: 'HALFWAY LAKE RD', province: 'ON', lat: 46.908316, lon: -81.632296 },
    { stationId: 200, name: 'HARTY', province: 'ON', lat: 49.474717, lon: -82.681657 },
    { stationId: 458, name: 'HAWKESBURY', province: 'ON', lat: 45.63676, lon: -74.62339 },
    { stationId: 532, name: 'HEALTH SCIENCES CENTRE', province: 'MB', lat: 49.904401, lon: -97.156065 },
    { stationId: 402, name: 'HEALTH SCIENCES NORTH', province: 'ON', lat: 46.467178, lon: -80.995902 },
    { stationId: 204, name: 'HEARST', province: 'ON', lat: 49.690562, lon: -83.671051 },
    { stationId: 419, name: 'HEYDEN', province: 'ON', lat: 46.64236, lon: -84.30685 },
    { stationId: 470, name: 'HORNEPAYNE', province: 'ON', lat: 49.212385, lon: -84.768158 },
    { stationId: 142, name: 'HORSESHOE LAKE RD', province: 'ON', lat: 45.289825, lon: -79.850962 },
    { stationId: 184, name: 'HOYLE', province: 'ON', lat: 48.548913, lon: -81.057798 },
    { stationId: 206, name: 'HUNTSVILLE', province: 'ON', lat: 45.323578, lon: -79.225697 },
    { stationId: 481, name: 'HUNTSVILLE - TRAIN STATION', province: 'ON', lat: 45.323505, lon: -79.226434 },
    { stationId: 430, name: 'HURON SHORES', province: 'ON', lat: 46.274945, lon: -83.435381 },
    { stationId: 182, name: 'HWY 101 - MUNICIPAL RD', province: 'ON', lat: 48.545258, lon: -80.890792 },
    { stationId: 472, name: 'HWY 11 and 631', province: 'ON', lat: 49.763145, lon: -84.511809 },
    { stationId: 522, name: 'HWY 622-17', province: 'ON', lat: 49.506671, lon: -92.056849 },
    { stationId: 116, name: 'HWY 67 - HWY 11', province: 'ON', lat: 48.699559, lon: -80.790208 },
    { stationId: 521, name: 'IGNACE', province: 'ON', lat: 49.416731, lon: -91.663682 },
    { stationId: 546, name: 'IGNACE PARCEL STOP', province: 'ON', lat: 49.412676, lon: -91.64303 },
    { stationId: 411, name: 'IRON BRIDGE', province: 'ON', lat: 46.27879, lon: -83.22001 },
    { stationId: 190, name: 'IROQUOIS FALLS', province: 'ON', lat: 48.76572, lon: -80.68062 },
    { stationId: 602, name: 'ISLAND FALLS', province: 'ON', lat: 49.568887, lon: -81.42279 },
    { stationId: 468, name: 'JELLICOE', province: 'ON', lat: 49.6843, lon: -87.53258 },
    { stationId: 444, name: 'KAGAWONG', province: 'ON', lat: 45.899832, lon: -82.255868 },
    { stationId: 152, name: 'KAHSHE LAKE RD', province: 'ON', lat: 44.845016, lon: -79.316968 },
    { stationId: 544, name: 'KAKABEKA FALLS', province: 'ON', lat: 48.401606, lon: -89.615232 },
    { stationId: 474, name: 'KANATA', province: 'ON', lat: 45.309762, lon: -75.906202 },
    { stationId: 198, name: 'KAPUSKASING', province: 'ON', lat: 49.415685, lon: -82.420641 },
    { stationId: 227, name: 'KEEWATIN', province: 'ON', lat: 49.757413, lon: -94.557305 },
    { stationId: 176, name: 'KENOGAMI northbound', province: 'ON', lat: 48.100175, lon: -80.195609 },
    { stationId: 238, name: 'KENOGAMI southbound', province: 'ON', lat: 48.099758, lon: -80.195215 },
    { stationId: 525, name: 'KENORA', province: 'ON', lat: 49.75956, lon: -94.46897 },
    { stationId: 226, name: 'KENORA AIRPORT', province: 'ON', lat: 49.790563, lon: -94.365088 },
    { stationId: 228, name: 'KENORA RIVER DRIVE AT HWY 17', province: 'ON', lat: 49.759887, lon: -94.46647 },
    { stationId: 136, name: 'KEY RIVER', province: 'ON', lat: 45.894568, lon: -80.566324 },
    { stationId: 229, name: 'KING CITY GO STATION', province: 'ON', lat: 43.920493, lon: -79.526015 },
    { stationId: 230, name: 'KINGSWAY', province: 'ON', lat: 46.495265, lon: -80.887699 },
    { stationId: 174, name: 'KIRKLAND LAKE', province: 'ON', lat: 48.147776, lon: -80.04523 },
    { stationId: 548, name: 'LAKE WOODS HOSPITAL', province: 'ON', lat: 49.767397, lon: -94.500512 },
    { stationId: 509, name: 'LAKEHEAD UNIVERSITY', province: 'ON', lat: 48.422384, lon: -89.260898 },
    { stationId: 224, name: 'LAKEHEAD UNIVERSITY ORILLIA', province: 'ON', lat: 44.59214, lon: -79.45941 },
    { stationId: 310, name: 'LAKESHORE DR', province: 'ON', lat: 46.264054, lon: -79.392542 },
    { stationId: 557, name: 'LANDMARK HOTEL', province: 'ON', lat: 48.451784, lon: -89.250924 },
    { stationId: 476, name: 'LANGSTAFF TRAIN DEPOT', province: 'ON', lat: 43.838574, lon: -79.423002 },
    { stationId: 165, name: 'LATCHFORD', province: 'ON', lat: 47.326039, lon: -79.810919 },
    { stationId: 130, name: 'LAURENTIAN UNIVERSITY', province: 'ON', lat: 46.465529, lon: -80.97036 },
    { stationId: 125, name: 'LEVACK', province: 'ON', lat: 46.625082, lon: -81.453777 },
    { stationId: 441, name: 'LITTLE CURRENT', province: 'ON', lat: 45.978692, lon: -81.9186 },
    { stationId: 467, name: 'LONGLAC', province: 'ON', lat: 49.8043, lon: -86.48872 },
    { stationId: 416, name: 'LORETTE', province: 'MB', lat: 49.73991, lon: -96.87411 },
    { stationId: 144, name: 'MACTIER', province: 'ON', lat: 45.118721, lon: -79.757348 },
    { stationId: 512, name: 'MANITOUWADGE', province: 'ON', lat: 49.125856, lon: -85.828806 },
    { stationId: 513, name: 'MANITOUWADGE JCT', province: 'ON', lat: 48.703996, lon: -85.858968 },
    { stationId: 453, name: 'MANITOWANING', province: 'ON', lat: 45.74442, lon: -81.807507 },
    { stationId: 500, name: 'MARATHON', province: 'ON', lat: 48.72075, lon: -86.37342 },
    { stationId: 553, name: 'MARATHON - REST STOP', province: 'ON', lat: 48.726465, lon: -86.376862 },
    { stationId: 163, name: 'MARTEN RIVER', province: 'ON', lat: 46.735333, lon: -79.803654 },
    { stationId: 407, name: 'MASSEY', province: 'ON', lat: 46.212689, lon: -82.075823 },
    { stationId: 180, name: 'MATHESON', province: 'ON', lat: 48.536381, lon: -80.465781 },
    { stationId: 487, name: 'MATHESON - TRAIN STATION', province: 'ON', lat: 48.534169, lon: -80.465595 },
    { stationId: 302, name: 'MATTAGAMI FIRST NATION', province: 'ON', lat: 47.799, lon: -81.522308 },
    { stationId: 120, name: 'MATTAGAMI FIRST NATION RD', province: 'ON', lat: 47.78169, lon: -81.580632 },
    { stationId: 103, name: 'MATTAWA', province: 'ON', lat: 46.316381, lon: -78.702492 },
    { stationId: 202, name: 'MATTICE', province: 'ON', lat: 49.612807, lon: -83.263165 },
    { stationId: 443, name: 'M\'CHIGEENG', province: 'ON', lat: 45.827596, lon: -82.160874 },
    { stationId: 449, name: 'MINDEMOYA', province: 'ON', lat: 45.732465, lon: -82.162168 },
    { stationId: 460, name: 'MINE CENTRE', province: 'ON', lat: 48.76345, lon: -92.6348 },
    { stationId: 197, name: 'MOONBEAM', province: 'ON', lat: 49.344823, lon: -82.159878 },
    { stationId: 609, name: 'MOOSE RIVER', province: 'ON', lat: 50.813386, lon: -81.292106 },
    { stationId: 115, name: 'MOOSONEE', province: 'ON', lat: 51.27527, lon: -80.647373 },
    { stationId: 471, name: 'NAGAGAMISIS PROVINCIAL PARK', province: 'ON', lat: 49.453879, lon: -84.704491 },
    { stationId: 404, name: 'NAIRN CENTRE', province: 'ON', lat: 46.32948, lon: -81.58856 },
    { stationId: 191, name: 'NELLIE LAKE', province: 'ON', lat: 48.768893, lon: -80.801227 },
    { stationId: 537, name: 'NESTOR FALLS', province: 'ON', lat: 49.114438, lon: -93.926411 },
    { stationId: 169, name: 'NEW LISKEARD', province: 'ON', lat: 47.506557, lon: -79.667331 },
    { stationId: 114, name: 'NEW LISKEARD - DYMOND', province: 'ON', lat: 47.52843, lon: -79.675283 },
    { stationId: 117, name: 'NIGHTHAWK', province: 'ON', lat: 48.550008, lon: -80.986989 },
    { stationId: 504, name: 'NIPIGON', province: 'ON', lat: 49.013895, lon: -88.263718 },
    { stationId: 554, name: 'NIPIGON - REST STOP', province: 'ON', lat: 49.021254, lon: -88.288781 },
    { stationId: 205, name: 'NORTH BAY', province: 'ON', lat: 46.313775, lon: -79.43816 },
    { stationId: 312, name: 'NORTH BAY BUS GARAGE', province: 'ON', lat: 46.318426, lon: -79.424535 },
    { stationId: 212, name: 'NORTH BAY EDC', province: 'ON', lat: 46.343948, lon: -79.491528 },
    { stationId: 215, name: 'NORTH BAY HEALTH CTR', province: 'ON', lat: 46.335546, lon: -79.497411 },
    { stationId: 186, name: 'NORTHERN COLLEGE', province: 'ON', lat: 48.487871, lon: -81.200476 },
    { stationId: 154, name: 'NOVAR', province: 'ON', lat: 45.451118, lon: -79.247835 },
    { stationId: 608, name: 'ONAKAWANA', province: 'ON', lat: 50.596346, lon: -81.429788 },
    { stationId: 201, name: 'OPASATIKA', province: 'ON', lat: 49.526985, lon: -82.865617 },
    { stationId: 149, name: 'ORILLIA', province: 'ON', lat: 44.596961, lon: -79.409994 },
    { stationId: 301, name: 'ORILLIA TRANSIT', province: 'ON', lat: 44.608925, lon: -79.420321 },
    { stationId: 113, name: 'OTTAWA', province: 'ON', lat: 45.40893, lon: -75.694745 },
    { stationId: 551, name: 'OTTAWA - VIA RAIL', province: 'ON', lat: 45.4167, lon: -75.65198 },
    { stationId: 112, name: 'OTTAWA BAYSHORE MALL', province: 'ON', lat: 45.345728, lon: -75.809819 },
    { stationId: 549, name: 'OTTAWA HOSPITAL', province: 'ON', lat: 45.39997, lon: -75.64737 },
    { stationId: 605, name: 'OTTER RAPIDS', province: 'ON', lat: 50.215344, lon: -81.675924 },
    { stationId: 199, name: 'PARIS ST.', province: 'ON', lat: 46.493086, lon: -80.990657 },
    { stationId: 141, name: 'PARRY SOUND', province: 'ON', lat: 45.343456, lon: -80.010127 },
    { stationId: 506, name: 'PASS LAKE CORNERS', province: 'ON', lat: 48.603523, lon: -88.782162 },
    { stationId: 143, name: 'PASSENGER REVENUE - NORTH BAY', province: 'ON', lat: 46.313775, lon: -79.43816 },
    { stationId: 503, name: 'PAYS PLAT', province: 'ON', lat: 48.88217, lon: -87.556322 },
    { stationId: 107, name: 'PEMBROKE', province: 'ON', lat: 45.826163, lon: -77.116359 },
    { stationId: 106, name: 'PETAWAWA', province: 'ON', lat: 45.901821, lon: -77.284713 },
    { stationId: 475, name: 'PIC MOBERT FIRST NATION', province: 'ON', lat: 48.700699, lon: -85.536827 },
    { stationId: 135, name: 'PICKEREL RIVER RD', province: 'ON', lat: 45.973958, lon: -80.574739 },
    { stationId: 424, name: 'POINT ALEXANDER', province: 'ON', lat: 46.134727, lon: -77.554327 },
    { stationId: 139, name: 'POINTE AU BARIL', province: 'ON', lat: 45.596451, lon: -80.374063 },
    { stationId: 189, name: 'PORQUIS JCT', province: 'ON', lat: 48.711, lon: -80.783074 },
    { stationId: 145, name: 'PORT SEVERN', province: 'ON', lat: 44.808121, lon: -79.73494 },
    { stationId: 153, name: 'PORT SYDNEY', province: 'ON', lat: 45.218371, lon: -79.306008 },
    { stationId: 160, name: 'POWASSAN', province: 'ON', lat: 46.077034, lon: -79.359653 },
    { stationId: 526, name: 'PRAWDA', province: 'MB', lat: 49.649238, lon: -95.793027 },
    { stationId: 535, name: 'PROVINCE OF MANITOBA', province: 'ON', lat: 49.739306, lon: -95.153135 },
    { stationId: 534, name: 'PROVINCE OF ONTARIO', province: 'ON', lat: 49.740095, lon: -95.137544 },
    { stationId: 179, name: 'RAMORE', province: 'ON', lat: 48.433637, lon: -80.327073 },
    { stationId: 607, name: 'RANOKE', province: 'ON', lat: 50.427203, lon: -81.586911 },
    { stationId: 462, name: 'RED LAKE', province: 'ON', lat: 51.01905, lon: -93.8438 },
    { stationId: 511, name: 'RED ROCK', province: 'ON', lat: 48.942887, lon: -88.258694 },
    { stationId: 109, name: 'RENFREW', province: 'ON', lat: 45.469493, lon: -76.668107 },
    { stationId: 610, name: 'RENISON', province: 'ON', lat: 50.968028, lon: -81.127448 },
    { stationId: 231, name: 'REST STOP (PS)', province: 'ON', lat: 45.305566, lon: -79.894116 },
    { stationId: 556, name: 'RICHER', province: 'MB', lat: 49.662083, lon: -96.456537 },
    { stationId: 425, name: 'ROLPHTON', province: 'ON', lat: 46.171579, lon: -77.697334 },
    { stationId: 428, name: 'RUTHERGLEN', province: 'ON', lat: 46.270394, lon: -79.040451 },
    { stationId: 450, name: 'SANDFIELD', province: 'ON', lat: 45.701493, lon: -81.997793 },
    { stationId: 418, name: 'SAULT AREA HOSPITAL', province: 'ON', lat: 46.54894, lon: -84.31209 },
    { stationId: 417, name: 'SAULT COLLEGE', province: 'ON', lat: 46.532568, lon: -84.315283 },
    { stationId: 438, name: 'SAULT COLLEGE (N)', province: 'ON', lat: 46.534197, lon: -84.314286 },
    { stationId: 439, name: 'SAULT COLLEGE (S)', province: 'ON', lat: 46.534037, lon: -84.313329 },
    { stationId: 490, name: 'SAULT STE MARIE', province: 'ON', lat: 46.546081, lon: -84.324177 },
    { stationId: 416, name: 'SAULT STE MARIE OLD', province: 'ON', lat: 46.518849, lon: -84.279906 },
    { stationId: 502, name: 'SCHREIBER', province: 'ON', lat: 48.814334, lon: -87.268634 },
    { stationId: 177, name: 'SESEKINIKA northbound', province: 'ON', lat: 48.166586, lon: -80.249729 },
    { stationId: 237, name: 'SESEKINIKA southbound', province: 'ON', lat: 48.208632, lon: -80.260601 },
    { stationId: 469, name: 'SHABAQUA CORNERS', province: 'ON', lat: 48.60158, lon: -89.89268 },
    { stationId: 140, name: 'SHAWANAGA RD N', province: 'ON', lat: 45.547825, lon: -80.280364 },
    { stationId: 454, name: 'SHEGUIANDAH', province: 'ON', lat: 45.882878, lon: -81.916063 },
    { stationId: 181, name: 'SHILLINGTON', province: 'ON', lat: 48.537791, lon: -80.680711 },
    { stationId: 464, name: 'SIOUX LOOKOUT', province: 'ON', lat: 50.10194, lon: -91.90518 },
    { stationId: 536, name: 'SIOUX NARROWS', province: 'ON', lat: 49.407583, lon: -94.094612 },
    { stationId: 194, name: 'SMOOTH ROCK FALLS', province: 'ON', lat: 49.280229, lon: -81.633338 },
    { stationId: 223, name: 'SOLDIERS MEMORIAL HOSPITAL', province: 'ON', lat: 44.605314, lon: -79.423345 },
    { stationId: 451, name: 'SOUTH BAYMOUTH', province: 'ON', lat: 45.563397, lon: -82.011087 },
    { stationId: 187, name: 'SOUTH PORCUPINE', province: 'ON', lat: 48.485373, lon: -81.21124 },
    { stationId: 158, name: 'SOUTH RIVER', province: 'ON', lat: 45.838877, lon: -79.378443 },
    { stationId: 482, name: 'SOUTH RIVER - TRAIN DEPOT', province: 'ON', lat: 45.841666, lon: -79.375638 },
    { stationId: 528, name: 'SOUTHDALE MALL', province: 'MB', lat: 49.854448, lon: -97.078521 },
    { stationId: 408, name: 'SPANISH', province: 'ON', lat: 46.19594, lon: -82.34556 },
    { stationId: 409, name: 'SPRAGGE', province: 'ON', lat: 46.21175, lon: -82.60182 },
    { stationId: 448, name: 'SPRING BAY', province: 'ON', lat: 45.731758, lon: -82.326118 },
    { stationId: 527, name: 'STE. ANNE', province: 'MB', lat: 49.671275, lon: -96.654506 },
    { stationId: 426, name: 'STONECLIFFE', province: 'ON', lat: 46.213283, lon: -77.896782 },
    { stationId: 195, name: 'STRICKLAND', province: 'ON', lat: 49.28798, lon: -81.867711 },
    { stationId: 102, name: 'STURGEON FALLS', province: 'ON', lat: 46.366568, lon: -79.917066 },
    { stationId: 129, name: 'SUDBURY', province: 'ON', lat: 46.504998, lon: -80.938118 },
    { stationId: 213, name: 'SUDBURY TRANSIT', province: 'ON', lat: 46.492906, lon: -80.991627 },
    { stationId: 157, name: 'SUNDRIDGE', province: 'ON', lat: 45.77043, lon: -79.392231 },
    { stationId: 175, name: 'SWASTIKA', province: 'ON', lat: 48.10785, lon: -80.103971 },
    { stationId: 486, name: 'SWASTIKA DEPOT', province: 'ON', lat: 48.108278, lon: -80.104287 },
    { stationId: 508, name: 'TB HEALTH SCIENCES CTR', province: 'ON', lat: 48.426016, lon: -89.270279 },
    { stationId: 455, name: 'TEHKUMMAH', province: 'ON', lat: 45.655393, lon: -82.014521 },
    { stationId: 164, name: 'TEMAGAMI', province: 'ON', lat: 47.063711, lon: -79.789197 },
    { stationId: 488, name: 'TEMAGAMI STATION', province: 'ON', lat: 47.0638, lon: -79.78893 },
    { stationId: 216, name: 'TEMISKAMING HOSPITAL', province: 'ON', lat: 47.495249, lon: -79.693891 },
    { stationId: 484, name: 'TEMISKAMING SHORES STATION', province: 'ON', lat: 47.510377, lon: -79.687403 },
    { stationId: 501, name: 'TERRACE BAY', province: 'ON', lat: 48.783002, lon: -87.100109 },
    { stationId: 412, name: 'THESSALON', province: 'ON', lat: 46.256643, lon: -83.557427 },
    { stationId: 170, name: 'THORNLOE', province: 'ON', lat: 47.66773, lon: -79.737972 },
    { stationId: 507, name: 'THUNDER BAY', province: 'ON', lat: 48.372586, lon: -89.303263 },
    { stationId: 510, name: 'THUNDER BAY TRANSIT-INTERCITY SHOPPING CENTRE', province: 'ON', lat: 48.40344, lon: -89.243029 },
    { stationId: 514, name: 'THUNDER BAY WEST (600 ARTHUR ST)', province: 'ON', lat: 48.38056, lon: -89.295809 },
    { stationId: 162, name: 'TILDEN LAKE', province: 'ON', lat: 46.582619, lon: -79.637895 },
    { stationId: 533, name: 'TIME ZONE', province: 'ON', lat: 48.90272, lon: -90.027417 },
    { stationId: 543, name: 'TIME ZONE.', province: 'ON', lat: 48.728837, lon: -91.649342 },
    { stationId: 185, name: 'TIMMINS', province: 'ON', lat: 48.474627, lon: -81.326806 },
    { stationId: 217, name: 'TIMMINS HOSPITAL', province: 'ON', lat: 48.487074, lon: -81.314394 },
    { stationId: 211, name: 'TORONTO', province: 'ON', lat: 43.655905, lon: -79.385384 },
    { stationId: 233, name: 'Toronto - Pearson UP Express', province: 'ON', lat: 43.682388, lon: -79.612537 },
    { stationId: 489, name: 'TORONTO - UNION STATION TRAIN', province: 'ON', lat: 43.645521, lon: -79.381031 },
    { stationId: 148, name: 'TORONTO DVP', province: 'ON', lat: 43.763284, lon: -79.337095 },
    { stationId: 159, name: 'TROUT CREEK', province: 'ON', lat: 45.986895, lon: -79.359553 },
    { stationId: 222, name: 'UNION STATION BUS TERMINAL', province: 'ON', lat: 43.643875, lon: -79.377302 },
    { stationId: 531, name: 'UNIVERSITY OF WINNIPEG', province: 'MB', lat: 49.891257, lon: -97.152624 },
    { stationId: 520, name: 'UPSALA', province: 'ON', lat: 49.041418, lon: -90.468471 },
    { stationId: 203, name: 'VAL COT\u00c9', province: 'ON', lat: 49.643236, lon: -83.404584 },
    { stationId: 188, name: 'VAL GAGN\u00c9', province: 'ON', lat: 48.602827, lon: -80.638494 },
    { stationId: 220, name: 'VAL RITA', province: 'ON', lat: 49.443812, lon: -82.540114 },
    { stationId: 219, name: 'VAUGHAN - HWY 407', province: 'ON', lat: 43.783446, lon: -79.523574 },
    { stationId: 524, name: 'VERMILION BAY', province: 'ON', lat: 49.854894, lon: -93.384541 },
    { stationId: 101, name: 'VERNER', province: 'ON', lat: 46.41465, lon: -80.13394 },
    { stationId: 530, name: 'WABIGOON', province: 'ON', lat: 49.720893, lon: -92.603712 },
    { stationId: 410, name: 'WAHNAPITAE', province: 'ON', lat: 46.4877, lon: -80.78991 },
    { stationId: 100, name: 'WARREN', province: 'ON', lat: 46.442031, lon: -80.311163 },
    { stationId: 151, name: 'WASHAGO', province: 'ON', lat: 44.750393, lon: -79.333544 },
    { stationId: 478, name: 'WASHAGO - TRAIN STATION', province: 'ON', lat: 44.748981, lon: -79.334703 },
    { stationId: 311, name: 'WASSI RD', province: 'ON', lat: 46.196966, lon: -79.357291 },
    { stationId: 122, name: 'WATERSHED', province: 'ON', lat: 47.471699, lon: -81.846996 },
    { stationId: 146, name: 'WAUBAUSHENE', province: 'ON', lat: 44.7566, lon: -79.701777 },
    { stationId: 422, name: 'WAWA', province: 'ON', lat: 47.983344, lon: -84.780006 },
    { stationId: 552, name: 'WAWA - REST STOP', province: 'ON', lat: 47.991065, lon: -84.77266 },
    { stationId: 406, name: 'WEBBWOOD', province: 'ON', lat: 46.26982, lon: -81.88612 },
    { stationId: 423, name: 'WHITE RIVER', province: 'ON', lat: 48.593008, lon: -85.2749 },
    { stationId: 456, name: 'WHITEFISH FALLS', province: 'ON', lat: 46.116981, lon: -81.734729 },
    { stationId: 452, name: 'WIIKWEMKOONG', province: 'ON', lat: 45.788649, lon: -81.736934 },
    { stationId: 529, name: 'WINNIPEG', province: 'MB', lat: 49.906621, lon: -97.154173 },
    { stationId: 559, name: 'WINNIPEG-AIRPORT', province: 'MB', lat: 49.905006, lon: -97.223548 },
    { stationId: 558, name: 'WINNIPEG-CHURCH AVE', province: 'MB', lat: 49.941361, lon: -97.190574 },
    { stationId: 560, name: 'WINNIPEG-HOSPITAL', province: 'MB', lat: 49.90361, lon: -97.157101 },
    { stationId: 601, name: 'WURTELE', province: 'ON', lat: 49.40773, lon: -81.059905 },
    { stationId: 210, name: 'YORKDALE', province: 'ON', lat: 43.724947, lon: -79.448807 },
];

// ============ NORMALIZATION ============

function normalizeForLookup(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitCityPlace(name: string): { city: string | null; place: string } {
    const parts = name.split(' - ').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return { city: parts[0], place: parts.slice(1).join(' ') };
    }
    return { city: null, place: name };
}

// ============ BUILD INDEXES ============

const byNormalized = new Map<string, StationReference>();
const byPlacePortion = new Map<string, StationReference>();

for (const entry of STATION_DATA) {
    const normalized = normalizeForLookup(entry.name);
    byNormalized.set(normalized, entry);

    const { city, place } = splitCityPlace(entry.name);
    if (city) {
        const normalizedPlace = normalizeForLookup(place);
        if (normalizedPlace !== normalized) {
            byPlacePortion.set(normalizedPlace, entry);
        }
    } else {
        // Non-city entries are also indexed by their full normalized name
        // so "City - Place" inputs can match against bare place names
        byPlacePortion.set(normalized, entry);
    }
}

// ============ EXTRA STATIONS (not in CSV) ============
// Stations appearing in OD matrices but absent from the authoritative CSV.

const EXTRA_STATIONS: StationReference[] = [
    { stationId: 9001, name: 'ELLIOT LAKE', province: 'ON', lat: 46.3833, lon: -82.6500 },
    { stationId: 9002, name: 'MCMASTER UNIVERSITY', province: 'ON', lat: 43.2609, lon: -79.9192 },
    { stationId: 9003, name: 'ONTARIO TECH UNIVERSITY OSHAWA', province: 'ON', lat: 43.9449, lon: -78.8960 },
    { stationId: 9004, name: 'PEARSON AIRPORT TERMINAL 1', province: 'ON', lat: 43.6777, lon: -79.6248 },
    { stationId: 9005, name: 'KANATA - OC TRANSPO TERRY FOX', province: 'ON', lat: 45.3430, lon: -75.8039 },
];

for (const entry of EXTRA_STATIONS) {
    const normalized = normalizeForLookup(entry.name);
    byNormalized.set(normalized, entry);
    const { city, place } = splitCityPlace(entry.name);
    if (city) {
        byPlacePortion.set(normalizeForLookup(place), entry);
    }
}

// ============ NAME ALIASES ============
// Maps OD matrix Excel names (place portion) to CSV reference names.
// These handle cases where the Excel format differs from the CSV name.

const NAME_ALIASES: [string, string][] = [
    ['Education Centre - Lower Residence', 'EDU CENTRE LOWER RES'],
    ['Timmins and District Hospital', 'TIMMINS HOSPITAL'],
    ['Regional Health Sciences Centre', 'TB HEALTH SCIENCES CTR'],
    ['CHEO', 'CHEO HOSPITAL'],
    ['Hospital - General Campus', 'OTTAWA HOSPITAL'],
    ['River Dr-Hwy 17', 'KENORA RIVER DRIVE AT HWY 17'],
    ['Vaughan - Highway 407 Terminal', 'VAUGHAN - HWY 407'],
    ['Fisher-Archibald Rds', 'FISHER RD'],
    ['Health Centre', 'NORTH BAY HEALTH CTR'],
];

for (const [alias, refName] of NAME_ALIASES) {
    const ref = byNormalized.get(normalizeForLookup(refName));
    if (ref) {
        byNormalized.set(normalizeForLookup(alias), ref);
    }
}

// ============ LOOKUP ============

const DIRECTION_SUFFIXES = [' northbound', ' southbound', ' eastbound', ' westbound', ' old'];

function buildResult(entry: StationReference): GeocodedLocation {
    return {
        lat: entry.lat,
        lon: entry.lon,
        displayName: `${entry.name}, ${entry.province} (reference)`,
        source: 'reference',
        confidence: 'high',
    };
}

function tryMatch(normalized: string): StationReference | undefined {
    return byNormalized.get(normalized) ?? byPlacePortion.get(normalized);
}

export function lookupStationCoordinates(name: string): GeocodedLocation | null {
    const normalized = normalizeForLookup(name);

    // Stage 1: exact match on full normalized name
    const exact = byNormalized.get(normalized);
    if (exact) return buildResult(exact);

    // Stage 2: strip city prefix and match place portion
    const { city, place } = splitCityPlace(name);
    if (city) {
        const normalizedPlace = normalizeForLookup(place);
        const placeMatch = tryMatch(normalizedPlace);
        if (placeMatch) return buildResult(placeMatch);
    }

    // Stage 2b: recombine city+place without separator ("Orillia - Transit" → "orillia transit")
    if (city) {
        const recombined = normalizeForLookup(`${city} ${place}`);
        const recombinedMatch = byNormalized.get(recombined);
        if (recombinedMatch) return buildResult(recombinedMatch);
    }

    // Stage 3: strip direction suffixes and retry both indexes
    for (const suffix of DIRECTION_SUFFIXES) {
        if (normalized.endsWith(suffix)) {
            const stripped = normalized.slice(0, -suffix.length);
            const suffixMatch = tryMatch(stripped);
            if (suffixMatch) return buildResult(suffixMatch);
        }
    }

    // Also try stripping suffix from the place portion
    if (city) {
        const normalizedPlace = normalizeForLookup(place);
        for (const suffix of DIRECTION_SUFFIXES) {
            if (normalizedPlace.endsWith(suffix)) {
                const stripped = normalizedPlace.slice(0, -suffix.length);
                const suffixMatch = tryMatch(stripped);
                if (suffixMatch) return buildResult(suffixMatch);
            }
        }
    }

    return null;
}
