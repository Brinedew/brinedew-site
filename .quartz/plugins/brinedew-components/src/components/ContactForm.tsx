import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

type ContactFormOptions = {
  /** Path the form posts to. Must be an endpoint on the stateful worker. */
  endpoint?: string
}

/**
 * Site-wide contact form for the brinedew.bio About page.
 *
 * Progressive-enhancement form. Without JavaScript it posts standard form
 * data to `/api/contact`; with JavaScript it posts JSON and shows status
 * inline without a full-page navigation.
 * No bot challenge, no captcha, no third-party widget — the worker
 * applies a per-IP rate limit and a hidden honeypot field, which is the
 * right amount of friction for a personal site contact form.
 *
 * Opt-in: the component only renders on pages whose frontmatter has
 * `contact: true` (or aliases), so enabling it in quartz.config.yaml as
 * a layout slot doesn't add the form to unrelated pages.
 */
const ContactForm = (opts: ContactFormOptions = {}): QuartzComponent => {
  const endpoint = opts.endpoint || "/api/contact"

  const Component: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const frontmatter = (fileData?.frontmatter as Record<string, unknown>) || null
    const aliases = ["contact", "contactForm", "showContactForm"]
    const wantsForm = Array.isArray(frontmatter)
      ? frontmatter.some((v) => aliases.includes(String(v)))
      : frontmatter && typeof frontmatter === "object"
        ? aliases.some((k) => Boolean((frontmatter as Record<string, unknown>)[k]))
        : false
    if (!wantsForm) return null

    return (
      <div class="contact-form-card" data-contact-form-root data-endpoint={endpoint}>
        <form
          class="contact-form"
          data-contact-form
          action={endpoint}
          method="post"
          acceptCharset="UTF-8"
        >
          <label class="contact-form__field">
            <span class="contact-form__label">Email</span>
            <input
              class="contact-form__input"
              type="email"
              name="email"
              required
              maxLength={254}
              autocomplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label class="contact-form__field">
            <span class="contact-form__label">Message</span>
            <textarea
              class="contact-form__textarea"
              name="message"
              required
              minLength={3}
              rows={6}
              maxLength={5000}
            ></textarea>
          </label>

          <div class="contact-form__honeypot" aria-hidden="true">
            <label>
              Website
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autocomplete="off"
                aria-hidden="true"
              />
            </label>
          </div>

          <div class="contact-form__actions">
            <button class="contact-form__submit" type="submit" data-contact-form-submit>
              Send
            </button>
          </div>

          <p
            class="contact-form__status"
            data-contact-form-status
            data-tone="neutral"
            aria-live="polite"
            role="status"
          ></p>

          <p
            id="contact-sent"
            class="contact-form__status contact-form__fallback-status"
            data-tone="ok"
            role="status"
          >
            Thanks — your message is on its way to my inbox.
          </p>
          <p
            id="contact-invalid"
            class="contact-form__status contact-form__fallback-status"
            data-tone="error"
            role="status"
          >
            Check your email address and write a message of at least 3 characters.
          </p>
          <p
            id="contact-limited"
            class="contact-form__status contact-form__fallback-status"
            data-tone="error"
            role="status"
          >
            Too many submissions. Try again in a minute.
          </p>
          <p
            id="contact-failed"
            class="contact-form__status contact-form__fallback-status"
            data-tone="error"
            role="status"
          >
            The message could not be sent. Please try again later.
          </p>
        </form>
      </div>
    )
  }

  Component.displayName = "ContactForm"

  Component.css = `
.contact-form-card {
  margin: 2.25rem 0 1.5rem;
  padding: 1.75rem 1.5rem 1.5rem;
  border: 1px solid var(--gray);
  border-radius: 16px;
  background: var(--light);
  max-width: 36rem;
}

.contact-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.contact-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.contact-form__label {
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--darkgray);
}

.contact-form__input,
.contact-form__textarea {
  font: inherit;
  color: var(--dark);
  background: var(--lightgray);
  border: 1px solid var(--gray);
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.contact-form__textarea {
  resize: vertical;
  min-height: 6.5rem;
  font-family: inherit;
  line-height: 1.5;
}

.contact-form__input:focus,
.contact-form__textarea:focus {
  outline: none;
  border-color: var(--tertiary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tertiary) 25%, transparent);
}

.contact-form__honeypot {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.contact-form__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.contact-form__submit {
  font: inherit;
  font-weight: 600;
  color: var(--light);
  background: var(--tertiary);
  border: 1px solid var(--tertiary);
  border-radius: 8px;
  padding: 0.7rem 1.2rem;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}

.contact-form__submit:hover:not(:disabled) {
  filter: brightness(0.95);
}

.contact-form__submit:active:not(:disabled) {
  transform: translateY(1px);
}

.contact-form__submit:disabled {
  opacity: 0.6;
  cursor: progress;
}

.contact-form__status {
  margin: 0;
  min-height: 1.25rem;
  font-size: 0.92rem;
  color: var(--darkgray);
  line-height: 1.4;
}

.contact-form__status[data-tone="ok"] {
  color: oklch(45% 0.12 150);
}

.contact-form__status[data-tone="error"] {
  color: oklch(50% 0.18 25);
}

.contact-form__fallback-status:not(:target) {
  display: none;
}

.contact-form[data-contact-form-enhanced="true"] .contact-form__fallback-status {
  display: none;
}
`

  // Quartz dispatches `nav` after the initial render and every SPA navigation,
  // including browser Back/Forward after micromorph has replaced the page body.
  Component.afterDOMLoaded = `
(function () {
  function attach(root) {
    if (!root) return;
    var form = root.querySelector("[data-contact-form]");
    if (!form || form.dataset.contactFormEnhanced === "true") return;
    var endpoint = root.getAttribute("data-endpoint") || "/api/contact";
    var status = root.querySelector("[data-contact-form-status]");
    var submit = root.querySelector("[data-contact-form-submit]");

    function setStatus(message, tone) {
      if (!status) return;
      status.textContent = String(message || "");
      status.setAttribute("data-tone", tone || "neutral");
    }

    var fallbackId =
      window.location && typeof window.location.hash === "string"
        ? window.location.hash.slice(1)
        : "";
    if (
      fallbackId === "contact-sent" ||
      fallbackId === "contact-invalid" ||
      fallbackId === "contact-limited" ||
      fallbackId === "contact-failed"
    ) {
      var fallback = root.querySelector("#" + fallbackId);
      if (fallback) {
        setStatus(fallback.textContent.trim(), fallback.getAttribute("data-tone") || "neutral");
      }
    }
    form.dataset.contactFormEnhanced = "true";

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var emailInput = form.querySelector("input[name='email']");
      var messageInput = form.querySelector("textarea[name='message']");
      var honeypot = form.querySelector("input[name='website']");

      var email = emailInput ? String(emailInput.value || "").trim() : "";
      var message = messageInput ? String(messageInput.value || "").trim() : "";

      if (!email) {
        setStatus("Enter your email.", "error");
        if (emailInput) emailInput.focus();
        return;
      }
      if (!message || message.length < 3) {
        setStatus("Write a message.", "error");
        if (messageInput) messageInput.focus();
        return;
      }

      if (submit) submit.disabled = true;
      setStatus("Sending…", "neutral");

      var payload = {
        email: email,
        message: message,
        website: honeypot ? String(honeypot.value || "") : "",
      };

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (resp) {
          return resp.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (_e) { data = { raw: text }; }
            return { ok: resp.ok, status: resp.status, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            setStatus("Thanks — your message is on its way to my inbox.", "ok");
            form.reset();
          } else {
            var msg = (result.data && result.data.error) ? result.data.error : ("HTTP " + result.status);
            setStatus(msg, "error");
          }
        })
        .catch(function (err) {
          setStatus(String((err && err.message) || err || "Submission failed."), "error");
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  function init() {
    var roots = document.querySelectorAll("[data-contact-form-root]");
    for (var i = 0; i < roots.length; i++) attach(roots[i]);
  }

  document.addEventListener("nav", init);
})();
`

  return Component
}

export default ContactForm as unknown as QuartzComponentConstructor<ContactFormOptions>
