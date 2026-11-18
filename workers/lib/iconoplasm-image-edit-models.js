export const ICONOPLASM_CARD_LAYOUT_WIDTH = 384
export const ICONOPLASM_CARD_LAYOUT_HEIGHT = 512
export const ICONOPLASM_PORTRAIT_REQUEST_WIDTH = ICONOPLASM_CARD_LAYOUT_WIDTH * 4
export const ICONOPLASM_PORTRAIT_REQUEST_HEIGHT = ICONOPLASM_CARD_LAYOUT_HEIGHT * 4
export const ICONOPLASM_PORTRAIT_REQUEST_SIZE = `${ICONOPLASM_PORTRAIT_REQUEST_WIDTH}x${ICONOPLASM_PORTRAIT_REQUEST_HEIGHT}`
export const ICONOPLASM_PORTRAIT_REQUEST_ASPECT_RATIO = "3:4"
export const ICONOPLASM_OPENAI_PORTRAIT_REQUEST_SIZE = ICONOPLASM_PORTRAIT_REQUEST_SIZE

// Fixed request fields for fal models, each read off the model's own schema (checked
// 2026-10-03). The standard set was verified against fal's live OpenAPI schemas on
// 2026-07-09.
const FAL_STANDARD_REQUEST_FIELDS = Object.freeze({
  output_format: "png",
  num_images: 1,
  enable_safety_checker: true,
})
const FAL_SEEDREAM_REQUEST_FIELDS = Object.freeze({
  ...FAL_STANDARD_REQUEST_FIELDS,
  image_size: "auto_2K",
})
// The Nano Banana pages list no enable_safety_checker (their moderation control is
// safety_tolerance), and Seedream 5 Lite lists no output_format, so neither model
// is sent a field its schema does not document.
const FAL_NANO_BANANA_REQUEST_FIELDS = Object.freeze({
  output_format: "png",
  num_images: 1,
})
const FAL_SEEDREAM_LITE_REQUEST_FIELDS = Object.freeze({
  image_size: "auto_2K",
  num_images: 1,
  enable_safety_checker: true,
})
// GPT Image 2.5 on fal: "auto" infers the size from the source image; a generation
// needs a concrete size with both sides a multiple of 16 (1536x2048 is the portrait's
// 3:4 target and inside fal's 655,360 to 8,294,400 pixel range).
const FAL_GPT_IMAGE_EDIT_REQUEST_FIELDS = Object.freeze({
  image_size: "auto",
  quality: "high",
  num_images: 1,
  output_format: "png",
})
const FAL_GPT_IMAGE_GENERATE_REQUEST_FIELDS = Object.freeze({
  image_size: Object.freeze({
    width: ICONOPLASM_PORTRAIT_REQUEST_WIDTH,
    height: ICONOPLASM_PORTRAIT_REQUEST_HEIGHT,
  }),
  quality: "high",
  num_images: 1,
  output_format: "png",
})

// Krea's GPT Image 2.5 schema requires aspect_ratio and resolution (checked
// 2026-10-03). 3:4 is in its aspect_ratio enum; 2K is the scale nearest 1536x2048.
const KREA_GPT_IMAGE_25_BODY_FIELDS = Object.freeze({
  aspect_ratio: ICONOPLASM_PORTRAIT_REQUEST_ASPECT_RATIO,
  resolution: "2K",
  quality: "high",
})

