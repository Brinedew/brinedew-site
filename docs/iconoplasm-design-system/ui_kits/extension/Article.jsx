/* Article.jsx — a faux reference article with auto-highlighted gene symbols.
   window.Article, window.GeneSpan */

function GeneSpan({ g, mode, onEnter, onLeave }) {
  const ref = React.useRef(null);
  const fire = () => { if (ref.current) onEnter(g, ref.current.getBoundingClientRect()); };
  return (
    <span ref={ref} className={"gene gene--" + mode} style={{ "--c": g.color }}
      onMouseEnter={fire} onMouseLeave={onLeave}>
      {mode === "ellipse" && (
        <svg className="gene-loop" viewBox="0 0 120 40" preserveAspectRatio="none">
          <path d="M14 22 C 8 8, 40 4, 70 6 C 104 8, 116 16, 110 24 C 104 33, 70 37, 40 35 C 12 33, 6 26, 16 18" />
        </svg>
      )}
      {g.symbol}
    </span>
  );
}

/* Resolve a gene record by symbol, honoring the blocklist. */
function Article({ mode, timing, blocked, onEnter, onLeave }) {
  const G = {};
  window.ICONO_GENES.forEach((g) => { G[g.symbol] = g; });
  const gene = (sym, key) => {
    const g = G[sym];
    if (!g || blocked.has(sym)) return sym;
    return <GeneSpan key={key} g={g} mode={mode} onEnter={onEnter} onLeave={onLeave} />;
  };

  return (
    <div className={"article" + (timing === "hover" ? " timing-hover" : "")}>
      <h1>Tumor suppressor gene</h1>
      <p className="lede">From Iconoplasm Reader — hover any highlighted symbol for its specimen card.</p>
      <p>
        A tumor suppressor gene encodes a protein that restrains cell division or
        promotes apoptosis. The archetype, {gene("TP53", 1)}, is mutated in roughly
        half of human cancers; its guardian role earns it the nickname "guardian of
        the genome." Loss of {gene("PTEN", 2)} similarly removes a brake on the
        PI3K/AKT growth signal.<span className="ref">[1]</span>
      </p>
      <h2>DNA repair and inherited risk</h2>
      <p>
        Inherited mutations in {gene("BRCA1", 3)} markedly raise the lifetime risk of
        breast and ovarian cancer. The protein participates in homologous-recombination
        repair of double-strand breaks, proofreading the genome before each division.
        Note that common words such as SET, REST and CAT are gene aliases too, but are
        blocked by default so prose stays readable.<span className="ref">[2]</span>
      </p>
      <h2>Beyond cancer</h2>
      <p>
        Not every catalogued gene is a tumor suppressor. {gene("RHO", 4)} encodes
        rhodopsin, the dim-light photoreceptor of the retina; {gene("INS", 5)} encodes
        insulin, the hormone that lets cells take up glucose; and {gene("HOXB1", 6)}
        helps lay out the embryonic body plan. Each is catalogued in the archive with
        its own color and portrait.<span className="ref">[3]</span>
      </p>
    </div>
  );
}

Object.assign(window, { Article, GeneSpan });
