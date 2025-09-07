const { Plugin } = require('obsidian');

/**
 * CARMACK'S NUCLEAR OPTION: Just strip all comments on any save
 * No SaveArbiter, no ephemeral IDs, no complex transforms.
 * If comments between spans cause phantom sections, eliminate all comments.
 */
class LineageSimpleFix extends Plugin {
  async onload() {
    console.log("LineageSimpleFix: Loading nuclear option...");
    
    const patchViews = () => {
      const leaves = this.app.workspace.getLeaves();
      
      for (const leaf of leaves) {
        const v = leaf.view;
        if (!v || v.getViewType?.() !== "lineage") continue;
        if (v.__lsgSimplePatched) continue;
        
        // WRITE: just strip comments, nothing else
        if (v.getViewData && v.setViewData && !v.__lsgSimplePatched) {
          const origGet = v.getViewData.bind(v);
          v.getViewData = () => {
            const raw = origGet();
            // Strip ALL lineage comments (Obsidian and HTML format)
            return raw
              .replace(/(?:^|\n)\s*%%\s*lineage:(?:scaffold|content)\s+(?:start|end)\s*%%\s*(?=\n|$)/gi, "")
              .replace(/(?:\n)?\s*<!--\s*lineage:(?:scaffold|content)\s+(?:start|end)\s*-->\s*(?:\n)?/gi, "");
          };
          v.__lsgSimplePatched = true;
          console.log("LineageSimpleFix: Patched", v.file?.path);
        }
      }
    };

    this.registerEvent(this.app.workspace.on("layout-change", patchViews));
    setTimeout(patchViews, 300);
  }
  
  onunload() {
    console.log("LineageSimpleFix: Unloaded");
  }
}

module.exports = LineageSimpleFix;