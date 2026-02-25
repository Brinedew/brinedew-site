const DISCORD_RECAP_IMAGE_PREFIX = "discord-recap-images/"

export function isValidIsoDay(value) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

export function buildDiscordRecapImageKey(day) {
  return `${DISCORD_RECAP_IMAGE_PREFIX}${day}.png`
}
