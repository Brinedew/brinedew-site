/* Archive.jsx — the gene blot archive feed. Reuses window.LabLabelCard. */

function ArchiveApp() {
  const { useState } = React;
  const genes = window.ICONO_GENES;
  const [votes, setVotes] = useState({});
  const [query, setQuery] = useState("");

  const vote = (sym, v) => setVotes((m) => ({ ...m, [sym]: m[sym] === v ? null : v }));
  const discovered = Object.values(votes).filter(Boolean).length;
  const shown = genes.filter((g) =>
    !query || g.symbol.includes(query.toUpperCase()) || g.name.toLowerCase().includes(query.toLowerCase()));
  const pct = Math.max(2, (discovered / 19023) * 100 * 380); // exaggerate so the sliver is visible

  return (
    <React.Fragment>
      <nav className="site-nav">
        <img src="../../assets/icon-48.png" width="34" height="34" alt="" />
        <div>
          <div className="kick">Gene mnemonics</div>
          <div className="wm">ICONOPLASM</div>
        </div>
        <input className="site-search" placeholder="Search 19,023 genes…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </nav>

      <main className="feed">
        <div className="arch-head">
          <div className="kick">Archive</div>
          <div className="count">{discovered}</div>
          <div className="sub">recorded out of 19,023</div>
          <div className="arch-bar"><div className="arch-fill" style={{ width: Math.min(100, pct) + "%" }}></div></div>
        </div>

        {shown.map((g) => (
          <div className="spec-wrap" key={g.symbol}>
            <window.LabLabelCard g={g} vote={votes[g.symbol]} onVote={(v) => vote(g.symbol, v)} />
          </div>
        ))}
      </main>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ArchiveApp />);