export const ICONOPLASM_IMAGE_EDIT_PROVIDER_DEFINITIONS = Object.freeze({
  comfyui: Object.freeze({
    provider_id: "comfyui",
    label: "ComfyUI Workstation",
    default_endpoint_url: "",
    default_model: "flux-3-klein",
    free_queue: true,
    capabilities: Object.freeze(["edit"]),
    model_options: Object.freeze([
      Object.freeze({
        model: "flux-3-klein",
        label: "(Free) FLUX.3 Klein",
        pricing_label: "Free · queued",
        free_queue: true,
        edit_capable: true,
        generate_capable: false,
      }),
      Object.freeze({
        model: "qwen-image-2.1-turbo",
        label: "(Free) Qwen-Image-2.1 Turbo",
        pricing_label: "Free · queued",
        free_queue: true,
        edit_capable: true,
        generate_capable: false,
      }),
    ]),
  }),
  // Checked against OpenAI's own docs on 2026-10-03
  // (developers.openai.com/api/docs/guides/image-generation, /models/gpt-image-2.5-*,
  // /deprecations): the guide's current models are the two GPT Image 2.5 models.
  // Both bill by token (image output $30 per million tokens) and OpenAI publishes no
  // per-image estimate for them, so no per-image price is claimed.
  openai: Object.freeze({
    provider_id: "openai",
    label: "OpenAI API",
    default_endpoint_url: "https://api.openai.com/v1",
    default_model: "gpt-image-2.5-sunburst",
    capabilities: Object.freeze(["edit", "generate"]),
    model_options: Object.freeze([
      Object.freeze({
        model: "gpt-image-2.5-sunburst",
        label: "GPT Image 2.5 Sunburst",
        pricing_label: "Per token, $30/M image output",
        image_size: ICONOPLASM_OPENAI_PORTRAIT_REQUEST_SIZE,
        image_quality: "high",
        estimated_seconds: 180,
        edit_capable: true,
        generate_capable: true,
      }),
      Object.freeze({
        model: "gpt-image-2.5-flare",
        label: "GPT Image 2.5 Flare",
        pricing_label: "Per token, $30/M image output",
        image_size: ICONOPLASM_OPENAI_PORTRAIT_REQUEST_SIZE,
        image_quality: "high",
        estimated_seconds: 90,
        edit_capable: true,
        generate_capable: true,
      }),
    ]),
  }),
  krea: Object.freeze({
    provider_id: "krea",
    label: "Krea API",
    default_endpoint_url: "https://api.krea.ai",
    default_model: "google/nano-banana-2",
    capabilities: Object.freeze(["edit", "generate"]),
    // Source of truth: https://www.krea.ai/docs/api-reference/image/ and
    // https://api.krea.ai/openapi.json (docs.krea.ai redirects there). Compiled by
    // hand from each model's docs page (--url line + body schema), re-checked
    // 2026-10-03. When this list drifts from Krea, re-check the docs page for the
    // model and update both the model id and the request-shape fields.
    //
    // A model stays here only while Krea lists it as current and no vendor label
    // (deprecated, retired, "legacy", "earlier") applies to it.
    //
    // `requires_krea_asset_upload`: when true, the worker uploads the source
    // image to Krea's /assets endpoint (multipart/form-data) and uses the
    // returned Krea-hosted image_url as the source. This is the only reliable
    // way to feed source bytes to the nano-banana family and the
    // `image_urls[]` style inputs: passing our CDN URL directly caused the
    // "edit returns a completely new image" bug because Krea's inference
    // servers could not reach `iconoplasmportraits.b-cdn.net` and silently
    // generated a fresh image from the prompt alone.
    model_options: Object.freeze([
      Object.freeze({
        model: "google/nano-banana-pro",
        label: "Nano Banana Pro",
        endpoint_path: "/generate/image/google/nano-banana-pro",
        pricing_label: "$0.15–$0.30/request (1K–4K)",
        estimated_seconds: 45,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        supports_aspect_ratio: true,
        aspect_ratio_options: Object.freeze([
          "21:9",
          "1:1",
          "4:3",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
          "3:4",
          "16:9",
          "9:16",
        ]),
        requires_krea_asset_upload: true,
      }),
      Object.freeze({
        model: "google/nano-banana-2",
        label: "Nano Banana 2",
        endpoint_path: "/generate/image/google/nano-banana-2",
        pricing_label: "$0.08–$0.16/request (1K–4K)",
        estimated_seconds: 30,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        supports_aspect_ratio: true,
        aspect_ratio_options: Object.freeze([
          "4:1",
          "21:9",
          "1:1",
          "4:3",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
          "3:4",
          "16:9",
          "9:16",
          "1:4",
          "1:8",
        ]),
        requires_krea_asset_upload: true,
      }),
      Object.freeze({
        model: "z-image/z-image",
        label: "Z Image",
        endpoint_path: "/generate/image/z-image/z-image",
        pricing_label: "$0.003/request",
        estimated_seconds: 10,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_url",
        edit_strength_param: "denoising_strength",
        // Krea's Z Image default denoising_strength is 0.6. 0.85 was
        // basically "regenerate, lightly reference the source." 0.5
        // produces a real edit that preserves the source.
        edit_strength_default: 0.5,
        edit_image_object_shape: "string",
        // B-916: Krea's schema (checked 2026-10-03) requires aspect_ratio and
        // resolution, offers no width or height, and rejects unknown keys. Its
        // aspect_ratio enum has no 3:4 and 2:3 is the nearest portrait; resolution
        // is 1K only.
        body_fields: Object.freeze({ aspect_ratio: "2:3", resolution: "1K" }),
        requires_krea_asset_upload: true,
      }),
      // B-916: current models added 2026-10-03 from the Krea API reference
      // (www.krea.ai/docs/api-reference/image/<slug> and api.krea.ai/openapi.json).
      // Their schemas set additionalProperties: false, so the body is exactly
      // `prompt`, the source image, and the documented `body_fields` below; an
      // extra key is a 400. `edit_body_fields` apply only when a source image is
      // attached.
      //
      // Ideogram 4.5: aspect_ratio has no 3:4, and 4:5 is the nearest value.
      // preserve_source_size keeps the source image's own size on an edit.
      Object.freeze({
        model: "ideogram/ideogram-4.5",
        label: "Ideogram 4.5",
        endpoint_path: "/generate/image/ideogram/ideogram-4.5",
        pricing_label: "$0.06/request (medium)",
        estimated_seconds: 45,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        body_fields: Object.freeze({
          aspect_ratio: "4:5",
          resolution: "2K",
          quality: "medium",
          skip_prompt_expansion: true,
        }),
        edit_body_fields: Object.freeze({ preserve_source_size: true }),
        requires_krea_asset_upload: true,
      }),
      // Ideogram 4.5 Precise is Krea's edit-only endpoint: it keeps the source
      // resolution and the surrounding detail. image_url is required.
      Object.freeze({
        model: "ideogram/ideogram-4.5-precise",
        label: "Ideogram 4.5 Precise",
        endpoint_path: "/generate/image/ideogram/ideogram-4.5-precise",
        pricing_label: "$0.06/request (medium)",
        estimated_seconds: 45,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_url",
        edit_image_object_shape: "string",
        edit_requires_image: true,
        body_fields: Object.freeze({ quality: "medium" }),
        requires_krea_asset_upload: true,
      }),
      // GPT Image 2.5, two tiers (OpenAI's current image models). aspect_ratio and
      // resolution are required by the schema; 3:4 is in its aspect_ratio enum and
      // 2K is the scale nearest the portrait's 1536x2048 target. Krea shows no price.
      Object.freeze({
        model: "openai/gpt-image-2.5-sunburst",
        label: "GPT Image 2.5 Sunburst",
        endpoint_path: "/generate/image/openai/gpt-image-2.5-sunburst",
        pricing_label: "—",
        estimated_seconds: 180,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        body_fields: KREA_GPT_IMAGE_25_BODY_FIELDS,
        requires_krea_asset_upload: true,
      }),
      Object.freeze({
        model: "openai/gpt-image-2.5-flare",
        label: "GPT Image 2.5 Flare",
        endpoint_path: "/generate/image/openai/gpt-image-2.5-flare",
        pricing_label: "—",
        estimated_seconds: 90,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        body_fields: KREA_GPT_IMAGE_25_BODY_FIELDS,
        requires_krea_asset_upload: true,
      }),
      // Nano Banana 2 Lite (Krea's ID is nano-banana-flash-lite). Its aspect_ratio
      // enum includes 3:4 and it has no resolution field.
      Object.freeze({
        model: "google/nano-banana-flash-lite",
        label: "Nano Banana 2 Lite",
        endpoint_path: "/generate/image/google/nano-banana-flash-lite",
        pricing_label: "$0.034/request",
        estimated_seconds: 15,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        supports_aspect_ratio: true,
        aspect_ratio_options: Object.freeze([
          "21:9",
          "1:1",
          "4:3",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
          "3:4",
          "16:9",
          "9:16",
        ]),
        requires_krea_asset_upload: true,
      }),
      Object.freeze({
        model: "bytedance/seededit",
        label: "SeedEdit",
        endpoint_path: "/generate/image/bytedance/seededit",
        pricing_label: "—",
        estimated_seconds: 20,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_url",
        edit_image_object_shape: "string",
        edit_requires_image: true,
        // SeedEdit's body schema is exactly {prompt, seed, image_url}; any
        // size key (width/height/aspect_ratio/resolution) is rejected as
        // "Unrecognized key(s) in object". Let Krea pick dimensions from
        // the source image.
        body_omits_size: true,
        requires_krea_asset_upload: true,
      }),
      Object.freeze({
        model: "runway/gen-4-image",
        label: "Runway Gen-4",
        endpoint_path: "/generate/image/runway/gen-4-image",
        pricing_label: "—",
        estimated_seconds: 60,
        // Runway Gen-4 caps the prompt at 1000 chars. The shared Iconoplasm
        // edit prompt template is ~1500 chars (suffix + per-adjustment
        // text). Truncating the prompt would silently drop the user's edit
        // instructions, and there is no per-model prompt override path
        // today. Hide from the edit dialog until we add a short-prompt
        // path for Runway specifically.
        edit_capable: false,
        generate_capable: false,
        edit_image_param: "reference_images",
        edit_image_object_shape: "object-array",
        edit_reference_tag: "source",
        edit_requires_image: true,
        requires_krea_asset_upload: true,
      }),
      Object.freeze({
        model: "qwen/2512",
        label: "Qwen 2512",
        endpoint_path: "/generate/image/qwen/2512",
        pricing_label: "$0.019/request",
        estimated_seconds: 20,
        edit_capable: false,
        generate_capable: true,
      }),
      Object.freeze({
        model: "bytedance/seedream-5-lite",
        label: "Seedream 5 Lite",
        endpoint_path: "/generate/image/bytedance/seedream-5-lite",
        pricing_label: "$0.037/request",
        estimated_seconds: 15,
        edit_capable: false,
        generate_capable: true,
      }),
      Object.freeze({
        model: "luma/uni-1",
        label: "Luma UNI-1 (Krea)",
        endpoint_path: "/generate/image/luma/uni-1",
        pricing_label: "$0.040–$0.127/request (by reference count)",
        estimated_seconds: 30,
        edit_capable: false,
        generate_capable: true,
      }),
      Object.freeze({
        model: "krea/krea-2/large",
        label: "Krea 2 Large",
        endpoint_path: "/generate/image/krea/krea-2/large",
        pricing_label: "$0.060/request",
        estimated_seconds: 30,
        edit_capable: false,
        generate_capable: true,
        // Krea 2 rejects arbitrary dimensions; aspect_ratio is required.
        // 3:4 is NOT in the enum, 4:5 is the closest.
        request_width: 928,
        request_height: 1152,
      }),
      Object.freeze({
        model: "krea/krea-2/medium",
        label: "Krea 2 Medium",
        endpoint_path: "/generate/image/krea/krea-2/medium",
        pricing_label: "—",
        estimated_seconds: 20,
        edit_capable: false,
        generate_capable: true,
        request_width: 928,
        request_height: 1152,
      }),
      Object.freeze({
        model: "krea/krea-2/medium-turbo",
        label: "Krea 2 Medium Turbo",
        endpoint_path: "/generate/image/krea/krea-2/medium-turbo",
        pricing_label: "—",
        estimated_seconds: 10,
        edit_capable: false,
        generate_capable: true,
        request_width: 928,
        request_height: 1152,
      }),
    ]),
  }),
  gemini: Object.freeze({
    provider_id: "gemini",
    label: "Gemini API",
    default_endpoint_url: "https://generativelanguage.googleapis.com/v1beta",
    default_model: "gemini-3.1-flash-image",
    capabilities: Object.freeze(["edit", "generate"]),
    model_options: Object.freeze([
      Object.freeze({
        model: "gemini-3.1-flash-image",
        label: "Gemini 3.1 Flash Image",
        pricing_label: "~$0.067/image",
        aspect_ratio: ICONOPLASM_PORTRAIT_REQUEST_ASPECT_RATIO,
        image_size: "1K",
        edit_capable: true,
        generate_capable: true,
      }),
      Object.freeze({
        model: "gemini-3-pro-image",
        label: "Gemini 3 Pro Image",
        pricing_label: "$0.134/image",
        aspect_ratio: ICONOPLASM_PORTRAIT_REQUEST_ASPECT_RATIO,
        image_size: "1K",
        edit_capable: true,
        generate_capable: true,
      }),
      // B-916: stable since 2026-06-30 per ai.google.dev/gemini-api/docs/changelog
      // and /models/gemini-3.1-flash-lite-image (checked 2026-10-03). 1K only,
      // 3:4 is in its aspect-ratio list, $0.0336 per 1K image on the pricing page.
      Object.freeze({
        model: "gemini-3.1-flash-lite-image",
        label: "Gemini 3.1 Flash Lite Image",
        pricing_label: "~$0.034/image",
        aspect_ratio: ICONOPLASM_PORTRAIT_REQUEST_ASPECT_RATIO,
        image_size: "1K",
        edit_capable: true,
        generate_capable: true,
      }),
    ]),
  }),
  luma: Object.freeze({
    provider_id: "luma",
    label: "Luma Uni API",
    default_endpoint_url: "https://agents.lumalabs.ai/v1",
    default_model: "uni-1",
    capabilities: Object.freeze(["edit", "generate"]),
    model_options: Object.freeze([
      // aspect_ratio is the generation-only value: Luma's image guide lists nine
      // ratios (3:1, 2:1, 16:9, 3:2, 1:1, 2:3, 9:16, 1:2, 1:3), so 2:3 is the
      // documented portrait nearest the portrait's 3:4. Prices are the edit rates on
      // docs.agents.lumalabs.ai/guides/pricing (checked 2026-10-03).
      Object.freeze({
        model: "uni-1",
        label: "Uni 1.1",
        pricing_label: "$0.043/image",
        output_format: "png",
        aspect_ratio: "2:3",
        estimated_seconds: 75,
        edit_capable: true,
        generate_capable: true,
      }),
      Object.freeze({
        model: "uni-1-max",
        label: "Uni 1.1 Max",
        pricing_label: "$0.103/image",
        output_format: "png",
        aspect_ratio: "2:3",
        estimated_seconds: 95,
        edit_capable: true,
        generate_capable: true,
      }),
    ]),
  }),
  fal: Object.freeze({
    provider_id: "fal",
    label: "Fal.ai",
    default_endpoint_url: "https://queue.fal.run",
    default_model: "fal-ai/nano-banana-pro/edit",
    capabilities: Object.freeze(["edit", "generate"]),
    // Checked 2026-10-03 against each model's own page (fal.ai/models/<id>/llms.txt
    // and the model's OpenAPI at fal.ai/api/openapi/queue/openapi.json). Every ID
    // below reports status "active" on api.fal.ai/v1/models. fal publishes no sunset
    // date or successor for image models, so a model leaves this list when its own
    // vendor labels it deprecated, retired, "legacy" or "earlier".
    // Gemini excluded: not used through Krea either.
    //
    // `request_fields` is the exact set of fixed fields sent with the prompt and
    // the source image, so a model's request is read off one place and compared
    // with its documented schema by the golden tests.
    model_options: Object.freeze([
      // ── Edit (image → image) ──────────────────────────────────────
      Object.freeze({
        model: "fal-ai/nano-banana-pro/edit",
        label: "Nano Banana Pro Edit",
        pricing_label: "$0.15/image",
        estimated_seconds: 45,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        supports_aspect_ratio: true,
        request_fields: FAL_NANO_BANANA_REQUEST_FIELDS,
        // B-617: Fal's Nano Banana edit models answer the
        // remove_ai_generation_errors operation with no_media_generated /
        // content_policy_violation, so never submit a request that
        // predictably fails. The dialog hides the adjustment for this model.
        incompatible_adjustments: Object.freeze(["remove_ai_generation_errors"]),
      }),
      Object.freeze({
        model: "fal-ai/nano-banana-2/edit",
        label: "Nano Banana 2 Edit",
        pricing_label: "$0.08/image",
        estimated_seconds: 30,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        supports_aspect_ratio: true,
        request_fields: FAL_NANO_BANANA_REQUEST_FIELDS,
        // B-617: same Nano Banana moderation behavior as the Pro edit model.
        incompatible_adjustments: Object.freeze(["remove_ai_generation_errors"]),
      }),
      // B-916: google/nano-banana-lite is Nano Banana 2 Lite (Gemini 3.1 Flash Lite
      // Image). The edit endpoint takes image_urls; output is a fixed 1K, and
      // aspect_ratio defaults to auto, which follows the source image.
      Object.freeze({
        model: "google/nano-banana-lite/edit",
        label: "Nano Banana 2 Lite Edit",
        pricing_label: "Per token, fixed 1K output",
        estimated_seconds: 15,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: Object.freeze({ num_images: 1, output_format: "png" }),
      }),
      // B-916: Flux 3 Image, released 2026-10-01 (release notes at docs.bfl.ml).
      // fal's endpoint takes image_urls (1 to 10) and treats aspect_ratio "auto" as
      // the first reference image, so an edit keeps the portrait's 3:4 frame. "2k" is
      // the tier nearest the portrait's 1536x2048 target. The launch price is 50% off
      // until 2026-10-08.
      Object.freeze({
        model: "blackforestlabs/flux-3/edit-image",
        label: "Flux 3 Edit",
        pricing_label: "From $0.0205/image (launch rate to Oct 8)",
        estimated_seconds: 30,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: Object.freeze({ resolution: "2k", output_format: "png" }),
      }),
      Object.freeze({
        model: "fal-ai/flux-2/edit",
        label: "Flux 2 Edit",
        pricing_label: "$0.012/MP",
        estimated_seconds: 15,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: FAL_STANDARD_REQUEST_FIELDS,
      }),
      // B-916: Ideogram 4.5 edit. edit_precision "high" is fal's Precise Edit, which
      // restores unchanged pixels, so only the asked-for region moves. The source is
      // a single image_url string; the output keeps the source size (image_size
      // auto). Price depends on quality, not size.
      Object.freeze({
        model: "ideogram/v4.5/edit",
        label: "Ideogram 4.5 Edit",
        pricing_label: "$0.06/image (medium)",
        estimated_seconds: 45,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_url",
        edit_image_object_shape: "string",
        request_fields: Object.freeze({ edit_precision: "high", quality: "medium", num_images: 1 }),
      }),
      // B-916: GPT Image 2.5, two tiers, token-billed at the same rates as GPT
      // Image 2. image_size "auto" infers the size from the source image.
      Object.freeze({
        model: "openai/gpt-image-2.5/sunburst/edit",
        label: "GPT Image 2.5 Sunburst Edit",
        pricing_label: "Per token, $30/M image output",
        estimated_seconds: 180,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: FAL_GPT_IMAGE_EDIT_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "openai/gpt-image-2.5/flare/edit",
        label: "GPT Image 2.5 Flare Edit",
        pricing_label: "Per token, $30/M image output",
        estimated_seconds: 90,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: FAL_GPT_IMAGE_EDIT_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "bytedance/seedream/v5/pro/edit",
        label: "Seedream 5 Pro Edit",
        pricing_label: "~$0.135/image (2K, tentative)",
        estimated_seconds: 45,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: FAL_SEEDREAM_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "bytedance/seedream/v5/lite/edit",
        label: "Seedream 5 Lite Edit",
        pricing_label: "$0.035/image",
        estimated_seconds: 25,
        edit_capable: true,
        generate_capable: false,
        edit_image_param: "image_urls",
        edit_image_object_shape: "string-array",
        request_fields: FAL_SEEDREAM_LITE_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "fal-ai/omnigen-v2",
        label: "OmniGen v2",
        pricing_label: "$0.15/MP",
        estimated_seconds: 60,
        edit_capable: true,
        generate_capable: true,
        edit_image_param: "input_image_urls",
        edit_image_object_shape: "string-array",
        request_fields: FAL_STANDARD_REQUEST_FIELDS,
      }),
      // ── Generate (text → image) ──────────────────────────────────
      Object.freeze({
        model: "fal-ai/nano-banana-pro",
        label: "Nano Banana Pro",
        pricing_label: "$0.15/image",
        estimated_seconds: 45,
        edit_capable: false,
        generate_capable: true,
        supports_aspect_ratio: true,
        request_fields: FAL_NANO_BANANA_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "fal-ai/nano-banana-2",
        label: "Nano Banana 2",
        pricing_label: "$0.08/image",
        estimated_seconds: 30,
        edit_capable: false,
        generate_capable: true,
        supports_aspect_ratio: true,
        request_fields: FAL_NANO_BANANA_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "google/nano-banana-lite",
        label: "Nano Banana 2 Lite",
        pricing_label: "Per token, fixed 1K output",
        estimated_seconds: 15,
        edit_capable: false,
        generate_capable: true,
        request_fields: Object.freeze({ aspect_ratio: "3:4", num_images: 1, output_format: "png" }),
      }),
      Object.freeze({
        model: "blackforestlabs/flux-3/text-to-image",
        label: "Flux 3",
        pricing_label: "From $0.0205/image (launch rate to Oct 8)",
        estimated_seconds: 30,
        edit_capable: false,
        generate_capable: true,
        request_fields: Object.freeze({
          aspect_ratio: "3:4",
          resolution: "2k",
          output_format: "png",
        }),
      }),
      Object.freeze({
        model: "fal-ai/flux-2",
        label: "Flux 2",
        pricing_label: "$0.012/MP",
        estimated_seconds: 15,
        edit_capable: false,
        generate_capable: true,
        request_fields: FAL_STANDARD_REQUEST_FIELDS,
      }),
      // portrait_4_3 is fal's 864x1152 preset for Ideogram 4.5, the closest the
      // model offers to 3:4. Prompt expansion is off so the portrait prompt is used as
      // written.
      Object.freeze({
        model: "ideogram/v4.5",
        label: "Ideogram 4.5",
        pricing_label: "$0.06/image (medium)",
        estimated_seconds: 45,
        edit_capable: false,
        generate_capable: true,
        request_fields: Object.freeze({
          image_size: "portrait_4_3",
          quality: "medium",
          enable_prompt_expansion: false,
          num_images: 1,
        }),
      }),
      Object.freeze({
        model: "openai/gpt-image-2.5/sunburst/text-to-image",
        label: "GPT Image 2.5 Sunburst",
        pricing_label: "Per token, $30/M image output",
        estimated_seconds: 180,
        edit_capable: false,
        generate_capable: true,
        request_fields: FAL_GPT_IMAGE_GENERATE_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "openai/gpt-image-2.5/flare/text-to-image",
        label: "GPT Image 2.5 Flare",
        pricing_label: "Per token, $30/M image output",
        estimated_seconds: 90,
        edit_capable: false,
        generate_capable: true,
        request_fields: FAL_GPT_IMAGE_GENERATE_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "bytedance/seedream/v5/pro/text-to-image",
        label: "Seedream 5 Pro",
        pricing_label: "~$0.135/image (2K, tentative)",
        estimated_seconds: 45,
        edit_capable: false,
        generate_capable: true,
        request_fields: FAL_SEEDREAM_REQUEST_FIELDS,
      }),
      Object.freeze({
        model: "bytedance/seedream/v5/lite/text-to-image",
        label: "Seedream 5 Lite",
        pricing_label: "$0.035/image",
        estimated_seconds: 25,
        edit_capable: false,
        generate_capable: true,
        request_fields: FAL_SEEDREAM_LITE_REQUEST_FIELDS,
      }),
    ]),
  }),
})

