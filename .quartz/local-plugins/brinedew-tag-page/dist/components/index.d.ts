import { QuartzComponent, QuartzComponentProps, QuartzPluginData, SortFn } from '@quartz-community/types';
import { TagPageOptions } from '../types.js';
import * as preact from 'preact';

declare const _default: (options?: TagPageOptions) => QuartzComponent;

interface PageListProps extends QuartzComponentProps {
    pages?: QuartzPluginData[];
    limit?: number;
    sort?: SortFn;
}
declare function PageList({ fileData, allFiles, pages, limit, sort }: PageListProps): preact.JSX.Element;

export { PageList, _default as TagContent };
