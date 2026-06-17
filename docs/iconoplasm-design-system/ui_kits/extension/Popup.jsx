/* Popup.jsx — the toolbar popup. Controlled by props from the host app so
   changing settings live-updates the article + hover cards. window.ExtensionPopup */

function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

function ExtensionPopup({ settings, set, blocklist, addBlock, removeBlock }) {
  const [tab, setTab] = React.useState("appearance");
  const [draft, setDraft] = React.useState("");
  const add = () => { const s = draft.trim().toUpperCase(); if (s) { addBlock(s); setDraft(""); } };

  return (
    <div className="popup">
      <div className="popup-shell">
        <header className="popup-header">
          <div className="popup-brand">
            <img src="../../assets/icon-48.png" width="40" height="40" alt="" />
            <div>
              <p className="popup-kicker">Gene mnemonics</p>
              <h1>ICONOPLASM</h1>
            </div>
          </div>
          <div className="popup-version">v0.4.7</div>
        </header>

        <nav className="popup-tabs">
          {["appearance", "blocklist", "account"].map((t) => (
            <button key={t} className={"popup-tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>

        {tab === "appearance" && (
          <section className="popup-section">
            <div className="popup-field">
              <span className="popup-legend">Highlight appearance</span>
              <Seg value={settings.highlight} onChange={(v) => set("highlight", v)} options={[
                { v: "underline", l: "Under line" }, { v: "pill", l: "Color pills" },
                { v: "pill-outline", l: "Pill outline" }, { v: "ellipse", l: "Rough ellipse" }]} />
            </div>
            <div className="popup-field">
              <span className="popup-legend">Highlight timing</span>
              <Seg value={settings.timing} onChange={(v) => set("timing", v)} options={[
                { v: "always", l: "Always on" }, { v: "hover", l: "On hover" }]} />
            </div>
            <div className="popup-field">
              <span className="popup-legend">Hover card appearance</span>
              <Seg value={settings.card} onChange={(v) => set("card", v)} options={[
                { v: "simple", l: "Simple" }, { v: "lit-archival", l: "Vintage lab label" },
                { v: "image-only", l: "Blot only" }]} />
            </div>
          </section>
        )}

        {tab === "blocklist" && (
          <section className="popup-section">
            <span className="popup-legend">Ignored symbols</span>
            <div className="popup-input-row">
              <input className="popup-input" placeholder="Add gene symbol…" value={draft}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              <button className="popup-btn" onClick={add}>Add</button>
            </div>
            <ul className="popup-list">
              {blocklist.map((b) => (
                <li className="popup-li" key={b.sym}>
                  <span><span className="popup-badge">{b.kind}</span><span className="sym">{b.sym}</span></span>
                  <button className="popup-x" onClick={() => removeBlock(b.sym)}>×</button>
                </li>
              ))}
            </ul>
            <p className="popup-note">{blocklist.length} blocked. Ambiguous English words like SET, REST, CAT stay quiet.</p>
          </section>
        )}

        {tab === "account" && (
          <section className="popup-section">
            <span className="popup-legend">Account</span>
            <a className="popup-btn full" href="#" onClick={(e) => e.preventDefault()}>Sign in with Discord</a>
            <div className="popup-status">Not signed in — discoveries are stored locally.</div>
            <p className="popup-note">Optional. Syncs your discoveries between the extension and iconoplasm.brinedew.bio.</p>
          </section>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ExtensionPopup });
