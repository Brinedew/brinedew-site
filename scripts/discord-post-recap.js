#!/usr/bin/env node
/**
 * Discord Daily Recap Posting Script
 *
 * Reads recap data from recap-data.json and screenshot from screenshot.png,
 * then posts to Discord using the bot token.
 *
 * Required environment variables:
 * - DISCORD_BOT_TOKEN: Bot token for authentication
 * - DISCORD_CHANNEL_ID: Channel to post to
 *
 * Outputs:
 * - message_id: The ID of the posted message (for GitHub Actions)
 */

import fs from "node:fs"
import path from "node:path"
import https from "node:https"

const DISCORD_API = "https://discord.com/api/v10"

async function main() {
  const botToken = process.env.DISCORD_BOT_TOKEN
  const channelId = process.env.DISCORD_CHANNEL_ID

  if (!botToken) {
    console.error("Error: DISCORD_BOT_TOKEN not set")
    process.exit(1)
  }

  if (!channelId) {
    console.error("Error: DISCORD_CHANNEL_ID not set")
    process.exit(1)
  }

  // Read recap data
  const recapPath = path.join(process.cwd(), "recap-data.json")
  if (!fs.existsSync(recapPath)) {
    console.error("Error: recap-data.json not found")
    process.exit(1)
  }

  const recap = JSON.parse(fs.readFileSync(recapPath, "utf8"))
  console.log("Recap data:", JSON.stringify(recap, null, 2))

  // Read screenshot
  const screenshotPath = path.join(process.cwd(), "screenshot.png")
  if (!fs.existsSync(screenshotPath)) {
    console.error("Error: screenshot.png not found")
    process.exit(1)
  }

  const screenshot = fs.readFileSync(screenshotPath)
  console.log(`Screenshot size: ${screenshot.length} bytes`)

  // Build message content
  const { target, winners_count, top_guesses, day } = recap
  const gene = target.gene || "Unknown"
  const fullName = target.full_name || ""

  // Format date as "1st of January, 2026"
  const formatDate = (dateStr) => {
    const date = new Date(dateStr + "T00:00:00Z")
    const dayNum = date.getUTCDate()
    const suffix =
      dayNum === 1 || dayNum === 21 || dayNum === 31
        ? "st"
        : dayNum === 2 || dayNum === 22
          ? "nd"
          : dayNum === 3 || dayNum === 23
            ? "rd"
            : "th"
    const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
    const year = date.getUTCFullYear()
    return `${dayNum}${suffix} of ${month}, ${year}`
  }

  let content = `GeneGuessr for ${formatDate(day)}\n**${gene}**`
  if (fullName) {
    content += `\n${fullName}`
  }
  content += "\n\n"

  if (winners_count > 0) {
    content += `${winners_count} player${winners_count === 1 ? "" : "s"} solved it!\n\n`
  } else {
    content += "No one solved it!\n\n"
  }

  if (top_guesses && top_guesses.length > 0) {
    content += "Top guesses:\n"
    for (const guess of top_guesses) {
      content += `${guess.rank}. ${guess.gene}\n`
    }
    content += "\n"
  }

  content += "Play today's puzzle: <https://geneguessr.brinedew.bio>"

  console.log("Message content:")
  console.log(content)

  // Post to Discord with multipart form data
  const boundary = "----FormBoundary" + Math.random().toString(36).substring(2)

  // Build form data manually
  let body = ""

  // JSON payload part
  const payload = {
    content: content,
  }

  body += `--${boundary}\r\n`
  body += 'Content-Disposition: form-data; name="payload_json"\r\n'
  body += "Content-Type: application/json\r\n\r\n"
  body += JSON.stringify(payload) + "\r\n"

  // File part
  body += `--${boundary}\r\n`
  body += `Content-Disposition: form-data; name="files[0]"; filename="structure-${day}.png"\r\n`
  body += "Content-Type: image/png\r\n\r\n"

  const bodyStart = Buffer.from(body, "utf8")
  const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  const fullBody = Buffer.concat([bodyStart, screenshot, bodyEnd])

  console.log(`Posting to channel ${channelId}...`)

  const response = await postToDiscord(channelId, fullBody, boundary, botToken)

  if (response.error) {
    console.error("Discord API error:", response)
    process.exit(1)
  }

  console.log("Posted successfully!")
  console.log("Message ID:", response.id)

  // Output for GitHub Actions
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    fs.appendFileSync(outputFile, `message_id=${response.id}\n`)
  }
}

function postToDiscord(channelId, body, boundary, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "discord.com",
      port: 443,
      path: `/api/v10/channels/${channelId}/messages`,
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }

    const req = https.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        try {
          const json = JSON.parse(data)
          if (res.statusCode >= 400) {
            console.error(`HTTP ${res.statusCode}:`, data)
            resolve({ error: true, status: res.statusCode, ...json })
          } else {
            resolve(json)
          }
        } catch (e) {
          console.error("Failed to parse response:", data)
          reject(e)
        }
      })
    })

    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
