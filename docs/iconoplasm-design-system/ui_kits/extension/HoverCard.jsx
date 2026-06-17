/* HoverCard.jsx — the three hover-card variants + shared LabLabelCard.
   Exposes window.HoverCard, window.LabLabelCard.
   Rough loops/strikes drawn by roughloop.js (window.IconoRough). */

/* deterministic pseudo-metrics so sample cards feel populated */
function geneMetrics(g) {
  let h = 0;
  for (const c of g.symbol) h = (h * 31 + c.charCodeAt(0)) % 100000;
  const tau = (((h % 80) + 15) / 100).toFixed(2);
  const loeuf = ((((h >> 3) % 150) + 30) / 100).toFixed(3);
  const seasons = ["spring", "summer", "autumn", "winter"];
  const season = seasons[(g.symbol.charCodeAt(0)) % 4];
  const vibrance = +tau > 0.6 ? "high vibrance" : +tau > 0.35 ? "mid vibrance" : "low vibrance";
  const shade = +loeuf < 0.7 ? "dark shade" : +loeuf < 1.2 ? "mid shade" : "light shade";
  const align = ["TP53", "PTEN", "BRCA1"].includes(g.symbol) ? "tumor-suppressor" : "neutral";
  return { tau, loeuf, season, vibrance, shade, align };
}

function useRough(ref, deps) {
  React.useEffect(() => {
    if (window.IconoRough && ref.current) window.IconoRough.draw(ref.current);
  }, deps || []);
}

