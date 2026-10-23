---
title: "Get an image API key"
description: "With your own key you get a portrait in 1-2 minutes, and you can edit portraits."
docsSection: Your own image key
docsOrder: 1
docsLabel: "Get a key"
date: 2026-06-14
updated: 2026-10-23
draft: false
---

# Get an image API key

Portraits from the free queue are drawn in turn. With your own key you get a portrait in 1-2 minutes, and you can edit portraits.

Iconoplasm sends your requests to generate images to a service run by a third party (API provider). Registering with the provider is free: the provider will only charge you around 1 to 10 cents per image when you actually start sending requests to generate images.

Prerequisites:
 * An email account
 * A bank card with $5 available on it

In this section, we will walk through the steps needed to register with a provider and obtain a key that you will need for image generation.
You only need to register with **one** of the supported providers: 
* Gemini API
* Krea API
* Luma Uni API
* OpenAI API
* fal.ai API

Your choice of provider might depend on how you prefer to pay, on discount offers, or on your aesthetic taste. There are no wrong choices. If you're unsure, visit the brinedew.bio Discord to ask other users what they think.
Below are the registration instructions for each provider.
## Gemini API

**Getting the key:**

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with your Google account.
3. Accept the terms of service if prompted.
4. Click **Create API key** in the top right menu.

![[image-35.png|The API Keys page in Google AI Studio — click "Create API key"]]

5. In the **Create a new key** dialog, give your key a name (e.g. "Iconoplasm") and pick a project.

![[image-36.png|Create a new key dialog]]

6. Click **Create key**.
7. The key appears in the table of your API keys. Copy it immediately.

**Adding funds.**

Gemini API used to have a Free tier for image generation, but the free tier has been **discontinued** for the `gemini-3.1-flash-image` model — you must set up billing to use it:
1. In the AI Studio sidebar, click **Billing**.
2. Click **Set up billing** — this links your billing account in Google Cloud.

![[image-41.png|Gemini billing — set up billing to use models that generate images]]

## Krea API

**Getting the key:**

