/* GENERATED FILE. Edit shared/iconoplasm-card/lit-archival-card.js and rerun node scripts/sync-iconoplasm-shared.mjs. */

// node_modules/@lit/reactive-element/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = /* @__PURE__ */ Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t4, e6, o6) {
    if (this._$cssResult$ = true, o6 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t4, this.t = e6;
  }
  get styleSheet() {
    let t4 = this.o;
    const s4 = this.t;
    if (e && void 0 === t4) {
      const e6 = void 0 !== s4 && 1 === s4.length;
      e6 && (t4 = o.get(s4)), void 0 === t4 && ((this.o = t4 = new CSSStyleSheet()).replaceSync(this.cssText), e6 && o.set(s4, t4));
    }
    return t4;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t4) => new n("string" == typeof t4 ? t4 : t4 + "", void 0, s);
var S = (s4, o6) => {
  if (e) s4.adoptedStyleSheets = o6.map((t4) => t4 instanceof CSSStyleSheet ? t4 : t4.styleSheet);
  else for (const e6 of o6) {
    const o7 = document.createElement("style"), n4 = t.litNonce;
    void 0 !== n4 && o7.setAttribute("nonce", n4), o7.textContent = e6.cssText, s4.appendChild(o7);
  }
};
var c = e ? (t4) => t4 : (t4) => t4 instanceof CSSStyleSheet ? ((t5) => {
  let e6 = "";
  for (const s4 of t5.cssRules) e6 += s4.cssText;
  return r(e6);
})(t4) : t4;

