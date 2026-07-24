// Product limits shared by the browser shelf, the merge client, and the
// authenticated Worker endpoint. Keep retention and write amplification
// separate: the reader may remember the entire catalog locally, while one
// server merge remains deliberately small.
export const WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES = 19_023
export const WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE = 200
