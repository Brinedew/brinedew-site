import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const outputs = [
  path.join(repoRoot, "quartz", "static", "iconoplasm", "materials", "mobile-pocket"),
  path.join(repoRoot, "iconoplasm-extension", "materials", "mobile-pocket"),
]

const W = 740
const H = 786
const viewBox = "0 0 247 262"
const pocketPath =
  "M0 24 C20 19 42 20 62 22 C83 24 101 19 118 13 C157 -1 207 8 247 0 V262 H0 Z M247 127 C232 134 225 149 226 163 C227 179 235 190 247 196 Z"
const lipPath = "M4 27 C33 20 63 24 92 20 C120 17 139 4 171 5 C194 5 219 8 243 3"
const thumbPath = "M247 127 C232 134 225 149 226 163 C227 179 235 190 247 196"

function svg(body, extraDefs = "") {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${viewBox}" preserveAspectRatio="none">
      <defs>
        <filter id="paper-fiber" x="-8%" y="-8%" width="116%" height="124%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.86 0.19" numOctaves="5" seed="476" result="fiber"/>
          <feColorMatrix in="fiber" type="matrix" values="0.34 0 0 0 0.52 0 0.28 0 0 0.38 0 0 0.16 0.24 0 0 0 0.32 0" result="warmFiber"/>
          <feBlend in="SourceGraphic" in2="warmFiber" mode="multiply" result="fibered"/>
          <feTurbulence type="turbulence" baseFrequency="0.025 0.11" numOctaves="2" seed="91" result="warp"/>
          <feDisplacementMap in="fibered" in2="warp" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="soften" x="-8%" y="-8%" width="116%" height="124%">
          <feGaussianBlur stdDeviation="0.48"/>
        </filter>
        <clipPath id="pocket-clip" clipPathUnits="userSpaceOnUse">
          <path d="${pocketPath}" fill-rule="evenodd"/>
        </clipPath>
        ${extraDefs}
      </defs>
      ${body}
    </svg>`,
  )
}

const assets = {
  "pocket-front-albedo.webp": sharp(
    svg(`
      <rect width="247" height="262" fill="transparent"/>
      <path d="${pocketPath}" fill="#b88455" fill-rule="evenodd" filter="url(#paper-fiber)"/>
      <path d="${pocketPath}" fill="none" fill-rule="evenodd" stroke="rgba(55,31,13,0.18)" stroke-width="0.55" vector-effect="non-scaling-stroke"/>
      <path d="${lipPath}" fill="none" stroke="rgba(255,242,213,0.42)" stroke-width="1.15" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <path d="M12 244 C45 250 89 247 130 252 C173 257 213 249 241 254" fill="none" stroke="rgba(60,34,14,0.1)" stroke-width="0.8" stroke-linecap="round"/>
    `),
  ).webp({ quality: 92 }),

  "pocket-front-alpha.png": sharp(
    svg(`
      <rect width="247" height="262" fill="transparent"/>
      <path d="${pocketPath}" fill="white" fill-rule="evenodd"/>
    `),
  ).png(),

  "pocket-front-height.png": sharp(
    svg(`
      <rect width="247" height="262" fill="transparent"/>
      <g clip-path="url(#pocket-clip)">
        <rect width="247" height="262" fill="rgb(126,126,126)"/>
        <path d="${lipPath}" fill="none" stroke="rgb(206,206,206)" stroke-width="4.8" stroke-linecap="round" filter="url(#soften)"/>
        <path d="${lipPath}" fill="none" stroke="rgb(76,76,76)" stroke-width="4.4" stroke-linecap="round" filter="url(#soften)" transform="translate(0 3.7)"/>
        <path d="${thumbPath}" fill="none" stroke="rgb(54,54,54)" stroke-width="6.2" stroke-linecap="round" filter="url(#soften)"/>
        <path d="${thumbPath}" fill="none" stroke="rgb(184,184,184)" stroke-width="1.4" stroke-linecap="round" transform="translate(-1.2 0)"/>
        <path d="M0 248 C57 260 128 257 247 249 L247 262 H0 Z" fill="rgb(92,92,92)" filter="url(#soften)"/>
      </g>
    `),
  ).png(),

  "pocket-front-ao.webp": sharp(
    svg(`
      <g clip-path="url(#pocket-clip)" opacity="0.95">
        <path d="${lipPath}" fill="none" stroke="rgba(39,20,8,0.48)" stroke-width="3.8" stroke-linecap="round" filter="url(#soften)" transform="translate(0 1.6)"/>
        <path d="${thumbPath}" fill="none" stroke="rgba(39,20,8,0.52)" stroke-width="6.4" stroke-linecap="round" filter="url(#soften)" transform="translate(-0.8 0)"/>
        <path d="M0 245 C64 252 133 251 247 244 L247 262 H0 Z" fill="rgba(39,20,8,0.2)" filter="url(#soften)"/>
      </g>
    `),
  ).webp({ quality: 88 }),

  "pocket-front-edgewear.png": sharp(
    svg(`
      <path d="${pocketPath}" fill="none" fill-rule="evenodd" stroke="rgba(255,235,196,0.36)" stroke-width="1.1" vector-effect="non-scaling-stroke"/>
      <path d="M0 24 C22 21 49 23 70 22 M92 20 C107 18 118 14 128 10 M191 6 C214 7 231 5 247 0" fill="none" stroke="rgba(62,34,14,0.18)" stroke-width="0.7" stroke-dasharray="2.8 5.5" stroke-linecap="round"/>
      <path d="${thumbPath}" fill="none" stroke="rgba(255,236,202,0.32)" stroke-width="1.3" stroke-linecap="round"/>
    `),
  ).png(),

  "pocket-front-stains.webp": sharp(
    svg(`
      <g clip-path="url(#pocket-clip)" opacity="0.72">
        <ellipse cx="38" cy="232" rx="15" ry="7" fill="rgba(64,36,14,0.13)" transform="rotate(-18 38 232)"/>
        <ellipse cx="205" cy="83" rx="26" ry="8" fill="rgba(255,238,205,0.1)" transform="rotate(11 205 83)"/>
        <path d="M17 119 C43 116 59 121 82 115" fill="none" stroke="rgba(50,28,11,0.11)" stroke-width="0.52" stroke-linecap="round"/>
        <path d="M159 190 C182 185 202 189 227 181" fill="none" stroke="rgba(50,28,11,0.09)" stroke-width="0.7" stroke-linecap="round"/>
        <circle cx="111" cy="69" r="1.2" fill="rgba(38,22,10,0.16)"/>
        <circle cx="137" cy="157" r="0.95" fill="rgba(38,22,10,0.14)"/>
        <circle cx="231" cy="222" r="1.25" fill="rgba(38,22,10,0.12)"/>
      </g>
    `),
  ).webp({ quality: 84 }),

  "pocket-lip-shadow.png": sharp(
    svg(`
      <path d="${lipPath}" fill="none" stroke="rgba(35,18,7,0.36)" stroke-width="5.2" stroke-linecap="round" filter="url(#soften)" transform="translate(0 4.4)"/>
    `),
  ).png(),

  "pocket-card-contact-shadow.png": sharp(
    svg(`
      <path d="M2 21 C38 23 68 27 113 18 C153 9 205 11 245 7 L247 262 H0 V28 Z" fill="rgba(34,18,8,0.2)" filter="url(#soften)" transform="translate(0 2.5)"/>
      <path d="M0 248 C57 260 128 257 247 249 L247 262 H0 Z" fill="rgba(34,18,8,0.24)" filter="url(#soften)"/>
    `),
  ).png(),

  "thumb-hole-inner-shadow.png": sharp(
    svg(`
      <path d="${thumbPath}" fill="none" stroke="rgba(36,19,8,0.5)" stroke-width="5.8" stroke-linecap="round" filter="url(#soften)"/>
      <path d="${thumbPath}" fill="none" stroke="rgba(255,239,208,0.24)" stroke-width="1.2" stroke-linecap="round" transform="translate(-1.1 0)"/>
    `),
  ).png(),

  "pocket-debug-contact-zones.png": sharp(
    svg(`
      <path d="${pocketPath}" fill="rgba(190,120,60,0.28)" fill-rule="evenodd"/>
      <path d="${lipPath}" fill="none" stroke="rgba(0,90,255,0.75)" stroke-width="2"/>
      <path d="${thumbPath}" fill="none" stroke="rgba(255,0,90,0.75)" stroke-width="3"/>
      <path d="M0 248 C57 260 128 257 247 249" fill="none" stroke="rgba(0,150,70,0.75)" stroke-width="3"/>
    `),
  ).png(),
}

for (const dir of outputs) {
  await mkdir(dir, { recursive: true })
  await Promise.all(
    Object.entries(assets).map(async ([name, pipeline]) => {
      await writeFile(path.join(dir, name), await pipeline.toBuffer())
    }),
  )
}