export function normalizeImageEditProviderId(raw) {
  const providerId = String(raw || "")
    .trim()
    .toLowerCase()
  if (providerId === "openai") return "openai"
  if (providerId === "google" || providerId === "google-gemini") return "gemini"
  if (providerId === "luma-ai" || providerId === "lumaai" || providerId === "luma-agents")
    return "luma"
  if (providerId === "fal-ai" || providerId === "falai") return "fal"
  return ICONOPLASM_IMAGE_EDIT_PROVIDER_DEFINITIONS[providerId] ? providerId : ""
}

export function imageEditProviderDefinition(providerId) {
  const normalized = normalizeImageEditProviderId(providerId)
  return normalized ? ICONOPLASM_IMAGE_EDIT_PROVIDER_DEFINITIONS[normalized] : null
}

function boundedModelText(raw, maxLen = 128) {
  return String(raw || "")
    .trim()
    .slice(0, maxLen)
}

export function extractComfyuiEditModelSlug(rawVisionId) {
  const value = boundedModelText(rawVisionId, 255)
  if (!value) return ""
  return /^comfyui-edit:/i.test(value) ? value.slice("comfyui-edit:".length).trim() : ""
}

export function stripImageEditFreePrefix(rawLabel) {
  return String(rawLabel || "")
    .trim()
    .replace(/^\s*\(Free\)\s+/i, "")
    .replace(/\s*\(Free\)\s*$/i, "")
    .trim()
}

