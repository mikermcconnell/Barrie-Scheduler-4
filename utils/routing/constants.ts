// RAPTOR Routing Configuration
// Ported from BTTP src/config/constants.js ROUTING_CONFIG

export const ROUTING_CONFIG = {
  /** Maximum number of transfers allowed in a trip */
  MAX_TRANSFERS: 2,

  /** Maximum walking distance to reach a transit stop from origin (meters) */
  MAX_WALK_TO_TRANSIT: 800,

  /** Maximum walking distance for transfers between stops (meters) */
  MAX_WALK_FOR_TRANSFER: 400,

  /** Walking speed in meters per second (~4.3 km/h) */
  WALK_SPEED: 1.2,

  /** Penalty added to transfer time to prefer fewer transfers (seconds) */
  TRANSFER_PENALTY: 180,

  /** Minimum time needed to make a transfer (seconds) */
  MIN_TRANSFER_TIME: 60,

  /** Buffer factor for straight-line walking estimates (actual paths are longer) */
  WALK_DISTANCE_BUFFER: 1.3,

  /** Maximum actual walking distance after route enrichment (meters) */
  MAX_ACTUAL_WALK_DISTANCE: 1200,

  /** Maximum number of itineraries to return */
  MAX_ITINERARIES: 5,

  /** Time window to search for trips after departure time (seconds) */
  TIME_WINDOW: 7200,

  /** Maximum trip duration (seconds) */
  MAX_TRIP_DURATION: 7200,

  /** Maximum time until departure to show (seconds) */
  MAX_WAIT_TIME: 3600,

  /** Walk time multiplier for boarding stop selection */
  WALK_TIME_MULTIPLIER: 2.0,
} as const;