// node_modules/@lit/reactive-element/reactive-element.js
var { is: i2, defineProperty: e2, getOwnPropertyDescriptor: h, getOwnPropertyNames: r2, getOwnPropertySymbols: o2, getPrototypeOf: n2 } = Object;
var a = globalThis;
var c2 = a.trustedTypes;
var l = c2 ? c2.emptyScript : "";
var p = a.reactiveElementPolyfillSupport;
var d = (t4, s4) => t4;
var u = { toAttribute(t4, s4) {
  switch (s4) {
    case Boolean:
      t4 = t4 ? l : null;
      break;
    case Object:
    case Array:
      t4 = null == t4 ? t4 : JSON.stringify(t4);
  }
  return t4;
}, fromAttribute(t4, s4) {
  let i6 = t4;
  switch (s4) {
    case Boolean:
      i6 = null !== t4;
      break;
    case Number:
      i6 = null === t4 ? null : Number(t4);
      break;
    case Object:
    case Array:
      try {
        i6 = JSON.parse(t4);
      } catch (t5) {
        i6 = null;
      }
  }
  return i6;
} };
var f = (t4, s4) => !i2(t4, s4);
var b = { attribute: true, type: String, converter: u, reflect: false, useDefault: false, hasChanged: f };
Symbol.metadata ??= /* @__PURE__ */ Symbol("metadata"), a.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var y = class extends HTMLElement {
  static addInitializer(t4) {
    this._$Ei(), (this.l ??= []).push(t4);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t4, s4 = b) {
    if (s4.state && (s4.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t4) && ((s4 = Object.create(s4)).wrapped = true), this.elementProperties.set(t4, s4), !s4.noAccessor) {
      const i6 = /* @__PURE__ */ Symbol(), h3 = this.getPropertyDescriptor(t4, i6, s4);
      void 0 !== h3 && e2(this.prototype, t4, h3);
    }
  }
  static getPropertyDescriptor(t4, s4, i6) {
    const { get: e6, set: r4 } = h(this.prototype, t4) ?? { get() {
      return this[s4];
    }, set(t5) {
      this[s4] = t5;
    } };
    return { get: e6, set(s5) {
      const h3 = e6?.call(this);
      r4?.call(this, s5), this.requestUpdate(t4, h3, i6);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t4) {
    return this.elementProperties.get(t4) ?? b;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d("elementProperties"))) return;
    const t4 = n2(this);
    t4.finalize(), void 0 !== t4.l && (this.l = [...t4.l]), this.elementProperties = new Map(t4.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d("properties"))) {
      const t5 = this.properties, s4 = [...r2(t5), ...o2(t5)];
      for (const i6 of s4) this.createProperty(i6, t5[i6]);
    }
    const t4 = this[Symbol.metadata];
    if (null !== t4) {
      const s4 = litPropertyMetadata.get(t4);
      if (void 0 !== s4) for (const [t5, i6] of s4) this.elementProperties.set(t5, i6);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t5, s4] of this.elementProperties) {
      const i6 = this._$Eu(t5, s4);
      void 0 !== i6 && this._$Eh.set(i6, t5);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s4) {
    const i6 = [];
    if (Array.isArray(s4)) {
      const e6 = new Set(s4.flat(1 / 0).reverse());
      for (const s5 of e6) i6.unshift(c(s5));
    } else void 0 !== s4 && i6.push(c(s4));
    return i6;
  }
  static _$Eu(t4, s4) {
    const i6 = s4.attribute;
    return false === i6 ? void 0 : "string" == typeof i6 ? i6 : "string" == typeof t4 ? t4.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t4) => this.enableUpdating = t4), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t4) => t4(this));
  }
  addController(t4) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t4), void 0 !== this.renderRoot && this.isConnected && t4.hostConnected?.();
  }
  removeController(t4) {
    this._$EO?.delete(t4);
  }
  _$E_() {
    const t4 = /* @__PURE__ */ new Map(), s4 = this.constructor.elementProperties;
    for (const i6 of s4.keys()) this.hasOwnProperty(i6) && (t4.set(i6, this[i6]), delete this[i6]);
    t4.size > 0 && (this._$Ep = t4);
  }
  createRenderRoot() {
    const t4 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t4, this.constructor.elementStyles), t4;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t4) => t4.hostConnected?.());
  }
  enableUpdating(t4) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t4) => t4.hostDisconnected?.());
  }
  attributeChangedCallback(t4, s4, i6) {
    this._$AK(t4, i6);
  }
  _$ET(t4, s4) {
    const i6 = this.constructor.elementProperties.get(t4), e6 = this.constructor._$Eu(t4, i6);
    if (void 0 !== e6 && true === i6.reflect) {
      const h3 = (void 0 !== i6.converter?.toAttribute ? i6.converter : u).toAttribute(s4, i6.type);
      this._$Em = t4, null == h3 ? this.removeAttribute(e6) : this.setAttribute(e6, h3), this._$Em = null;
    }
  }
  _$AK(t4, s4) {
    const i6 = this.constructor, e6 = i6._$Eh.get(t4);
    if (void 0 !== e6 && this._$Em !== e6) {
      const t5 = i6.getPropertyOptions(e6), h3 = "function" == typeof t5.converter ? { fromAttribute: t5.converter } : void 0 !== t5.converter?.fromAttribute ? t5.converter : u;
      this._$Em = e6;
      const r4 = h3.fromAttribute(s4, t5.type);
      this[e6] = r4 ?? this._$Ej?.get(e6) ?? r4, this._$Em = null;
    }
  }
  requestUpdate(t4, s4, i6, e6 = false, h3) {
    if (void 0 !== t4) {
      const r4 = this.constructor;
      if (false === e6 && (h3 = this[t4]), i6 ??= r4.getPropertyOptions(t4), !((i6.hasChanged ?? f)(h3, s4) || i6.useDefault && i6.reflect && h3 === this._$Ej?.get(t4) && !this.hasAttribute(r4._$Eu(t4, i6)))) return;
      this.C(t4, s4, i6);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t4, s4, { useDefault: i6, reflect: e6, wrapped: h3 }, r4) {
    i6 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t4) && (this._$Ej.set(t4, r4 ?? s4 ?? this[t4]), true !== h3 || void 0 !== r4) || (this._$AL.has(t4) || (this.hasUpdated || i6 || (s4 = void 0), this._$AL.set(t4, s4)), true === e6 && this._$Em !== t4 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t4));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t5) {
      Promise.reject(t5);
    }
    const t4 = this.scheduleUpdate();
    return null != t4 && await t4, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t6, s5] of this._$Ep) this[t6] = s5;
        this._$Ep = void 0;
      }
      const t5 = this.constructor.elementProperties;
      if (t5.size > 0) for (const [s5, i6] of t5) {
        const { wrapped: t6 } = i6, e6 = this[s5];
        true !== t6 || this._$AL.has(s5) || void 0 === e6 || this.C(s5, void 0, i6, e6);
      }
    }
    let t4 = false;
    const s4 = this._$AL;
    try {
      t4 = this.shouldUpdate(s4), t4 ? (this.willUpdate(s4), this._$EO?.forEach((t5) => t5.hostUpdate?.()), this.update(s4)) : this._$EM();
    } catch (s5) {
      throw t4 = false, this._$EM(), s5;
    }
    t4 && this._$AE(s4);
  }
  willUpdate(t4) {
  }
  _$AE(t4) {
    this._$EO?.forEach((t5) => t5.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t4)), this.updated(t4);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t4) {
    return true;
  }
  update(t4) {
    this._$Eq &&= this._$Eq.forEach((t5) => this._$ET(t5, this[t5])), this._$EM();
  }
  updated(t4) {
  }
  firstUpdated(t4) {
  }
};
y.elementStyles = [], y.shadowRootOptions = { mode: "open" }, y[d("elementProperties")] = /* @__PURE__ */ new Map(), y[d("finalized")] = /* @__PURE__ */ new Map(), p?.({ ReactiveElement: y }), (a.reactiveElementVersions ??= []).push("2.1.2");

