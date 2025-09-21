import type { QuartzTransformerPlugin } from "../types"

// Replace bare YouTube URLs on their own line with an embedded player iframe.
// Supports:
//  - https://www.youtube.com/watch?v=VIDEO_ID
//  - https://youtu.be/VIDEO_ID
//  - https://www.youtube.com/shorts/VIDEO_ID
// Skips inside fenced code blocks (``` … ```)

export const YouTubeAutoEmbed: QuartzTransformerPlugin = () => {
  // Matches a bare URL line; group 4 is the video id
  const YT_LINE = new RegExp(
    String.raw`^(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})(?:[?&][^\s]*)?)$`,
  )

  return {
    name: "YouTubeAutoEmbed",
    textTransform(_ctx, src) {
      const out: string[] = []
      const lines = src.split(/\r?\n/)
      let inFence = false

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        const line = raw.trim()

        // naive fence toggle for ```
        if (line.startsWith("```") || line.startsWith("~~~")) {
          inFence = !inFence
          out.push(raw)
          continue
        }

        if (!inFence) {
          const m = line.match(YT_LINE)
          if (m) {
            const videoId = m[2]
            out.push(
              "<div class=\"external-embed youtube\">",
              `  <iframe src=\"https://www.youtube.com/embed/${videoId}\" title=\"YouTube video\" frameborder=\"0\" loading=\"lazy\" allow=\"accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share\" allowfullscreen></iframe>`,
              "</div>",
            )
            continue
          }
        }

        out.push(raw)
      }

      return out.join("\n")
    },
  }
}

