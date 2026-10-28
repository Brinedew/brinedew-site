// Product limits shared by the private pre-login discovery buffer, the merge
// client, and the authenticated Worker endpoint. With the add-on's finds, this
// buffer is a signed-out reader's "Your discoveries" gallery until login.
export const WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES = 19_023
export const WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE = 200
