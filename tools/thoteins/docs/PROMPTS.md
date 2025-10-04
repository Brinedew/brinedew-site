# Prompt Templates

The Prompter ships with a deterministic, magazine‑style template. You can modify this in the UI; this file captures the default for reference.

## Default Template

```
Editorial magazine cover portrait photo. Magazine title: "{symbol} MONTHLY".
Subject: {age} year old {gender}, {height} cm tall, {ethnicity} appearance, {hair_color} hair, {expression} expression, wearing {clothing_style} with {accessories_count} accessories, {pose_description}, {background_setting}.
Professional studio lighting, high fashion photography style, sharp focus on face, shallow depth of field.
Subheads: {title}; {domains}.
```

## Deterministic Placeholders
- The Prompter uses a seeded PRNG (xmur3 + mulberry32) per UniProt ID to generate consistent human placeholders (`age`, `gender`, etc.).
- The `background_setting` is filled from mapping/persona when available, falling back to a location‑based classifier.

