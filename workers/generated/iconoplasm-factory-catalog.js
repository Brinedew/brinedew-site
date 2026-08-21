// Generated public projection of the workstation's immutable factory registry.
// The website owns the active pointer; this catalog only describes accepted
// executable definitions and is verified against the workstation registry.
export const ICONOPLASM_FACTORY_CATALOG = Object.freeze({
  schema_version: 1,
  pipelines: Object.freeze([
    Object.freeze({ code: "A", label: "Aesthetic 1.1", model: "anima-aesthetic-v1.1.safetensors", steps: 38, cfg: 3.5, sampler: "dpmpp_2m_sde_gpu", recommended_vision: 4, status: "accepted" }),
    Object.freeze({ code: "B", label: "Aesthetic 1.0b", model: "anima-aesthetic-v1.0b.safetensors", steps: 36, cfg: 3.2, sampler: "dpmpp_2m_sde_gpu", recommended_vision: 4, status: "accepted" }),
    Object.freeze({ code: "C", label: "Preview 3", model: "anima-preview3-base.safetensors", steps: 30, cfg: 4, sampler: "er_sde", recommended_vision: 7, status: "accepted" }),
    Object.freeze({ code: "D", label: "Base 1.0", model: "anima-base-v1.0.safetensors", steps: 40, cfg: 4.5, sampler: "dpmpp_2m_sde_gpu", recommended_vision: 7, status: "accepted" }),
    Object.freeze({ code: "E", label: "Turbo 1.0", model: "anima-turbo-v1.0.safetensors", steps: 10, cfg: 1, sampler: "euler", recommended_vision: 8, status: "accepted" }),
  ]),
  visions: Object.freeze([
    Object.freeze({ revision: 1, label: "Vision 1 · Aesthetic", source_id: "artist-random-anima", prompt_content_mode: "tags_only", prompt_order_mode: "manifestation_then_vision", status: "accepted" }),
    Object.freeze({ revision: 2, label: "Vision 2 · Preview / Base", source_id: "artist-random-anima-preview-base", prompt_content_mode: "tags_only", prompt_order_mode: "vision_then_manifestation", status: "accepted" }),
    Object.freeze({ revision: 3, label: "Vision 3 · Turbo", source_id: "artist-random-anima-turbo", prompt_content_mode: "full_manifestation", prompt_order_mode: "vision_then_manifestation", status: "accepted" }),
    Object.freeze({ revision: 4, label: "Vision 4 · Aesthetic corrected", source_id: "aesthetic-prompt-policy-corrected", prompt_content_mode: "tags_only", prompt_order_mode: "manifestation_then_vision", status: "accepted" }),
    Object.freeze({ revision: 5, label: "Vision 5 · Preview / Base superseded", source_id: "preview-and-base-prompt-policy-corrected", prompt_content_mode: "tags_only", prompt_order_mode: "manifestation_then_vision", status: "accepted" }),
    Object.freeze({ revision: 6, label: "Vision 6 · Turbo superseded", source_id: "turbo-prompt-policy-corrected", prompt_content_mode: "tags_only", prompt_order_mode: "manifestation_then_vision", status: "accepted" }),
    Object.freeze({ revision: 7, label: "Vision 7 · Preview / Base corrected", source_id: "preview-and-base-corrected", prompt_content_mode: "tags_only", prompt_order_mode: "vision_then_manifestation", status: "accepted" }),
    Object.freeze({ revision: 8, label: "Vision 8 · Turbo corrected", source_id: "turbo-corrected", prompt_content_mode: "full_manifestation", prompt_order_mode: "vision_then_manifestation", status: "accepted" }),
  ]),
})
