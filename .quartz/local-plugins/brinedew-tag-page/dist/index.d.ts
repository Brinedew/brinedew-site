import { QuartzPageTypePlugin } from '@quartz-community/types';
import { TagPageOptions } from './types.js';
export { PageList, TagContent } from './components/index.js';
import 'preact';

declare const TagPage: QuartzPageTypePlugin<TagPageOptions>;

export { TagPage, TagPageOptions };
