CREATE TABLE IF NOT EXISTS icono_factory_vision_definitions (
  revision INTEGER PRIMARY KEY CHECK (revision > 0),
  source_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  positive_prefix TEXT NOT NULL,
  negative_prompt TEXT NOT NULL,
  prompt_content_mode TEXT NOT NULL CHECK (prompt_content_mode IN ('tags_only', 'full_manifestation')),
  prompt_order_mode TEXT NOT NULL CHECK (prompt_order_mode IN ('manifestation_then_vision', 'vision_then_manifestation')),
  prompt_replace_underscores INTEGER NOT NULL DEFAULT 0 CHECK (prompt_replace_underscores IN (0, 1)),
  emulsion_base_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'retired')),
  accepted_by TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO icono_factory_vision_definitions (
  revision, source_id, label, source_sha256, positive_prefix, negative_prompt,
  prompt_content_mode, prompt_order_mode, prompt_replace_underscores,
  emulsion_base_id, status, accepted_by
) VALUES
  (1, 'artist-random-anima', 'Vision 1 · Aesthetic', '6ff2eb1941f6647f0ac20b85bcf88daf8d5b40dc972b676dfb7fc6b30cde4e48', 'masterwork, safe,

@random, environmental storytelling, solo, off-center, unusual composition, in-universe location, canon event, atmospheric perspective, indoors, outdoors,', 'text focus, watermark, signature, banner, bad anatomy, bad hands, extra digits, fewer digits, 2girls, 2boys, monochrome background, simple background, straight-on, tachi-e, furry, multiple views, reference sheet, turnaround, variations, character profile, comic, collage, empty room,', 'tags_only', 'manifestation_then_vision', 0, 'artist-random-anima', 'accepted', 'migration'),
  (2, 'artist-random-anima-preview-base', 'Vision 2 · Preview / Base', '921fd6283fab07ec022e7ed4c69fa9ad67000f45635543fc280180ace17f0c99', 'masterpiece, best quality, score_7, safe,

@random, environmental storytelling, solo, off-center, unusual composition, in-universe location, canon event, atmospheric perspective, indoors, outdoors,', 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration, text focus, watermark, signature, banner, bad anatomy, bad hands, extra digits, fewer digits, 2girls, 2boys, monochrome background, simple background, straight-on, tachi-e, furry, multiple views, reference sheet, turnaround, variations, character profile, comic, collage, empty room,', 'tags_only', 'vision_then_manifestation', 1, 'artist-random-anima', 'accepted', 'migration'),
  (3, 'artist-random-anima-turbo', 'Vision 3 · Turbo', '8ab0ec0b2b7bb6fa26c0add0d53cccc40afba322989ea40ee37a0262df104123', 'masterpiece, best quality, safe,

@random, one clearly readable subject, fully clothed, coherent anatomy, coherent hands, detailed environmental storytelling, off-center composition, in-universe location, canon event, atmospheric perspective,', 'text focus, watermark, signature, banner, extra digits, fewer digits, 2girls, 2boys, monochrome background, simple background, straight-on, tachi-e, furry, multiple views, reference sheet, turnaround, variations, character profile, comic, collage, empty room,', 'full_manifestation', 'vision_then_manifestation', 1, 'artist-random-anima', 'accepted', 'migration');
