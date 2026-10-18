// Fixed physical strips. Index is the middle visible row; increasing indices run top to bottom.
// Do not shuffle at runtime. Changes require a new model version and RTP verification.
export const MODEL_VERSION = 'kemet-20-v1';
export const REEL_CODES = Object.freeze([
  Object.freeze(["L3","L1","H1","L4","L2","H2","L1","H3","H4","W","H4","L1","H3","L4","W","L4","H3","L3","L4","H3"]),
  Object.freeze(["H3","H1","H4","L1","H2","H4","L4","H2","H4","H3","H4","L1","L4","L3","L4","L3","L2","L3","L4","W"]),
  Object.freeze(["H3","H1","L4","L3","H2","H1","H4","H3","W","H1","L1","L3","H1","L3","H1","L2","H1","L4","L1","W"]),
  Object.freeze(["H4","H3","H4","H1","L3","L1","L2","L1","L3","H3","H1","L4","H2","L2","H1","L1","H3","H1","W","H1"]),
  Object.freeze(["H2","L3","H3","H4","H2","H4","H3","H2","L2","H3","H4","L1","H2","H4","W","H2","H1","H3","W","H2","L1","W","L3","H4","L4"]),
]);
