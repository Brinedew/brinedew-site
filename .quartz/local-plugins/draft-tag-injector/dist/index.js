// Re-export DraftTagInjector from the shared brinedew-components bundled dist.
// Source: ../brinedew-components/src/plugins/draftTagInjector.ts
// The component manifest declares the export name as `DraftTagInjector`, so
// the dist must expose both a default export and the named export.
import { DraftTagInjector as _DraftTagInjector } from "../../../plugins/brinedew-components/dist/index.js";
export const DraftTagInjector = _DraftTagInjector;
export default _DraftTagInjector;