1. Go to [krea.ai](https://www.krea.ai).
2. Click **Log in** at the top right.
3. Enter your email address and click **Continue with Email**.
4. A **Password** field appears. Enter your Krea password and click **Log in**.
5. After logging in, go to the [API Tokens](https://www.krea.ai/app/api/tokens) page.

![[image-31.png|The API Tokens page on Krea]]

6. On the API Tokens page, click **Create API Token**.
7. In the **Create a New Key** dialog that appears, give your key a name (e.g. "Iconoplasm") in the text field.

![[image-32.png|Create a new token dialog]]

8. Click **Create key**.
9. You see the key once, in the **Key Created Successfully** dialog. Click **Copy to clipboard** or **Copy & Close** — you can't see it again.

![[image-33.png|Key created — copy it immediately]]

**Adding funds:**

1. Go to the [Home](https://www.krea.ai/app/api) page of the Krea API.
   ![[image-40.png|Home page of the Krea API: the Agents section is visible below]]
2. Scroll down to the **Agents** section
3. Select a top-up amount: $10.00 (or click the **Custom** button and enter $5.00).
4. Click the **Add** button below — this opens a Stripe Checkout. Your balance updates immediately on success.

When your balance runs out, new requests will fail with an error message.

## Luma Uni API

**Getting the key:**

1. Go to [platform.lumalabs.ai](https://platform.lumalabs.ai).
2. Click **Sign in** at the top right (or **Sign up** if you don't have an account).
3. Sign in with your email address. If you don't have an account, enter your email and click **Continue**, then set a password.
4. Once logged in, you'll see the dashboard of the Luma API Console.

![[luma-api-console.png|Dashboard of the Luma API Console, with your balance, the number of API keys, and rate limits]]

5. In the left sidebar, click **API Keys**.

![[luma-api-keys.png|The API Keys page, with your existing keys and a Create Key button]]

6. On the API Keys page, click **Create Key**.
7. In the **Create API Key** dialog, give your key a name (e.g. "Iconoplasm") in the text field.

![[luma-create-key-dialog.png|Create API Key dialog — enter a name and click Create Key]]

8. Click **Create Key**. The key appears in the table of your API keys. Copy it immediately — you won't be able to see it again.

**Adding funds:**

You must add a card and top up your balance before making requests to Luma API.

1. In the left sidebar, click **Billing**.

![[luma-billing.png|The Billing page, with your balance and Add Card / Add Funds buttons]]

2. Click **Add Card** to save a payment method.
3. Click **Add Funds** to top up your balance. Enter the amount that you want to add and complete the payment.
4. Your balance updates immediately on success. When you generate an image, its cost is deducted from this balance; estimated costs are shown in the Pricing table below.

## OpenAI API

**Getting the key:**

1. Go to [platform.openai.com](https://platform.openai.com) and click **Sign up** or **Log in**.
2. Enter your email address and click **Continue**. OpenAI sends a 6-digit verification code to your inbox.
3. Check your email, enter the code, and click **Continue**.
4. Once logged in, go to [API Keys](https://platform.openai.com/api-keys).

![[image-29.png|The API Keys menu at OpenAI]]

5. Click the **Create new secret key** button at the top right.

![[image-30.png|The box for creating a key]]

6. In the dialog:
   - **Name**: Give your key a label (e.g. "Iconoplasm generation")
   - **Permissions**: Keep **All** selected
   - **Project**: Keep **Default project**
7. Click **Create secret key**.

![[16-openai-key-revealed.png|The key is shown once and must be copied immediately.]]
8. A **Save your key** dialog appears with your key. Copy it now — you can't see it again.
**Adding funds:**

GPT Image 2.5 has no free tier. If billing is not set up, you see this message in Iconoplasm: **"Billing hard limit has been reached."** You need a credit card on file. OpenAI bills you monthly for what you use.

9. Go to [Billing overview](https://platform.openai.com/settings/organization/billing/overview).
10. Click **Add payment details**.
11. A Stripe form for your credit card opens. Enter your **card number**, **expiration date** (MM/YY), and **CVC code**.


12. Click **Continue**. Your card is saved. You're billed monthly for actual usage.

## fal.ai API
1. Visit https://fal.ai/login and log in with one of the sign-in options on the page
![[image-44.png|fal.ai login page]]

2. Complete their annoying entry survey (any answers will do)

![[image-45.png|Survey for new accounts on fal.ai]]
3. You will see the fal dashboard
![[image-46.png|Main page of the fal dashboard|697]]

4. Go to https://fal.ai/dashboard/keys. You will see the keys page.
![[image-47.png|Keys page of the fal dashboard]]
5. Tap the "+ Add key" button at the top right. The dialog window will open.
![[image-48.png|574]]
6.  Tap "create key" at the bottom right. The key will appear: copy it right away, because you will not see it again.
7. Tap "done" after you've copied the key.

**Adding funds.**
1. Go to https://fal.ai/dashboard/usage-billing/credits
![[image-50.png|fal.ai credits page]]
2. Find the "Buy credits" card.
![[image-49.png]]
3. Tap "Custom" and type the amount that you want. The minimum is $10.
4. Tap the "Buy $10.00 credits" button.
5. Fill in your address details; you can leave the tax ID blank.
![[image-51.png]]
6. A payment page from Stripe will open; fill in the details of your bank card there. 
## Pricing

Each provider sets its own rates. The dropdown in Iconoplasm lists rough estimates — always check the official pricing page before generating at scale.

| Iconoplasm provider | Models in dropdown | Per-image estimate (dropdown) | Official pricing page |
|---|---|---|---|
| **Krea API** | Ideogram 4.5, GPT Image 2.5, Nano Banana 2, Nano Banana Pro, Krea 2 Large, Seedream 5 Lite | ~\$0.003 – \$0.30 | [krea.ai/features/api](https://www.krea.ai/features/api) |
| **Gemini API** | 3.1 Flash Lite Image, 3.1 Flash Image, 3 Pro Image | ~\$0.034 – \$0.134 | [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| **Luma Uni API** | Uni 1.1, Uni 1.1 Max | \$0.043 – \$0.103 | [lumalabs.ai/pricing](https://lumalabs.ai/pricing) |
| **OpenAI API** | GPT Image 2.5 Sunburst, GPT Image 2.5 Flare | Billed per token (\$30 per million tokens of image output) | [openai.com/api/pricing](https://openai.com/api/pricing) |
| **Fal.ai** | Flux 3, Ideogram 4.5, GPT Image 2.5, Nano Banana Pro, Seedream 5 | ~\$0.012 – \$0.15 | [fal.ai/pricing](https://fal.ai/pricing) |

All costs are billed directly by the provider, not by Iconoplasm.


Now that you have a key from one of the providers above, save it in Iconoplasm settings: see [[apps/iconoplasm/docs/generate-with-your-key|Generate with your own key]].