// node_modules/lit-html/lit-html.js
var t2 = globalThis;
var i3 = (t4) => t4;
var s2 = t2.trustedTypes;
var e3 = s2 ? s2.createPolicy("lit-html", { createHTML: (t4) => t4 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t4) => null === t4 || "object" != typeof t4 && "function" != typeof t4;
var u2 = Array.isArray;
var d2 = (t4) => u2(t4) || "function" == typeof t4?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t4) => (i6, ...s4) => ({ _$litType$: t4, strings: i6, values: s4 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = /* @__PURE__ */ Symbol.for("lit-noChange");
var A = /* @__PURE__ */ Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t4, i6) {
  if (!u2(t4) || !t4.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e3 ? e3.createHTML(i6) : i6;
}
var N = (t4, i6) => {
  const s4 = t4.length - 1, e6 = [];
  let n4, l3 = 2 === i6 ? "<svg>" : 3 === i6 ? "<math>" : "", c4 = v;
  for (let i7 = 0; i7 < s4; i7++) {
    const s5 = t4[i7];
    let a3, u3, d3 = -1, f3 = 0;
    for (; f3 < s5.length && (c4.lastIndex = f3, u3 = c4.exec(s5), null !== u3); ) f3 = c4.lastIndex, c4 === v ? "!--" === u3[1] ? c4 = _ : void 0 !== u3[1] ? c4 = m : void 0 !== u3[2] ? (y2.test(u3[2]) && (n4 = RegExp("</" + u3[2], "g")), c4 = p2) : void 0 !== u3[3] && (c4 = p2) : c4 === p2 ? ">" === u3[0] ? (c4 = n4 ?? v, d3 = -1) : void 0 === u3[1] ? d3 = -2 : (d3 = c4.lastIndex - u3[2].length, a3 = u3[1], c4 = void 0 === u3[3] ? p2 : '"' === u3[3] ? $ : g) : c4 === $ || c4 === g ? c4 = p2 : c4 === _ || c4 === m ? c4 = v : (c4 = p2, n4 = void 0);
    const x2 = c4 === p2 && t4[i7 + 1].startsWith("/>") ? " " : "";
    l3 += c4 === v ? s5 + r3 : d3 >= 0 ? (e6.push(a3), s5.slice(0, d3) + h2 + s5.slice(d3) + o3 + x2) : s5 + o3 + (-2 === d3 ? i7 : x2);
  }
  return [V(t4, l3 + (t4[s4] || "<?>") + (2 === i6 ? "</svg>" : 3 === i6 ? "</math>" : "")), e6];
};
var S2 = class _S {
  constructor({ strings: t4, _$litType$: i6 }, e6) {
    let r4;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u3 = t4.length - 1, d3 = this.parts, [f3, v2] = N(t4, i6);
    if (this.el = _S.createElement(f3, e6), P.currentNode = this.el.content, 2 === i6 || 3 === i6) {
      const t5 = this.el.content.firstChild;
      t5.replaceWith(...t5.childNodes);
    }
    for (; null !== (r4 = P.nextNode()) && d3.length < u3; ) {
      if (1 === r4.nodeType) {
        if (r4.hasAttributes()) for (const t5 of r4.getAttributeNames()) if (t5.endsWith(h2)) {
          const i7 = v2[a3++], s4 = r4.getAttribute(t5).split(o3), e7 = /([.?@])?(.*)/.exec(i7);
          d3.push({ type: 1, index: l3, name: e7[2], strings: s4, ctor: "." === e7[1] ? I : "?" === e7[1] ? L : "@" === e7[1] ? z : H }), r4.removeAttribute(t5);
        } else t5.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r4.removeAttribute(t5));
        if (y2.test(r4.tagName)) {
          const t5 = r4.textContent.split(o3), i7 = t5.length - 1;
          if (i7 > 0) {
            r4.textContent = s2 ? s2.emptyScript : "";
            for (let s4 = 0; s4 < i7; s4++) r4.append(t5[s4], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r4.append(t5[i7], c3());
          }
        }
      } else if (8 === r4.nodeType) if (r4.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t5 = -1;
        for (; -1 !== (t5 = r4.data.indexOf(o3, t5 + 1)); ) d3.push({ type: 7, index: l3 }), t5 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t4, i6) {
    const s4 = l2.createElement("template");
    return s4.innerHTML = t4, s4;
  }
};
function M(t4, i6, s4 = t4, e6) {
  if (i6 === E) return i6;
  let h3 = void 0 !== e6 ? s4._$Co?.[e6] : s4._$Cl;
  const o6 = a2(i6) ? void 0 : i6._$litDirective$;
  return h3?.constructor !== o6 && (h3?._$AO?.(false), void 0 === o6 ? h3 = void 0 : (h3 = new o6(t4), h3._$AT(t4, s4, e6)), void 0 !== e6 ? (s4._$Co ??= [])[e6] = h3 : s4._$Cl = h3), void 0 !== h3 && (i6 = M(t4, h3._$AS(t4, i6.values), h3, e6)), i6;
}
var R = class {
  constructor(t4, i6) {
    this._$AV = [], this._$AN = void 0, this._$AD = t4, this._$AM = i6;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t4) {
    const { el: { content: i6 }, parts: s4 } = this._$AD, e6 = (t4?.creationScope ?? l2).importNode(i6, true);
    P.currentNode = e6;
    let h3 = P.nextNode(), o6 = 0, n4 = 0, r4 = s4[0];
    for (; void 0 !== r4; ) {
      if (o6 === r4.index) {
        let i7;
        2 === r4.type ? i7 = new k(h3, h3.nextSibling, this, t4) : 1 === r4.type ? i7 = new r4.ctor(h3, r4.name, r4.strings, this, t4) : 6 === r4.type && (i7 = new Z(h3, this, t4)), this._$AV.push(i7), r4 = s4[++n4];
      }
      o6 !== r4?.index && (h3 = P.nextNode(), o6++);
    }
    return P.currentNode = l2, e6;
  }
  p(t4) {
    let i6 = 0;
    for (const s4 of this._$AV) void 0 !== s4 && (void 0 !== s4.strings ? (s4._$AI(t4, s4, i6), i6 += s4.strings.length - 2) : s4._$AI(t4[i6])), i6++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t4, i6, s4, e6) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t4, this._$AB = i6, this._$AM = s4, this.options = e6, this._$Cv = e6?.isConnected ?? true;
  }
  get parentNode() {
    let t4 = this._$AA.parentNode;
    const i6 = this._$AM;
    return void 0 !== i6 && 11 === t4?.nodeType && (t4 = i6.parentNode), t4;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t4, i6 = this) {
    t4 = M(this, t4, i6), a2(t4) ? t4 === A || null == t4 || "" === t4 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t4 !== this._$AH && t4 !== E && this._(t4) : void 0 !== t4._$litType$ ? this.$(t4) : void 0 !== t4.nodeType ? this.T(t4) : d2(t4) ? this.k(t4) : this._(t4);
  }
  O(t4) {
    return this._$AA.parentNode.insertBefore(t4, this._$AB);
  }
  T(t4) {
    this._$AH !== t4 && (this._$AR(), this._$AH = this.O(t4));
  }
  _(t4) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t4 : this.T(l2.createTextNode(t4)), this._$AH = t4;
  }
  $(t4) {
    const { values: i6, _$litType$: s4 } = t4, e6 = "number" == typeof s4 ? this._$AC(t4) : (void 0 === s4.el && (s4.el = S2.createElement(V(s4.h, s4.h[0]), this.options)), s4);
    if (this._$AH?._$AD === e6) this._$AH.p(i6);
    else {
      const t5 = new R(e6, this), s5 = t5.u(this.options);
      t5.p(i6), this.T(s5), this._$AH = t5;
    }
  }
  _$AC(t4) {
    let i6 = C.get(t4.strings);
    return void 0 === i6 && C.set(t4.strings, i6 = new S2(t4)), i6;
  }
  k(t4) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i6 = this._$AH;
    let s4, e6 = 0;
    for (const h3 of t4) e6 === i6.length ? i6.push(s4 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s4 = i6[e6], s4._$AI(h3), e6++;
    e6 < i6.length && (this._$AR(s4 && s4._$AB.nextSibling, e6), i6.length = e6);
  }
  _$AR(t4 = this._$AA.nextSibling, s4) {
    for (this._$AP?.(false, true, s4); t4 !== this._$AB; ) {
      const s5 = i3(t4).nextSibling;
      i3(t4).remove(), t4 = s5;
    }
  }
  setConnected(t4) {
    void 0 === this._$AM && (this._$Cv = t4, this._$AP?.(t4));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t4, i6, s4, e6, h3) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t4, this.name = i6, this._$AM = e6, this.options = h3, s4.length > 2 || "" !== s4[0] || "" !== s4[1] ? (this._$AH = Array(s4.length - 1).fill(new String()), this.strings = s4) : this._$AH = A;
  }
  _$AI(t4, i6 = this, s4, e6) {
    const h3 = this.strings;
    let o6 = false;
    if (void 0 === h3) t4 = M(this, t4, i6, 0), o6 = !a2(t4) || t4 !== this._$AH && t4 !== E, o6 && (this._$AH = t4);
    else {
      const e7 = t4;
      let n4, r4;
      for (t4 = h3[0], n4 = 0; n4 < h3.length - 1; n4++) r4 = M(this, e7[s4 + n4], i6, n4), r4 === E && (r4 = this._$AH[n4]), o6 ||= !a2(r4) || r4 !== this._$AH[n4], r4 === A ? t4 = A : t4 !== A && (t4 += (r4 ?? "") + h3[n4 + 1]), this._$AH[n4] = r4;
    }
    o6 && !e6 && this.j(t4);
  }
  j(t4) {
    t4 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t4 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t4) {
    this.element[this.name] = t4 === A ? void 0 : t4;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t4) {
    this.element.toggleAttribute(this.name, !!t4 && t4 !== A);
  }
};
var z = class extends H {
  constructor(t4, i6, s4, e6, h3) {
    super(t4, i6, s4, e6, h3), this.type = 5;
  }
  _$AI(t4, i6 = this) {
    if ((t4 = M(this, t4, i6, 0) ?? A) === E) return;
    const s4 = this._$AH, e6 = t4 === A && s4 !== A || t4.capture !== s4.capture || t4.once !== s4.once || t4.passive !== s4.passive, h3 = t4 !== A && (s4 === A || e6);
    e6 && this.element.removeEventListener(this.name, this, s4), h3 && this.element.addEventListener(this.name, this, t4), this._$AH = t4;
  }
  handleEvent(t4) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t4) : this._$AH.handleEvent(t4);
  }
};
var Z = class {
  constructor(t4, i6, s4) {
    this.element = t4, this.type = 6, this._$AN = void 0, this._$AM = i6, this.options = s4;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t4) {
    M(this, t4);
  }
};
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.2");
var D = (t4, i6, s4) => {
  const e6 = s4?.renderBefore ?? i6;
  let h3 = e6._$litPart$;
  if (void 0 === h3) {
    const t5 = s4?.renderBefore ?? null;
    e6._$litPart$ = h3 = new k(i6.insertBefore(c3(), t5), t5, void 0, s4 ?? {});
  }
  return h3._$AI(t4), h3;
};