function findCatalogOption(modelId, preferredProviderId = "") {
  const cleanModel = boundedModelText(modelId, 128)
  if (!cleanModel) return null
  const preferredDef = imageEditProviderDefinition(preferredProviderId)
  const defsToSearch = preferredDef
    ? [
        preferredDef,
        ...Object.values(ICONOPLASM_IMAGE_EDIT_PROVIDER_DEFINITIONS).filter(
          (def) => def.provider_id !== preferredDef.provider_id,
        ),
      ]
    : Object.values(ICONOPLASM_IMAGE_EDIT_PROVIDER_DEFINITIONS)
  for (const def of defsToSearch) {
    const options = Array.isArray(def?.model_options) ? def.model_options : []
    const exact = options.find((opt) => opt?.model === cleanModel)
    if (exact) return { providerDef: def, option: exact }
    const caseInsensitive = options.find(
      (opt) => String(opt?.model || "").toLowerCase() === cleanModel.toLowerCase(),
    )
    if (caseInsensitive) return { providerDef: def, option: caseInsensitive }
  }
  return null
}

/**
 * Resolves the canonical provider ID, model slug, and human display label
 * from stored edit job columns, queued request vision IDs, or Drain
 * fulfillment provenance. Never invents a default model when none was recorded.
 */
export function resolveImageEditModelPresentation({
  providerId = "",
  model = "",
  fulfilledProviderId = "",
  fulfilledModelId = "",
  fulfilledVisionId = "",
  requestedVisionId = "",
} = {}) {
  const explicitProvider = normalizeImageEditProviderId(providerId || fulfilledProviderId)
  const fulfilledSlug = extractComfyuiEditModelSlug(fulfilledVisionId)
  const requestedSlug = extractComfyuiEditModelSlug(requestedVisionId)
  const candidates = [
    boundedModelText(model, 128),
    boundedModelText(fulfilledModelId, 128),
    fulfilledSlug,
    requestedSlug,
  ].filter(Boolean)

  for (const candidate of candidates) {
    const match = findCatalogOption(candidate, explicitProvider)
    if (match) {
      const optionLabel = String(match.option?.label || "").trim()
      return {
        provider_id: match.providerDef.provider_id,
        provider_label: String(match.providerDef.label || "").trim(),
        model: match.option.model,
        option_label: optionLabel,
        model_label: stripImageEditFreePrefix(optionLabel) || match.option.model,
      }
    }
  }

  const fallbackModel = candidates[0] || ""
  const resolvedProviderId = explicitProvider || (fulfilledSlug || requestedSlug ? "comfyui" : "")
  const resolvedProviderDef = imageEditProviderDefinition(resolvedProviderId)
  return {
    provider_id: resolvedProviderId,
    provider_label: String(resolvedProviderDef?.label || "").trim(),
    model: fallbackModel,
    option_label: "",
    model_label: stripImageEditFreePrefix(fallbackModel),
  }
}
