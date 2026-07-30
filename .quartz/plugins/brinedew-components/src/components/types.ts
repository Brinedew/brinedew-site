import type {
  QuartzComponent as CommunityQuartzComponent,
  QuartzComponentProps,
} from "@quartz-community/types"

export type { QuartzComponentProps } from "@quartz-community/types"

// Quartz core supports an optional display name on components. The community
// type package currently omits that one metadata field, so keep the adapter
// limited to the real core extension instead of copying the entire type.
export type QuartzComponent = CommunityQuartzComponent & {
  displayName?: string
}

export type QuartzComponentConstructor<Options extends object | undefined = undefined> = (
  opts?: Options,
) => QuartzComponent