// node_modules/lit-element/lit-element.js
var s3 = globalThis;
var i4 = class extends y {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t4 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t4.firstChild, t4;
  }
  update(t4) {
    const r4 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t4), this._$Do = D(r4, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i4._$litElement$ = true, i4["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i4 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i4 });
(s3.litElementVersions ??= []).push("4.2.2");

// node_modules/lit-html/directive.js
var t3 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e4 = (t4) => (...e6) => ({ _$litDirective$: t4, values: e6 });
var i5 = class {
  constructor(t4) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t4, e6, i6) {
    this._$Ct = t4, this._$AM = e6, this._$Ci = i6;
  }
  _$AS(t4, e6) {
    return this.update(t4, e6);
  }
  update(t4, e6) {
    return this.render(...e6);
  }
};

// node_modules/lit-html/directives/unsafe-html.js
var e5 = class extends i5 {
  constructor(i6) {
    if (super(i6), this.it = A, i6.type !== t3.CHILD) throw Error(this.constructor.directiveName + "() can only be used in child bindings");
  }
  render(r4) {
    if (r4 === A || null == r4) return this._t = void 0, this.it = r4;
    if (r4 === E) return r4;
    if ("string" != typeof r4) throw Error(this.constructor.directiveName + "() called with a non-string value");
    if (r4 === this.it) return this._t;
    this.it = r4;
    const s4 = [r4];
    return s4.raw = s4, this._t = { _$litType$: this.constructor.resultType, strings: s4, values: [] };
  }
};
e5.directiveName = "unsafeHTML", e5.resultType = 1;
var o5 = e4(e5);

// shared/iconoplasm-card/lit-archival-card.js
var MODEL_ATTR = "data-icono-lit-archival-model";
var MODEL_SELECTOR = 'script[type="application/json"][data-icono-lit-archival-model]';
var roughLoopSerial = 0;
function sharedCardRuntime() {
  return globalThis && globalThis.IconoplasmCardShared ? globalThis.IconoplasmCardShared : null;
}
function asObject(value) {
  return value && typeof value === "object" ? value : {};
}
function blankFallback(value) {
  return String(value || "").trim() || " ";
}
function normalizeHandwrittenText(value) {
  var text = String(value || "").trim();
  if (!text) return "";
  try {
    return text.normalize("NFD");
  } catch (_error) {
    return text;
  }
}
function normalizeCardModelHandwriting(payload) {
  var safePayload = asObject(payload);
  var normalized = Object.assign({}, safePayload);
  normalized.ageNote = normalizeHandwrittenText(safePayload.ageNote);
  normalized.displayedFamilyFeature = normalizeHandwrittenText(safePayload.displayedFamilyFeature);
  normalized.handwrittenWeight = normalizeHandwrittenText(safePayload.handwrittenWeight);
  normalized.politicalNote = normalizeHandwrittenText(safePayload.politicalNote);
  normalized.sexNote = normalizeHandwrittenText(safePayload.sexNote);
  normalized.stylePairs = Array.isArray(safePayload.stylePairs) ? safePayload.stylePairs.map(function(pair) {
    var safePair = asObject(pair);
    return {
      origin: blankFallback(safePair.origin),
      note: normalizeHandwrittenText(safePair.note)
    };
  }) : [];
  return normalized;
}
function resolveCardModel(payload) {
  var safePayload = asObject(payload);
  if (safePayload.symbol && Array.isArray(safePayload.stylePairs)) {
    return normalizeCardModelHandwriting(safePayload);
  }
  var shared = sharedCardRuntime();
  if (shared && typeof shared.resolveArchivalCardModel === "function") {
    return normalizeCardModelHandwriting(
      shared.resolveArchivalCardModel(safePayload.gene || safePayload, safePayload.options)
    );
  }
  return normalizeCardModelHandwriting(safePayload);
}
function modelOpensInNewTab(model) {
  return String(model && model.titleLinkAttrs || "").indexOf('target="_blank"') >= 0;
}
function penLoopFallbackMarkup() {
  return '<path d="M 8 18 C 8 10, 21 5, 65 5 C 108 5, 124 10, 124 17 C 124 24, 108 29, 66 29 C 22 29, 8 24, 8 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M 12 21 C 15 13, 29 10, 66 10 C 101 10, 114 12, 119 17" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-dasharray="2.5 4"/>';
}
function penLoopSvgMarkup(className, presetName) {
  roughLoopSerial += 1;
  var loopSeed = 9001 + roughLoopSerial * 97;
  return '<svg class="' + String(className || "icono-pen-loop") + '" data-icono-rough-loop="true" data-icono-rough-preset="' + String(presetName || "default") + '" data-icono-rough-seed="' + String(loopSeed) + '" viewBox="0 0 132 34" preserveAspectRatio="none" aria-hidden="true">' + penLoopFallbackMarkup() + "</svg>";
}
function optionTemplate(value, selected, extraClass, loopPreset) {
  var classes = "icono-label-option";
  if (extraClass) classes += " " + extraClass;
  if (selected) classes += " is-selected";
  return b2`<span class=${classes}
    ><span class="icono-label-option-copy" data-icono-rough-copy="true">${value}</span>${selected ? o5(penLoopSvgMarkup("icono-label-option-loop", loopPreset)) : A}</span
  >`;
}
function voteShellTemplate(voteHtml) {
  var resolved = String(voteHtml || "").trim();
  return resolved ? b2`${o5(resolved)}` : b2`<div class="icono-label-qc-empty"></div>`;
}
function familyTraitTemplate(familyFeature) {
  if (!String(familyFeature || "").trim()) {
    return b2`<div
      class="icono-label-family-trait-field icono-label-family-trait-field--empty"
    ></div>`;
  }
  return b2`<div class="icono-label-family-trait-field">
    <div class="icono-label-hand-note icono-label-hand-note--family-trait">${familyFeature}</div>
  </div>`;
}
function categoryFieldTemplate(selectedCategory) {
  var categoryKey = String(selectedCategory || "").trim().toLowerCase();
  return b2`<div class="icono-label-category-grid">
    <div class="icono-label-category-option icono-label-category-option--transmembrane">
      ${optionTemplate(
    "TRANSMEMBRANE",
    categoryKey === "transmembrane",
    "",
    "category-transmembrane"
  )}
    </div>
    <div class="icono-label-category-option icono-label-category-option--soluble">
      ${optionTemplate("SOLUBLE", categoryKey === "soluble", "", "category-soluble")}
    </div>
  </div>`;
}
function sexNoteTemplate(sexNote, selectedCategory) {
  var note = String(sexNote || "").trim().toLowerCase();
  if (!note) return A;
  var categoryKey = String(selectedCategory || "").trim().toLowerCase();
  var noteClass = "icono-label-hand-note icono-label-hand-note--sex icono-label-hand-note--sex-" + (categoryKey || "unselected");
  return b2`<div class=${noteClass}>${note}</div>`;
}
function alignmentFieldTemplate(molecularAlignment, politicalNote) {
  var molecularKey = String(molecularAlignment || "").trim().toLowerCase();
  var isContextual = molecularKey === "contextual oncogene/tumor suppressor";
  var isOncogene = molecularKey === "oncogene" || isContextual;
  var isTumorSuppressor = molecularKey === "tumor suppressor" || isContextual;
  var isNeither = !molecularKey;
  var noteClass = "icono-label-hand-note icono-label-hand-note--politics";
  if (isContextual) noteClass += " icono-label-hand-note--politics-contextual";
  else if (isOncogene) noteClass += " icono-label-hand-note--politics-oncogene";
  else if (isTumorSuppressor) noteClass += " icono-label-hand-note--politics-tumor-suppressor";
  else noteClass += " icono-label-hand-note--politics-neutral";
  return b2`<div class="icono-label-alignment-grid">
    <div
      class=${"icono-label-selector-row icono-label-selector-row--alignment" + (isNeither ? " is-neither" : "")}
    >
      ${optionTemplate("ONCOGENE", isOncogene, "", "alignment-oncogene")}
      ${optionTemplate("TUMOR SUPPRESSOR", isTumorSuppressor, "", "alignment-tumor-suppressor")}
      ${isNeither ? b2`<span class="icono-label-alignment-strike" aria-hidden="true"></span>` : A}
    </div>
    <div class=${noteClass}>${politicalNote}</div>
  </div>`;
}
function titleTemplate(model) {
  var titleInner = b2`<div class="icono-label-caption">gene name</div>
    <div class="icono-label-symbol">${model.symbol}</div>
    <div class="icono-label-name">${model.fullName || model.symbol}</div>
    <div class="icono-label-registry-line">
      ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03
    </div>`;
  if (model.titleHref) {
    return b2`<a
      class="icono-label-title-link"
      href=${model.titleHref}
      target=${modelOpensInNewTab(model) ? "_blank" : A}
      rel=${modelOpensInNewTab(model) ? "noopener noreferrer" : A}
      >${titleInner}</a
    >`;
  }
  return b2`<div class="icono-label-title-block">${titleInner}</div>`;
}
function footerTemplate(model) {
  var stockTone = model.color || "UNFILED";
  var sheetNo = model.serial || "00000";
  return b2`<div class="icono-label-footer-copy">
    <div class="icono-label-footer-copy-main">
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        labelled / inspected / filed
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--typed">
        archive room b / bench 3 / human gene cabinet
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--typed">
        stock tone ${stockTone} / sheet ${sheetNo} / print run 07
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--typed">
        seal after review / do not expose to open air
      </div>
    </div>
    <div class="icono-label-footer-copy-side">
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        brinedew institute / internal matter
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        keep away from heat and moisture
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        registry copy retained in cabinet 5A
      </div>
    </div>
  </div>`;
}
function sheetTemplate(model) {
  var sheetVoteHtml = model.mode === "brick" && model.mobileReview ? "" : model.voteHtml;
  return b2`<div class="icono-label-sheet-body">
    <div class="icono-label-header-row">
      ${titleTemplate(model)}
      <div class="icono-label-header-stack">
        <div class="icono-label-header-meta">
          <div class="icono-label-header-meta-cell">
            <div class="icono-label-caption">emulsion no.</div>
            <div class="icono-label-serial">${model.serial}</div>
          </div>
          <div class="icono-label-header-meta-cell">
            <div class="icono-label-caption">family</div>
            <div class="icono-label-family">${model.displayedFamily}</div>
          </div>
        </div>
        <div class="icono-label-filed-block">
          <div class="icono-label-caption">family trait</div>
          ${familyTraitTemplate(model.displayedFamilyFeature)}
        </div>
      </div>
      <div class="icono-label-qc-block">
        <div class="icono-label-caption">qc</div>
        ${voteShellTemplate(sheetVoteHtml)}
        <div class="icono-label-qc-meta">
          <div class="icono-label-qc-meta-item">inspect. A3</div>
          <div class="icono-label-qc-meta-item">plate 7</div>
        </div>
        <div class="icono-label-qc-note" data-icono-qc-note>pending review</div>
      </div>
    </div>
    <div class="icono-label-band-row">
      <div class="icono-label-row-label">field notes</div>
      <div class="icono-label-band-grid">
        <div class="icono-label-band-cell icono-label-band-cell--category">
          <div class="icono-label-caption">category</div>
          <div class="icono-label-band-primary">
            ${categoryFieldTemplate(model.selectedCategory)}
          </div>
          <div class="icono-label-band-secondary">
            ${sexNoteTemplate(model.sexNote, model.selectedCategory)}
          </div>
        </div>
        <div class="icono-label-band-cell icono-label-band-cell--noted">
          <div class="icono-label-caption">first noted</div>
          <div class="icono-label-band-primary">
            <div class="icono-label-typed-value icono-label-typed-value--band">
              ${blankFallback(model.firstNoted)}
            </div>
          </div>
          <div class="icono-label-band-secondary">
            <div class="icono-label-hand-note icono-label-hand-note--age">${model.ageNote}</div>
          </div>
        </div>
        <div class="icono-label-band-cell icono-label-band-cell--mass">
          <div class="icono-label-caption">mass</div>
          <div class="icono-label-band-primary">
            <div class="icono-label-mass-line">
              <span class="icono-label-mass-fill">
                <span class="icono-label-hand-note icono-label-hand-note--mass-number"
                  >${model.handwrittenWeight}</span
                >
              </span>
              <span class="icono-label-mass-unit-stack">
                <span
                  class="icono-label-typed-value icono-label-typed-value--band icono-label-typed-value--crossed icono-label-typed-value--unit-kda"
                  >kDa</span
                >
                <span class="icono-label-hand-note icono-label-hand-note--unit">kg</span>
              </span>
            </div>
          </div>
          <div class="icono-label-band-secondary"></div>
        </div>
      </div>
    </div>
    <div class="icono-label-style-row">
      <div class="icono-label-row-label">pfam clans</div>
      <div class="icono-label-style-stack">
        ${model.stylePairs.map(function(pair) {
    return b2`<div class="icono-label-style-pair">
            <div class="icono-label-origin-text">${pair.origin}</div>
            <div class="icono-label-hand-note icono-label-hand-note--style">${pair.note}</div>
          </div>`;
  })}
      </div>
    </div>
    <div class="icono-label-alignment-row">
      <div class="icono-label-row-label">alignment</div>
      <div class="icono-label-alignment-body">
        ${alignmentFieldTemplate(model.molecularAlignment, model.politicalNote)}
      </div>
    </div>
    <div class="icono-label-footer-row">
      <div class="icono-label-row-label">remarks</div>
      ${footerTemplate(model)}
    </div>
  </div>`;
}
function mobilePeekTemplate(model) {
  if (!(model.mode === "brick" && model.mobileReview)) return A;
  return b2`<div class="icono-label-mobile-peek">
    <button
      type="button"
      class="icono-label-mobile-peek-toggle"
      data-icono-label-mobile-toggle
      aria-expanded="false"
    >
      <span class="icono-label-mobile-peek-tab" aria-hidden="true">
        <svg
          class="icono-label-mobile-peek-tab-art"
          viewBox="0 0 188 72"
          preserveAspectRatio="none"
          focusable="false"
          aria-hidden="true"
        >
          <path
            class="icono-label-mobile-peek-tab-fill"
            d="M6 72V44C6 39.6 9.6 36 14 36H51.4C58.6 36 64.7 31.3 69.1 22.1C73.1 13.8 79.6 8 94 8C108.4 8 114.9 13.8 118.9 22.1C123.3 31.3 129.4 36 136.6 36H174C178.4 36 182 39.6 182 44V72H6Z"
          ></path>
          <path
            class="icono-label-mobile-peek-tab-highlight"
            d="M17 42.6H50.2C61.5 42.6 70.8 34.9 76.5 22.8C80.1 15.1 84.8 11.8 94 11.8C103.2 11.8 107.9 15.1 111.5 22.8C117.2 34.9 126.5 42.6 137.8 42.6H171"
          ></path>
        </svg>
        <span class="icono-label-mobile-peek-tab-symbol">${model.symbol}</span>
      </span>
      <span class="icono-label-mobile-peek-topline">
        <span class="icono-label-mobile-peek-kicker">full name</span>
      </span>
      <span class="icono-label-mobile-peek-summary">
        <span class="icono-label-mobile-peek-name">${model.fullName}</span>
      </span>
      <span class="icono-label-mobile-peek-swipe">${voteShellTemplate(model.voteHtml)}</span>
    </button>
  </div>`;
}
function archivalTemplate(model) {
  if (model.layoutVariant === "image-only") {
    return imageOnlyTemplate(model);
  }
  if (model.mode === "brick" && model.mobileReview) {
    return b2`${mobilePeekTemplate(model)}
      <div class="icono-label-dossier-shell" data-icono-label-dossier-shell>
        <div class="icono-label-dossier-sheet">${sheetTemplate(model)}</div>
      </div>`;
  }
  return sheetTemplate(model);
}
function imageOnlyTemplate(model) {
  var href = String(model.titleHref || "").trim();
  var portraitSrc = String(model.portraitSrc || "").trim();
  var portraitAlt = String(model.portraitAlt || "").trim() || (model.symbol ? model.symbol + " blot" : "Gene blot");
  var dims = asObject(model.portraitDimensions);
  var width = Number(dims.width || 0);
  var height = Number(dims.height || 0);
  var media = b2`<div class="icono-image-only-media-stage">
    ${portraitSrc ? b2`<img
          class="icono-image-only-photo"
          src=${portraitSrc}
          alt=${portraitAlt}
          loading="eager"
          decoding="async"
          fetchpriority="high"
          width=${width > 0 ? String(Math.round(width)) : A}
          height=${height > 0 ? String(Math.round(height)) : A}
        />` : b2`<div class="icono-image-only-fallback" aria-hidden="true"></div>`}
  </div>`;
  var overlay = b2`<div class="icono-image-only-overlay">
    <div class="icono-image-only-caption-row">
      <div class="icono-label-name icono-image-only-name">${model.fullName || model.symbol}</div>
      <div class="icono-label-symbol icono-image-only-symbol">${model.symbol}</div>
    </div>
  </div>`;
  if (href) {
    return b2`<a
      class="icono-image-only-link"
      href=${href}
      target=${modelOpensInNewTab(model) ? "_blank" : A}
      rel=${modelOpensInNewTab(model) ? "noopener noreferrer" : A}
      >${media}${overlay}</a
    >`;
  }
  return b2`<div class="icono-image-only-link">${media}${overlay}</div>`;
}
function parsePayloadFromHost(host) {
  if (!host) return null;
  var encoded = String(host.getAttribute(MODEL_ATTR) || "").trim();
  if (encoded) {
    try {
      return JSON.parse(decodeURIComponent(encoded));
    } catch (error) {
      console.error("[Iconoplasm] failed to parse lit-archival model attribute:", error);
    }
  }
  var node = host.querySelector(MODEL_SELECTOR);
  if (!node) return null;
  try {
    return JSON.parse(node.textContent || "{}");
  } catch (error) {
    console.error("[Iconoplasm] failed to parse lit-archival payload:", error);
    return null;
  }
}
var IconoLitArchivalCard = class extends HTMLElement {
  constructor() {
    super();
    this._model = null;
  }
  connectedCallback() {
    if (!this._model) {
      var payload = parsePayloadFromHost(this);
      if (payload) this._model = resolveCardModel(payload);
    }
    this.render();
  }
  set model(value) {
    this._model = resolveCardModel(value);
    this.render();
  }
  get model() {
    return this._model;
  }
  render() {
    if (!this._model) return;
    D(archivalTemplate(this._model), this);
    var shared = sharedCardRuntime();
    if (shared && typeof shared.hydrateRoughLoops === "function") {
      shared.hydrateRoughLoops(this, true);
    }
  }
};
if (!customElements.get("icono-lit-archival")) {
  customElements.define("icono-lit-archival", IconoLitArchivalCard);
}
/*! Bundled license information:

@lit/reactive-element/css-tag.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

@lit/reactive-element/reactive-element.js:
lit-html/lit-html.js:
lit-element/lit-element.js:
lit-html/directive.js:
lit-html/directives/unsafe-html.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)

lit-html/is-server.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
