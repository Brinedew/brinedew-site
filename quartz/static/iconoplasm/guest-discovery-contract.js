// Product limits shared by the private pre-login discovery buffer, the merge
// client, and the authenticated Worker endpoint. This buffer is not the visible
// guest archive: that UI is always the fixed three-card starter preview.
export const WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES = 19_023
export const WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE = 200