/* The signature vintage lab label registry sheet. */
function LabLabelCard({ g, drab, vote, onVote, sheet }) {
  const m = geneMetrics(g);
  const v = vote || null;
  const ref = React.useRef(null);
  useRough(ref, [g.symbol, v]);

  const soluble = g.category === "soluble";
  return (
    <div className={"lab-card" + (drab ? " drab" : "")} style={{ "--c": g.color }} ref={ref}>
      {/* LEFT RAIL */}
      <div className="lab-rail">
        <div className="lab-portrait">
          <div className="lab-book">
            <svg viewBox="0 0 24 24"><path d="M12 5C9 3 5 3 3 4v15c2-1 6-1 9 1 3-2 7-2 9-1V4c-2-1-6-1-9 1zM12 6v14" /></svg>
          </div>
          <div className="lab-portrait-bevel">
            <div className="lab-portrait-inner" style={{ background: g.portrait }}>
              <span className="nm">{g.name}</span>
            </div>
          </div>
        </div>
        <div className="lab-spectral">
          <div className="lab-spectral-cap">Emulsion note /<br />glass plate spectral analysis</div>
          <div className="lab-color-row">
            <span className="lab-sw"></span>
            <span className="lab-hex">{g.color.toUpperCase()}</span>
            <span className="lab-color-name">{g.colorName}</span>
          </div>
          <div className="lab-spec-grid">
            <span className="k">Letter</span><span className="v">{g.symbol[0]}</span><span className="h">{m.season}</span>
            <span className="k">HPA Tau</span><span className="v">{m.tau}</span><span className="h">{m.vibrance}</span>
            <span className="k">gnomAD LOEUF</span><span className="v">{m.loeuf}</span><span className="h">{m.shade}</span>
          </div>
        </div>
      </div>

      {/* RIGHT FORM */}
      <div className="lab-form">
        <div className="lab-row lab-header">
          <div className="lab-title">
            <span className="lab-lbl">Gene name</span>
            <span className="sym">{g.symbol}</span>
            <span className="nm">{g.name}</span>
            <span className="reg">Iconoplasm Human Gene Registry / Accession Sheet {sheet || "03"}</span>
          </div>
          <div className="lab-meta">
            <div className="lab-meta-top">
              <div className="lab-meta-cell"><span className="lab-lbl">Emulsion no.</span><span className="lab-tv">{g.emulsion}</span></div>
              <div className="lab-meta-cell"><span className="lab-lbl">Family</span><span className="lab-tv">{g.family}</span></div>
            </div>
            <div className="lab-meta-trait"><span className="lab-lbl">Family trait</span></div>
          </div>
          <div className="lab-qc">
            <span className="lab-lbl">QC</span>
            <div className="lab-vote">
              <button className={v === "misfit" ? "on" : ""} onClick={() => onVote && onVote("misfit")}>MISFIT</button>
              <button className={v === "fit" ? "on" : ""} onClick={() => onVote && onVote("fit")}>FIT</button>
            </div>
            <div className="lab-qc-inspect">Inspect. plate {g.symbol[0]}{(g.emulsion[1] || "3")} {g.symbol.length}</div>
            <div className="lab-qc-note">{v === "fit" ? "looks right" : v === "misfit" ? "needs a redraw" : "pending review"}</div>
          </div>
        </div>

        <div className="lab-row">
          <div className="lab-rowlabel"><span className="lab-lbl">Field notes</span></div>
          <div className="lab-band">
            <div className="lab-band-cell">
              <div className="lab-lbl">Category</div>
              <div className="lab-cat-vals">
                {soluble ? (
                  <React.Fragment>
                    <span className="lab-tv">TRANSMEMBRANE</span>
                    <span className="lab-cat-fem">
                      <span className="lab-hand-above">{g.sex}</span>
                      <span className="lab-ell lab-tv js-rough-ellipse" data-seed="5">SOLUBLE</span>
                    </span>
                  </React.Fragment>
                ) : (
                  <React.Fragment>
                    <span className="lab-cat-fem">
                      <span className="lab-hand-above">{g.sex}</span>
                      <span className="lab-ell lab-tv js-rough-ellipse" data-seed="5">TRANSMEMBRANE</span>
                    </span>
                    <span className="lab-tv">SOLUBLE</span>
                  </React.Fragment>
                )}
              </div>
            </div>
            <div className="lab-band-cell">
              <div className="lab-lbl">First noted</div>
              <div className="lab-noted-line"><span className="lab-tv">{g.firstNoted}</span><span className="lab-hand">{g.age}</span></div>
            </div>
            <div className="lab-band-cell">
              <div className="lab-lbl">Mass</div>
              <div className="lab-mass-line">
                <span className="lab-mass-fill"><span className="lab-hand">{g.massKg.replace(" kg", "")}</span></span>
                <span className="lab-mass-units"><span className="lab-tv lab-cross">kDa</span><span className="lab-hand">kg</span></span>
              </div>
            </div>
          </div>
        </div>

        <div className="lab-row">
          <div className="lab-rowlabel"><span className="lab-lbl">Pfam clans</span></div>
          <div className="lab-pfam"><span className="lab-tv">{g.pfam}</span><span className="lab-hand">{g.style}</span></div>
        </div>

        <div className="lab-row">
          <div className="lab-rowlabel"><span className="lab-lbl">Alignment</span></div>
          <div className="lab-align">
            {m.align === "tumor-suppressor" ? (
              <React.Fragment>
                <span className="lab-tv js-rough-strike" data-seed="9" style={{ paddingRight: ".2em" }}>ONCOGENE</span>
                <span className="lab-ell lab-tv js-rough-ellipse" data-seed="6">TUMOR SUPPRESSOR</span>
              </React.Fragment>
            ) : (
              <span className="lab-align-pair js-rough-strike" data-seed="9">
                <span className="lab-tv">ONCOGENE</span><span className="lab-tv">TUMOR SUPPRESSOR</span>
              </span>
            )}
          </div>
        </div>

        <div className="lab-row" style={{ borderBottomWidth: 0 }}>
          <div className="lab-rowlabel"><span className="lab-lbl">Remarks</span></div>
          <div className="lab-remarks">
            <div className="lab-remarks-col">
              <span className="lab-cap">Labelled / inspected / filed</span>
              <span className="lab-typed-sm">REQUEST PRINT COPY</span>
              <span className="lab-cap">Seal after review / do not expose to open air</span>
            </div>
            <div className="lab-remarks-col">
              <span className="lab-cap">Brinedew Institute / internal matter</span>
              <span className="lab-cap">Keep away from heat and moisture</span>
              <span className="lab-cap">Registry copy retained in cabinet 5A</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleCard({ g }) {
  const rows = [
    { ml: "first noted", mv: g.firstNoted, hl: "age", hv: g.age },
    { ml: "mass", mv: g.massKDa, hl: "weight", hv: g.massKg },
    { ml: g.category, mv: g.category, hl: "sex", hv: g.sex },
    { ml: "pfam clan", mv: g.pfam, hl: "style", hv: g.style },
  ];
  return (
    <div className="hc-simple" style={{ "--p": g.portrait }}>
      <div className="por" style={{ background: g.portrait }}></div>
      <div className="bod">
        <div className="sym">{g.symbol}</div>
        <div className="nm">{g.name}</div>
        <div className="hc-hr"></div>
        {rows.map((r, i) => (
          <div className="hc-mrow" key={i}>
            <div className="hc-mcell"><span className="hc-ml">{r.ml}</span><span className="hc-mv">{r.mv}</span></div>
            <div className="hc-mcell human"><span className="hc-ml">{r.hl}</span><span className="hc-hv">{r.hv}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlotCard({ g }) {
  return (
    <div className="hc-blot" style={{ "--p": g.portrait }}>
      <div className="ov">
        <span className="nm">{g.name}</span>
        <span className="sym">{g.symbol}</span>
      </div>
    </div>
  );
}

function HoverCard({ g, variant }) {
  if (!g) return null;
  if (variant === "lit-archival") return <div style={{ width: 880, maxWidth: "94vw" }}><LabLabelCard g={g} sheet="03" /></div>;
  if (variant === "image-only") return <BlotCard g={g} />;
  return <SimpleCard g={g} />;
}

Object.assign(window, { HoverCard, LabLabelCard });
