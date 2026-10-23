---
title: "Generate with your own key"
description: "Save your key and emulsion in the settings, then generate a candidate in 1-2 minutes."
docsSection: Your own image key
docsOrder: 2
docsLabel: "Generate with your key"
date: 2026-06-14
updated: 2026-10-23
draft: false
---

# Generate with your own key

## Configure your API key in Iconoplasm

The steps are the same regardless of which provider you chose.

1. Go to your [settings on Brinedew.bio](https://brinedew.bio/settings/) by clicking the gear icon in the right sidebar.![Your settings on Brinedew.bio](../Attachments/02-settings-openai.png)
2. Under **Image APIs**, set **Provider** to your chosen provider (OpenAI API, Krea API, Gemini API, Luma Uni API, or Fal.ai).
3. Paste the key that you copied from your provider into the **API key** field.
4. Select a **Model** using the dropdown menu. There's no wrong choice: experiment and see which model matches your taste. High-quality models are usually more expensive.
5. Click **Save API**.

## Configure your emulsion

The emulsion is a short text prompt (max 140 characters) that sets the visual style and atmosphere for every portrait that you generate.

1. On the same Settings page, under **Iconoplasm** → **Emulsion**, find the **Text** field.
2. Enter a description of the rendering style that you want for the new images that you request — for example: *"Real casual chaotic iphone snapshot photo from 2010s."*
3. Click **Save emulsion**.

Your saved emulsion appears in the **Load version** dropdown. You can keep multiple drafts.

## Generate a candidate with your key

1. Under the current portrait, click the **New candidate** button in the bottom right.
   ![[image-37.png|Current portrait with the New candidate button in the bottom right.]]
2. In the dialog, click the **Image API** tab:
   ![[image-38.png|The menu that opens from the New candidate button]] 
3. In the **Provider** selector, you should see your newly added provider (e.g. **OpenAI API · gpt-image-2**).
4. Keep the "emulsion" field empty, or click it to select the emulsion that you saved in the user settings.
5. Keep "Prose" to send the gene's full description to the model as a prose prompt. If your image model works best with a prompt in the form of a tag cloud, switch the selector to "Tags".
6. Click the **Generate candidate** button.
7. Wait 1-2 minutes for the new image to appear in the same dialog box.
8. Click **Publish candidate** to add the new image to the gene's candidate list.

If your provider requires billing that hasn't been set up yet, you will see this message in the dialog: **"Billing hard limit has been reached."**
