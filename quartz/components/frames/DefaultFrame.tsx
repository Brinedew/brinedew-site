import { PageFrame, PageFrameProps } from "./types"
import HeaderConstructor from "../Header"

const Header = HeaderConstructor()

/**
 * The default page frame — three-column layout with left sidebar, center
 * content (header + body + afterBody), and right sidebar, followed by a footer.
 *
 * This is the original Quartz layout, extracted from renderPage.tsx.
 */
export const DefaultFrame: PageFrame = {
  name: "default",
  render({
    componentData,
    header,
    beforeBody,
    pageBody: Content,
    afterBody,
    left,
    right,
    footer: Footer,
  }: PageFrameProps) {
    return (
      <>
        <div class="left sidebar">
          {left.map((BodyComponent) => (
            <BodyComponent {...componentData} />
          ))}
        </div>
        <div class="center">
          <div class="page-header">
            <Header {...componentData}>
              {header.map((HeaderComponent) => (
                <HeaderComponent {...componentData} />
              ))}
            </Header>
            <div class="popover-hint">
              {beforeBody.map((BodyComponent) => (
                <BodyComponent {...componentData} />
              ))}
            </div>
          </div>
          {(() => {
            const isDraftPage =
              componentData.fileData.frontmatter?.draft === true ||
              componentData.fileData.frontmatter?.draft === "true"
            if (!isDraftPage) return null
            return <span class="draft-indicator popover-hint">Unpublished draft</span>
          })()}
          <Content {...componentData} />
          {(() => {
            const isDraftPage =
              componentData.fileData.frontmatter?.draft === true ||
              componentData.fileData.frontmatter?.draft === "true"
            if (!isDraftPage) return null
            return (
              <article class="icono-card icono-guest-login-card" id="draft-cta">
                <div class="icono-home-auth-copy">
                  <div class="icono-guest-login-card-title">Continue to read the draft.</div>
                  <p class="draft-cta-msg draft-cta-msg--guest">
                    Log in and become a supporter to read the full article.
                  </p>
                  <p class="draft-cta-msg draft-cta-msg--user" hidden>
                    Become a supporter to read the full article.
                  </p>
                </div>
                <a
                  href="/api/auth/login"
                  class="icono-guest-login-card-button draft-cta-btn--login"
                >
                  Log in with Discord
                </a>
                <a
                  href="/posts/support-me"
                  class="icono-guest-login-card-button draft-cta-btn--support"
                  hidden
                >
                  Support Brinedew
                </a>
              </article>
            )
          })()}
          <hr />
          <div class="page-footer">
            {afterBody.map((BodyComponent) => (
              <BodyComponent {...componentData} />
            ))}
          </div>
        </div>
        <div class="right sidebar">
          {right.map((BodyComponent) => (
            <BodyComponent {...componentData} />
          ))}
        </div>
        <Footer {...componentData} />
      </>
    )
  },
}
