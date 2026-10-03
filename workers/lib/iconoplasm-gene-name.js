// B-908: THE ONE rule for what a gene is called in public. A gene is named by
// its catalog row, icono_gene_catalog.full_name, which carries the HGNC
// approved name (the page is keyed by the HGNC symbol, so its name comes from
// the same authority). The symbol stands in when that name is empty.
//
// Everything a reader sees takes its name through this function: the stable
// gene object (genes/v3/<SYMBOL>.json), catalog row[1] of
// catalog/v3/index.json (which titles the 19,023 static gene documents and
// labels the gallery), and the shelf rows. The essence row's full_name is the
// UniProt protein name the workstation syncs; it names no gene in public, and
// reading it ahead of the catalog row is what made the tab title change when
// a gene page's card loaded.
const GENE_NAME_MAX_LENGTH = 255

export function iconoplasmGeneName(catalogFullName, symbol) {
  return (
    String(catalogFullName ?? "")
      .trim()
      .slice(0, GENE_NAME_MAX_LENGTH) || String(symbol ?? "")
  )
}
