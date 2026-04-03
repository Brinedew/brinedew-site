function escAttr(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function renderIconoplasmArtistStylesHtml({ turnstileSiteKey = "" } = {}) {
  const siteKey = String(turnstileSiteKey || "").trim()
  const turnstileConfigured = Boolean(siteKey)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Blacklist artist style</title>
  ${
    turnstileConfigured
      ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
      : ""
  }
  <style>
    :root {
      --bg: #f6f1e8;
      --surface: rgba(255, 251, 245, 0.92);
      --surface-2: #f0e7db;
      --line: rgba(90, 67, 46, 0.18);
      --text: #271c13;
      --muted: #705e4f;
      --accent: #8d5f2d;
      --accent-soft: rgba(141, 95, 45, 0.14);
      --ok: #27593d;
      --danger: #8b3d35;
      --shadow: 0 22px 60px rgba(60, 36, 19, 0.12);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      background:
        radial-gradient(circle at top left, rgba(164, 120, 74, 0.12), transparent 32%),
        radial-gradient(circle at bottom right, rgba(110, 138, 114, 0.14), transparent 30%),
        linear-gradient(180deg, #f8f3eb, #efe6da 55%, #f6f1e8);
    }

    .wrap {
      width: min(680px, calc(100% - 28px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }

    .hero,
    .panel {
      border: 1px solid var(--line);
      background: var(--surface);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }

    .hero {
      padding: 28px;
      margin-bottom: 16px;
    }

    .kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 11px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.76rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      margin-top: 16px;
      font-size: clamp(2.1rem, 6vw, 3.5rem);
      line-height: 0.94;
      letter-spacing: -0.05em;
      text-wrap: balance;
      max-width: 10ch;
    }

    .lede {
      margin-top: 14px;
      max-width: 50ch;
      color: var(--muted);
      font-size: 1.02rem;
      line-height: 1.58;
      text-wrap: pretty;
    }

    .panel {
      padding: 22px;
    }

    form {
      display: grid;
      gap: 18px;
    }

    label {
      display: grid;
      gap: 8px;
      font-size: 0.76rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    input,
    button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px 15px;
      color: var(--text);
      background: var(--surface-2);
      font: inherit;
    }

    input {
      font-size: 1rem;
    }

    input:focus,
    button:focus-visible {
      outline: 2px solid rgba(141, 95, 45, 0.3);
      outline-offset: 2px;
      border-color: rgba(141, 95, 45, 0.45);
    }

    button {
      width: auto;
      cursor: pointer;
      font-weight: 600;
      background: linear-gradient(135deg, rgba(141, 95, 45, 0.15), rgba(110, 138, 114, 0.16));
    }

    button:hover {
      border-color: rgba(141, 95, 45, 0.45);
    }

    button:disabled {
      opacity: 0.7;
      cursor: wait;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }

    .help {
      color: var(--muted);
      font-size: 0.96rem;
      line-height: 1.55;
      text-wrap: pretty;
    }

    .status {
      min-height: 3.4em;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.38);
      padding: 14px 15px;
      color: var(--muted);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .status[data-tone="ok"] {
      color: var(--ok);
      border-color: rgba(39, 89, 61, 0.22);
      background: rgba(39, 89, 61, 0.08);
    }

    .status[data-tone="error"] {
      color: var(--danger);
      border-color: rgba(139, 61, 53, 0.22);
      background: rgba(139, 61, 53, 0.08);
    }

    .fine-print {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .honeypot {
      position: absolute;
      left: -9999px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    }

    @media (max-width: 640px) {
      .wrap {
        width: min(100% - 18px, 680px);
        padding-top: 18px;
      }

      .hero,
      .panel {
        border-radius: 18px;
      }

      .hero,
      .panel {
        padding-left: 18px;
        padding-right: 18px;
      }

      .actions {
        flex-direction: column;
        align-items: stretch;
      }

      button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="kicker">Iconoplasm opt-out</div>
      <h1>Blacklist an artist style.</h1>
      <p class="lede">
        If an Iconoplasm image looks like your style, enter your name or @tag and send it.
      </p>
    </section>

    <section class="panel">
      <form id="blacklist-form">
        <label>
          Artist name or @tag
          <input id="artist-input" name="artist-input" type="text" maxlength="255" autocomplete="off" placeholder="Loish or @loish" required />
        </label>

        <div class="honeypot" aria-hidden="true">
          <label>
            Website
            <input id="website" name="website" type="text" tabindex="-1" autocomplete="off" />
          </label>
        </div>

        ${
          turnstileConfigured
            ? `<div class="cf-turnstile" data-sitekey="${escAttr(siteKey)}" data-theme="light"></div>`
            : ""
        }

        <div class="actions">
          <button id="submit-btn" type="submit">Submit blacklist request</button>
          <div class="help">Use the name or @tag from the style list.</div>
        </div>

        <div id="status" class="status" data-tone="neutral">Nothing submitted yet.</div>

        ${
          turnstileConfigured
            ? '<div class="fine-print"><div>You may see a quick human check before sending.</div></div>'
            : ""
        }
      </form>
    </section>
  </main>

  <script>
    (function () {
      var form = document.getElementById('blacklist-form');
      var artistInput = document.getElementById('artist-input');
      var honeypot = document.getElementById('website');
      var submitBtn = document.getElementById('submit-btn');
      var status = document.getElementById('status');
      var turnstileConfigured = ${turnstileConfigured ? "true" : "false"};

      function setStatus(message, tone) {
        status.textContent = String(message || '');
        status.setAttribute('data-tone', tone || 'neutral');
      }

      async function submitRequest(event) {
        event.preventDefault();
        var artistName = String(artistInput.value || '').trim();
        if (!artistName) {
          setStatus('Enter the artist name or @tag first.', 'error');
          artistInput.focus();
          return;
        }

        var turnstileField = document.querySelector('[name="cf-turnstile-response"]');
        var turnstileToken = turnstileField ? String(turnstileField.value || '').trim() : '';
        if (turnstileConfigured && !turnstileToken) {
          setStatus('Please complete the bot check first.', 'error');
          return;
        }

        submitBtn.disabled = true;
        setStatus('Submitting blacklist request...', 'neutral');

        try {
          var resp = await fetch('/api/iconoplasm/artist-blacklist-submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              artist_name_input: artistName,
              website: String(honeypot.value || ''),
              turnstile_token: turnstileToken,
            }),
          });

          var text = await resp.text();
          var data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = { raw: text };
          }

          if (!resp.ok) {
            throw new Error(String((data && data.error) || ('HTTP ' + resp.status)));
          }

          setStatus(data && data.duplicate ? 'That name was already submitted.' : 'Thanks. We got it.', 'ok');
          if (!data || !data.duplicate) {
            form.reset();
          }
          if (turnstileConfigured && window.turnstile && typeof window.turnstile.reset === 'function') {
            window.turnstile.reset();
          }
        } catch (error) {
          setStatus(String((error && error.message) || error || 'Submission failed.'), 'error');
        } finally {
          submitBtn.disabled = false;
        }
      }

      form.addEventListener('submit', submitRequest);
    })();
  </script>
</body>
</html>`
}
