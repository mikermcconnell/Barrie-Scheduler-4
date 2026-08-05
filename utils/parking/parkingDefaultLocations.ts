import type { ParkingRevenueLocationMapping } from './parkingTypes';
import { applyDefaultParkingLocationCategories } from './parkingCategories';
import { mergeParkingRevenueLocationMappings } from './parkingLocationMappings';

export const DEFAULT_PARKING_LATLONG_SEED_VERSION = 'parking-latlong-2026-07-02';

export const DEFAULT_PARKING_REVENUE_LOCATIONS = [
  {
    "id": "hotspot-3100",
    "displayName": "Bayfield & Simcoe Street Lot",
    "latitude": 44.388018,
    "longitude": -79.689664,
    "capacitySpaces": 81,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3100",
        "label": "Bayfield & Simcoe Street Lot"
      },
      {
        "source": "qr",
        "sourceId": "3100",
        "label": "Bayfield & Simcoe Street Lot"
      }
    ]
  },
  {
    "id": "hotspot-1625",
    "displayName": "Bayfield Street On Street Parking",
    "latitude": 44.391182,
    "longitude": -79.691707,
    "capacitySpaces": 5,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1625",
        "label": "Bayfield Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1625",
        "label": "Bayfield Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3505",
    "displayName": "Bayfield Street On Street Parking",
    "latitude": 44.388622,
    "longitude": -79.689691,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3505",
        "label": "Bayfield Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3505",
        "label": "Bayfield Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1605",
    "displayName": "Bayfield Street On Street Parking",
    "latitude": 44.388728,
    "longitude": -79.689622,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1605",
        "label": "Bayfield Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1605",
        "label": "Bayfield Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1615",
    "displayName": "Bayfield Street On Street Parking",
    "latitude": 44.389873,
    "longitude": -79.690589,
    "capacitySpaces": 21,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1615",
        "label": "Bayfield Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1615",
        "label": "Bayfield Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3515",
    "displayName": "Bayfield Street On Street Parking",
    "latitude": 44.390167,
    "longitude": -79.691001,
    "capacitySpaces": 16,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3515",
        "label": "Bayfield Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3515",
        "label": "Bayfield Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-4100",
    "displayName": "Bradford St Parking Lot",
    "latitude": 44.386509,
    "longitude": -79.693703,
    "capacitySpaces": 15,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "4100",
        "label": "Bradford St Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "4100",
        "label": "Bradford St Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-7300",
    "displayName": "Centennial Beach Lot",
    "latitude": 44.381614,
    "longitude": -79.690385,
    "capacitySpaces": 95,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7300",
        "label": "Centennial Beach Lot"
      },
      {
        "source": "qr",
        "sourceId": "7300",
        "label": "Centennial Beach Lot"
      }
    ]
  },
  {
    "id": "hotspot-7200",
    "displayName": "Centennial Boat Launch",
    "latitude": 44.382456,
    "longitude": -79.689987,
    "capacitySpaces": 18,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7200",
        "label": "Centennial Boat Launch"
      },
      {
        "source": "qr",
        "sourceId": "7200",
        "label": "Centennial Boat Launch"
      }
    ]
  },
  {
    "id": "hotspot-1110",
    "displayName": "Chase McEachern Way Parking Lot",
    "latitude": 44.388452,
    "longitude": -79.688504,
    "capacitySpaces": 68,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1110",
        "label": "Chase McEachern Way Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1110",
        "label": "Chase McEachern Way Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1440",
    "displayName": "City Hall Parking Lot",
    "latitude": 44.391344,
    "longitude": -79.686186,
    "capacitySpaces": 57,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1440",
        "label": "City Hall Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1440",
        "label": "City Hall Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1730",
    "displayName": "Clapperton St Parking Lot",
    "latitude": 44.390698,
    "longitude": -79.690449,
    "capacitySpaces": 30,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1730",
        "label": "Clapperton St Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1730",
        "label": "Clapperton St Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1715",
    "displayName": "Clapperton Street On Street Parking",
    "latitude": 44.389814,
    "longitude": -79.690119,
    "capacitySpaces": 17,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1715",
        "label": "Clapperton Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1715",
        "label": "Clapperton Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1705",
    "displayName": "Clapperton Street On Street Parking",
    "latitude": 44.389841,
    "longitude": -79.689984,
    "capacitySpaces": 11,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1705",
        "label": "Clapperton Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1705",
        "label": "Clapperton Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1725",
    "displayName": "Clapperton Street On Street Parking",
    "latitude": 44.390883,
    "longitude": -79.690042,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1725",
        "label": "Clapperton Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1725",
        "label": "Clapperton Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1745",
    "displayName": "Clapperton Street On Street Parking",
    "latitude": 44.392101,
    "longitude": -79.69002,
    "capacitySpaces": 10,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1745",
        "label": "Clapperton Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1745",
        "label": "Clapperton Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1755",
    "displayName": "Clapperton Street On Street Parking",
    "latitude": 44.392094,
    "longitude": -79.690157,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1755",
        "label": "Clapperton Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1755",
        "label": "Clapperton Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1395",
    "displayName": "Collier On Street Parking",
    "latitude": 44.390615,
    "longitude": -79.682005,
    "capacitySpaces": 8,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1395",
        "label": "Collier On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1395",
        "label": "Collier On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1385",
    "displayName": "Collier On Street Parking",
    "latitude": 44.390466,
    "longitude": -79.682167,
    "capacitySpaces": 12,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1385",
        "label": "Collier On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1385",
        "label": "Collier On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1355",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390519,
    "longitude": -79.68698,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1355",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1355",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1315",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390448,
    "longitude": -79.690746,
    "capacitySpaces": 3,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1315",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1315",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1305",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390294,
    "longitude": -79.690634,
    "capacitySpaces": 8,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1305",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1305",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1365",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390405,
    "longitude": -79.684231,
    "capacitySpaces": 11,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1365",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1365",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1330",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390478,
    "longitude": -79.688964,
    "capacitySpaces": 15,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1330",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1330",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1320",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390335,
    "longitude": -79.688905,
    "capacitySpaces": 20,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1320",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1320",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1375",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.39056,
    "longitude": -79.683946,
    "capacitySpaces": 27,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1375",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1375",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1345",
    "displayName": "Collier Street On Street Parking",
    "latitude": 44.390349,
    "longitude": -79.686595,
    "capacitySpaces": 15,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1345",
        "label": "Collier Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1345",
        "label": "Collier Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1322",
    "displayName": "Collier Street Parkade",
    "latitude": 44.390066,
    "longitude": -79.688843,
    "capacitySpaces": 303,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1322",
        "label": "Collier Street Parkade"
      },
      {
        "source": "qr",
        "sourceId": "1322",
        "label": "Collier Street Parkade"
      }
    ]
  },
  {
    "id": "hotspot-1560",
    "displayName": "Courthouse Parking Lot",
    "latitude": 44.392706,
    "longitude": -79.684326,
    "capacitySpaces": 81,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1560",
        "label": "Courthouse Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1560",
        "label": "Courthouse Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-9105",
    "displayName": "Cumberland St Parking",
    "latitude": 44.372721,
    "longitude": -79.690234,
    "capacitySpaces": 13,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "9105",
        "label": "Cumberland St Parking"
      },
      {
        "source": "qr",
        "sourceId": "9105",
        "label": "Cumberland St Parking"
      }
    ]
  },
  {
    "id": "hotspot-1210",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389319,
    "longitude": -79.68903,
    "capacitySpaces": 19,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1210",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1210",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1275",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389442,
    "longitude": -79.682012,
    "capacitySpaces": 16,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1275",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1275",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1200",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389221,
    "longitude": -79.689038,
    "capacitySpaces": 13,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1200",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1200",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1230",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389361,
    "longitude": -79.686585,
    "capacitySpaces": 15,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1230",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1230",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1240",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389305,
    "longitude": -79.684017,
    "capacitySpaces": 11,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1240",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1240",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1250",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389411,
    "longitude": -79.683841,
    "capacitySpaces": 11,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1250",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1250",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1220",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389273,
    "longitude": -79.686245,
    "capacitySpaces": 12,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1220",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1220",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1265",
    "displayName": "Dunlop Street E On Street Parking",
    "latitude": 44.389343,
    "longitude": -79.681791,
    "capacitySpaces": 14,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1265",
        "label": "Dunlop Street E On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1265",
        "label": "Dunlop Street E On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3200",
    "displayName": "Dunlop Street W On Street Parking",
    "latitude": 44.388958,
    "longitude": -79.690784,
    "capacitySpaces": 5,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3200",
        "label": "Dunlop Street W On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3200",
        "label": "Dunlop Street W On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3230",
    "displayName": "Dunlop Street W On Street Parking",
    "latitude": 44.388576,
    "longitude": -79.691915,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3230",
        "label": "Dunlop Street W On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3230",
        "label": "Dunlop Street W On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3220",
    "displayName": "Dunlop Street W On Street Parking",
    "latitude": 44.388512,
    "longitude": -79.691793,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3220",
        "label": "Dunlop Street W On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3220",
        "label": "Dunlop Street W On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3240",
    "displayName": "Dunlop Street W On Street Parking",
    "latitude": 44.388152,
    "longitude": -79.692622,
    "capacitySpaces": 4,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3240",
        "label": "Dunlop Street W On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3240",
        "label": "Dunlop Street W On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3250",
    "displayName": "Dunlop Street W On Street Parking",
    "latitude": 44.38824,
    "longitude": -79.692677,
    "capacitySpaces": 3,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3250",
        "label": "Dunlop Street W On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3250",
        "label": "Dunlop Street W On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3210",
    "displayName": "Dunlop Street W On Street Parking",
    "latitude": 44.389052,
    "longitude": -79.690829,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3210",
        "label": "Dunlop Street W On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3210",
        "label": "Dunlop Street W On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-7325",
    "displayName": "Ellen St Parking - West Side of St",
    "latitude": 44.380057,
    "longitude": -79.692139,
    "capacitySpaces": 17,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7325",
        "label": "Ellen St Parking - West Side of St"
      },
      {
        "source": "qr",
        "sourceId": "7325",
        "label": "Ellen St Parking - West Side of St"
      }
    ]
  },
  {
    "id": "hotspot-1100",
    "displayName": "Five Points Lot",
    "latitude": 44.388653,
    "longitude": -79.689304,
    "capacitySpaces": 34,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1100",
        "label": "Five Points Lot"
      },
      {
        "source": "qr",
        "sourceId": "1100",
        "label": "Five Points Lot"
      }
    ]
  },
  {
    "id": "hotspot-8105",
    "displayName": "Gallie Court",
    "latitude": 44.414864,
    "longitude": -79.659191,
    "capacitySpaces": 25,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "8105",
        "label": "Gallie Court"
      },
      {
        "source": "qr",
        "sourceId": "8105",
        "label": "Gallie Court"
      }
    ]
  },
  {
    "id": "hotspot-8115",
    "displayName": "Gallie Court",
    "latitude": 44.416016,
    "longitude": -79.658974,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "8115",
        "label": "Gallie Court"
      },
      {
        "source": "qr",
        "sourceId": "8115",
        "label": "Gallie Court"
      }
    ]
  },
  {
    "id": "hotspot-7700",
    "displayName": "General John Hayter Southshore Community Centre Parking Lot",
    "latitude": 44.373844,
    "longitude": -79.680994,
    "capacitySpaces": 111,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7700",
        "label": "General John Hayter Southshore Community Centre Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "7700",
        "label": "General John Hayter Southshore Community Centre Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1430",
    "displayName": "H-Block Parking Lot",
    "latitude": 44.392072,
    "longitude": -79.689572,
    "capacitySpaces": 174,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1430",
        "label": "H-Block Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1430",
        "label": "H-Block Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1130",
    "displayName": "Heritage Park Lot",
    "latitude": 44.388491,
    "longitude": -79.685793,
    "capacitySpaces": 90,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1130",
        "label": "Heritage Park Lot"
      },
      {
        "source": "qr",
        "sourceId": "1130",
        "label": "Heritage Park Lot"
      }
    ]
  },
  {
    "id": "hotspot-3905",
    "displayName": "High Street On Street Parking",
    "latitude": 44.387746,
    "longitude": -79.694717,
    "capacitySpaces": 5,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3905",
        "label": "High Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3905",
        "label": "High Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3915",
    "displayName": "High Street On Street Parking",
    "latitude": 44.388126,
    "longitude": -79.69519,
    "capacitySpaces": 17,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3915",
        "label": "High Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3915",
        "label": "High Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-7355",
    "displayName": "John St Parking",
    "latitude": 44.379715,
    "longitude": -79.69284,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7355",
        "label": "John St Parking"
      },
      {
        "source": "qr",
        "sourceId": "7355",
        "label": "John St Parking"
      }
    ]
  },
  {
    "id": "hotspot-7100",
    "displayName": "Johnson's Beach Parking Lot",
    "latitude": 44.393966,
    "longitude": -79.657561,
    "capacitySpaces": 61,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7100",
        "label": "Johnson's Beach Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "7100",
        "label": "Johnson's Beach Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-7405",
    "displayName": "Lakeshore Dr East - Centennial Beach",
    "latitude": 44.379496,
    "longitude": -79.690308,
    "capacitySpaces": 26,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7405",
        "label": "Lakeshore Dr East - Centennial Beach"
      },
      {
        "source": "qr",
        "sourceId": "7405",
        "label": "Lakeshore Dr East - Centennial Beach"
      }
    ]
  },
  {
    "id": "hotspot-7425",
    "displayName": "Lakeshore Dr North - Southshore Park",
    "latitude": 44.373602,
    "longitude": -79.681107,
    "capacitySpaces": 70,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7425",
        "label": "Lakeshore Dr North - Southshore Park"
      },
      {
        "source": "qr",
        "sourceId": "7425",
        "label": "Lakeshore Dr North - Southshore Park"
      }
    ]
  },
  {
    "id": "hotspot-7415",
    "displayName": "Lakeshore Dr West - Centennial Beach",
    "latitude": 44.378758,
    "longitude": -79.690242,
    "capacitySpaces": 51,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7415",
        "label": "Lakeshore Dr West - Centennial Beach"
      },
      {
        "source": "qr",
        "sourceId": "7415",
        "label": "Lakeshore Dr West - Centennial Beach"
      }
    ]
  },
  {
    "id": "hotspot-1120",
    "displayName": "Lakeshore Mews Parking Lot",
    "latitude": 44.388795,
    "longitude": -79.68646,
    "capacitySpaces": 32,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1120",
        "label": "Lakeshore Mews Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1120",
        "label": "Lakeshore Mews Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1520",
    "displayName": "Library Parking Lot",
    "latitude": 44.392379,
    "longitude": -79.688457,
    "capacitySpaces": 64,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1520",
        "label": "Library Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "1520",
        "label": "Library Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-3740",
    "displayName": "Maple Avenue Central Lot",
    "latitude": 44.389637,
    "longitude": -79.692401,
    "capacitySpaces": 32,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3740",
        "label": "Maple Avenue Central Lot"
      },
      {
        "source": "qr",
        "sourceId": "3740",
        "label": "Maple Avenue Central Lot"
      }
    ]
  },
  {
    "id": "hotspot-3750",
    "displayName": "Maple Avenue North Lot",
    "latitude": 44.390308,
    "longitude": -79.692943,
    "capacitySpaces": 44,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3750",
        "label": "Maple Avenue North Lot"
      },
      {
        "source": "qr",
        "sourceId": "3750",
        "label": "Maple Avenue North Lot"
      }
    ]
  },
  {
    "id": "hotspot-3625",
    "displayName": "Maple Avenue On Street Parking",
    "latitude": 44.389568,
    "longitude": -79.691828,
    "capacitySpaces": 11,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3625",
        "label": "Maple Avenue On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3625",
        "label": "Maple Avenue On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3605",
    "displayName": "Maple Avenue On Street Parking",
    "latitude": 44.388545,
    "longitude": -79.690941,
    "capacitySpaces": 3,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3605",
        "label": "Maple Avenue On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3605",
        "label": "Maple Avenue On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3730",
    "displayName": "Maple Avenue South Lot",
    "latitude": 44.389295,
    "longitude": -79.692099,
    "capacitySpaces": 26,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3730",
        "label": "Maple Avenue South Lot"
      },
      {
        "source": "qr",
        "sourceId": "3730",
        "label": "Maple Avenue South Lot"
      }
    ]
  },
  {
    "id": "hotspot-5300",
    "displayName": "Marina North Parking Lot",
    "latitude": 44.386416,
    "longitude": -79.68996,
    "capacitySpaces": 45,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "5300",
        "label": "Marina North Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "5300",
        "label": "Marina North Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-5000",
    "displayName": "Marina Parking Lot",
    "latitude": 44.384574,
    "longitude": -79.69069,
    "capacitySpaces": 130,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "5000",
        "label": "Marina Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "5000",
        "label": "Marina Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-3715",
    "displayName": "Mary Street On Street Parking",
    "latitude": 44.3876,
    "longitude": -79.691702,
    "capacitySpaces": 6,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3715",
        "label": "Mary Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3715",
        "label": "Mary Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3725",
    "displayName": "Mary Street On Street Parking",
    "latitude": 44.389408,
    "longitude": -79.693201,
    "capacitySpaces": 21,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3725",
        "label": "Mary Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3725",
        "label": "Mary Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3700",
    "displayName": "Mary Street Parking Lot",
    "latitude": 44.387437,
    "longitude": -79.691975,
    "capacitySpaces": 26,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3700",
        "label": "Mary Street Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "3700",
        "label": "Mary Street Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1525",
    "displayName": "McDonald Street On Street Parking",
    "latitude": 44.392582,
    "longitude": -79.689033,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1525",
        "label": "McDonald Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1525",
        "label": "McDonald Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1555",
    "displayName": "McDonald Street On Street Parking",
    "latitude": 44.392692,
    "longitude": -79.686423,
    "capacitySpaces": 13,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1555",
        "label": "McDonald Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1555",
        "label": "McDonald Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-7800",
    "displayName": "Minet's Point Parking Lot",
    "latitude": 44.376006,
    "longitude": -79.667584,
    "capacitySpaces": 60,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7800",
        "label": "Minet's Point Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "7800",
        "label": "Minet's Point Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-1925",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.391316,
    "longitude": -79.685448,
    "capacitySpaces": 4,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1925",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1925",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1965",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.39297,
    "longitude": -79.685668,
    "capacitySpaces": 2,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1965",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1965",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1945",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.392162,
    "longitude": -79.685618,
    "capacitySpaces": 4,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1945",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1945",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1910",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.389743,
    "longitude": -79.685564,
    "capacitySpaces": 17,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1910",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1910",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1900",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.389872,
    "longitude": -79.685347,
    "capacitySpaces": 22,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1900",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1900",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1930",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.392121,
    "longitude": -79.685449,
    "capacitySpaces": 23,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1930",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1930",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1950",
    "displayName": "Mulcaster Street On Street Parking",
    "latitude": 44.393045,
    "longitude": -79.685485,
    "capacitySpaces": 12,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1950",
        "label": "Mulcaster Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1950",
        "label": "Mulcaster Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1805",
    "displayName": "Owen Street On Street Parking",
    "latitude": 44.389778,
    "longitude": -79.687744,
    "capacitySpaces": 13,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1805",
        "label": "Owen Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1805",
        "label": "Owen Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1825",
    "displayName": "Owen Street On Street Parking",
    "latitude": 44.39091,
    "longitude": -79.687809,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1825",
        "label": "Owen Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1825",
        "label": "Owen Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1835",
    "displayName": "Owen Street On Street Parking",
    "latitude": 44.391201,
    "longitude": -79.68794,
    "capacitySpaces": 5,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1835",
        "label": "Owen Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1835",
        "label": "Owen Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1815",
    "displayName": "Owen Street On Street Parking",
    "latitude": 44.389837,
    "longitude": -79.687883,
    "capacitySpaces": 10,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1815",
        "label": "Owen Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1815",
        "label": "Owen Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1845",
    "displayName": "Owen Street On Street Parking",
    "latitude": 44.392136,
    "longitude": -79.687829,
    "capacitySpaces": 6,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1845",
        "label": "Owen Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1845",
        "label": "Owen Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3305",
    "displayName": "Park Street On Street Parking",
    "latitude": 44.388584,
    "longitude": -79.696308,
    "capacitySpaces": 8,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3305",
        "label": "Park Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3305",
        "label": "Park Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-3315",
    "displayName": "Park Street On Street Parking",
    "latitude": 44.388528,
    "longitude": -79.696207,
    "capacitySpaces": 7,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3315",
        "label": "Park Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3315",
        "label": "Park Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-4040",
    "displayName": "Parkside Drive On Street Parking",
    "latitude": 44.389548,
    "longitude": -79.697687,
    "capacitySpaces": 59,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "4040",
        "label": "Parkside Drive On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "4040",
        "label": "Parkside Drive On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-2015",
    "displayName": "Poyntz Street On Street Parking",
    "latitude": 44.389925,
    "longitude": -79.6832,
    "capacitySpaces": 26,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "2015",
        "label": "Poyntz Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "2015",
        "label": "Poyntz Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-8205",
    "displayName": "Quarry Ridge",
    "latitude": 44.415401,
    "longitude": -79.657055,
    "capacitySpaces": 10,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "8205",
        "label": "Quarry Ridge"
      },
      {
        "source": "qr",
        "sourceId": "8205",
        "label": "Quarry Ridge"
      }
    ]
  },
  {
    "id": "hotspot-3400",
    "displayName": "Ross Street On Street Parking",
    "latitude": 44.390755,
    "longitude": -79.697112,
    "capacitySpaces": 10,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3400",
        "label": "Ross Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3400",
        "label": "Ross Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-5200",
    "displayName": "Simcoe Street Lot",
    "latitude": 44.386563,
    "longitude": -79.690476,
    "capacitySpaces": 25,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "5200",
        "label": "Simcoe Street Lot"
      },
      {
        "source": "qr",
        "sourceId": "5200",
        "label": "Simcoe Street Lot"
      }
    ]
  },
  {
    "id": "hotspot-5100",
    "displayName": "Spirit Catcher Parking Lot",
    "latitude": 44.3869,
    "longitude": -79.689648,
    "capacitySpaces": 74,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "5100",
        "label": "Spirit Catcher Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "5100",
        "label": "Spirit Catcher Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-7600",
    "displayName": "Tiffin St Boat Launch",
    "latitude": 44.375591,
    "longitude": -79.688078,
    "capacitySpaces": 31,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7600",
        "label": "Tiffin St Boat Launch"
      },
      {
        "source": "qr",
        "sourceId": "7600",
        "label": "Tiffin St Boat Launch"
      }
    ]
  },
  {
    "id": "hotspot-3850",
    "displayName": "Toronto Street On Street Parking",
    "latitude": 44.389947,
    "longitude": -79.695282,
    "capacitySpaces": 18,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "3850",
        "label": "Toronto Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "3850",
        "label": "Toronto Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-7900",
    "displayName": "Tyndale Park Parking Lot",
    "latitude": 44.374185,
    "longitude": -79.644977,
    "capacitySpaces": 33,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7900",
        "label": "Tyndale Park Parking Lot"
      },
      {
        "source": "qr",
        "sourceId": "7900",
        "label": "Tyndale Park Parking Lot"
      }
    ]
  },
  {
    "id": "hotspot-7500",
    "displayName": "Will Dwyer Park Lot",
    "latitude": 44.377588,
    "longitude": -79.689392,
    "capacitySpaces": 179,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "7500",
        "label": "Will Dwyer Park Lot"
      },
      {
        "source": "qr",
        "sourceId": "7500",
        "label": "Will Dwyer Park Lot"
      }
    ]
  },
  {
    "id": "hotspot-1435",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.391577,
    "longitude": -79.688888,
    "capacitySpaces": 13,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1435",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1435",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1415",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.391537,
    "longitude": -79.691159,
    "capacitySpaces": 8,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1415",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1415",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1405",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.39144,
    "longitude": -79.69105,
    "capacitySpaces": 10,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1405",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1405",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1425",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.39148,
    "longitude": -79.688825,
    "capacitySpaces": 9,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1425",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1425",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1445",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.391515,
    "longitude": -79.686594,
    "capacitySpaces": 15,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1445",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1445",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1455",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.391611,
    "longitude": -79.686518,
    "capacitySpaces": 12,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1455",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1455",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-1460",
    "displayName": "Worsley Street On Street Parking",
    "latitude": 44.391563,
    "longitude": -79.684389,
    "capacitySpaces": 11,
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "1460",
        "label": "Worsley Street On Street Parking"
      },
      {
        "source": "qr",
        "sourceId": "1460",
        "label": "Worsley Street On Street Parking"
      }
    ]
  },
  {
    "id": "hotspot-9000",
    "displayName": "Special Events",
    "locationKind": "non_spatial",
    "latitude": null as number | null,
    "longitude": null as number | null,
    "capacitySpaces": null as number | null,
    "categoryId": "special-events",
    "sourceRefs": [
      {
        "source": "hotspot",
        "sourceId": "9000",
        "label": "Special Events"
      }
    ]
  }
] satisfies ParkingRevenueLocationMapping[];

function locationSourceKeys(location: ParkingRevenueLocationMapping): Set<string> {
  return new Set((location.sourceRefs || []).map(ref => `${ref.source}:${String(ref.sourceId).trim().toUpperCase()}`));
}

export function mergeDefaultParkingRevenueLocations(
  locations: ParkingRevenueLocationMapping[] = [],
): ParkingRevenueLocationMapping[] {
  return applyDefaultParkingLocationCategories(
    mergeParkingRevenueLocationMappings(locations, DEFAULT_PARKING_REVENUE_LOCATIONS, { overwriteExisting: false }),
  );
}

export function countMissingDefaultParkingRevenueLocations(
  locations: ParkingRevenueLocationMapping[] = [],
): number {
  const existingKeys = new Set(locations.flatMap(location => [...locationSourceKeys(location)]));
  return DEFAULT_PARKING_REVENUE_LOCATIONS.filter(location => (
    ![...locationSourceKeys(location)].some(key => existingKeys.has(key))
  )).length;
}
