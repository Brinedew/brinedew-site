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

// node_modules/@chenglou/pretext/dist/generated/bidi-data.js
var latin1BidiTypes = [
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "S",
  "B",
  "S",
  "WS",
  "B",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "B",
  "B",
  "B",
  "S",
  "WS",
  "ON",
  "ON",
  "ET",
  "ET",
  "ET",
  "ON",
  "ON",
  "ON",
  "ON",
  "ON",
  "ES",
  "CS",
  "ES",
  "CS",
  "CS",
  "EN",
  "EN",
  "EN",
  "EN",
  "EN",
  "EN",
  "EN",
  "EN",
  "EN",
  "EN",
  "CS",
  "ON",
  "ON",
  "ON",
  "ON",
  "ON",
  "ON",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "ON",
  "ON",
  "ON",
  "ON",
  "ON",
  "ON",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "ON",
  "ON",
  "ON",
  "ON",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "B",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "CS",
  "ON",
  "ET",
  "ET",
  "ET",
  "ET",
  "ON",
  "ON",
  "ON",
  "ON",
  "L",
  "ON",
  "ON",
  "BN",
  "ON",
  "ON",
  "ET",
  "ET",
  "EN",
  "EN",
  "ON",
  "L",
  "ON",
  "ON",
  "ON",
  "EN",
  "L",
  "ON",
  "ON",
  "ON",
  "ON",
  "ON",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "ON",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "ON",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L",
  "L"
];
var nonLatin1BidiRanges = [
  [697, 698, "ON"],
  [706, 719, "ON"],
  [722, 735, "ON"],
  [741, 749, "ON"],
  [751, 767, "ON"],
  [768, 879, "NSM"],
  [884, 885, "ON"],
  [894, 894, "ON"],
  [900, 901, "ON"],
  [903, 903, "ON"],
  [1014, 1014, "ON"],
  [1155, 1161, "NSM"],
  [1418, 1418, "ON"],
  [1421, 1422, "ON"],
  [1423, 1423, "ET"],
  [1424, 1424, "R"],
  [1425, 1469, "NSM"],
  [1470, 1470, "R"],
  [1471, 1471, "NSM"],
  [1472, 1472, "R"],
  [1473, 1474, "NSM"],
  [1475, 1475, "R"],
  [1476, 1477, "NSM"],
  [1478, 1478, "R"],
  [1479, 1479, "NSM"],
  [1480, 1535, "R"],
  [1536, 1541, "AN"],
  [1542, 1543, "ON"],
  [1544, 1544, "AL"],
  [1545, 1546, "ET"],
  [1547, 1547, "AL"],
  [1548, 1548, "CS"],
  [1549, 1549, "AL"],
  [1550, 1551, "ON"],
  [1552, 1562, "NSM"],
  [1563, 1610, "AL"],
  [1611, 1631, "NSM"],
  [1632, 1641, "AN"],
  [1642, 1642, "ET"],
  [1643, 1644, "AN"],
  [1645, 1647, "AL"],
  [1648, 1648, "NSM"],
  [1649, 1749, "AL"],
  [1750, 1756, "NSM"],
  [1757, 1757, "AN"],
  [1758, 1758, "ON"],
  [1759, 1764, "NSM"],
  [1765, 1766, "AL"],
  [1767, 1768, "NSM"],
  [1769, 1769, "ON"],
  [1770, 1773, "NSM"],
  [1774, 1775, "AL"],
  [1776, 1785, "EN"],
  [1786, 1808, "AL"],
  [1809, 1809, "NSM"],
  [1810, 1839, "AL"],
  [1840, 1866, "NSM"],
  [1867, 1957, "AL"],
  [1958, 1968, "NSM"],
  [1969, 1983, "AL"],
  [1984, 2026, "R"],
  [2027, 2035, "NSM"],
  [2036, 2037, "R"],
  [2038, 2041, "ON"],
  [2042, 2044, "R"],
  [2045, 2045, "NSM"],
  [2046, 2069, "R"],
  [2070, 2073, "NSM"],
  [2074, 2074, "R"],
  [2075, 2083, "NSM"],
  [2084, 2084, "R"],
  [2085, 2087, "NSM"],
  [2088, 2088, "R"],
  [2089, 2093, "NSM"],
  [2094, 2136, "R"],
  [2137, 2139, "NSM"],
  [2140, 2143, "R"],
  [2144, 2191, "AL"],
  [2192, 2193, "AN"],
  [2194, 2198, "AL"],
  [2199, 2207, "NSM"],
  [2208, 2249, "AL"],
  [2250, 2273, "NSM"],
  [2274, 2274, "AN"],
  [2275, 2306, "NSM"],
  [2362, 2362, "NSM"],
  [2364, 2364, "NSM"],
  [2369, 2376, "NSM"],
  [2381, 2381, "NSM"],
  [2385, 2391, "NSM"],
  [2402, 2403, "NSM"],
  [2433, 2433, "NSM"],
  [2492, 2492, "NSM"],
  [2497, 2500, "NSM"],
  [2509, 2509, "NSM"],
  [2530, 2531, "NSM"],
  [2546, 2547, "ET"],
  [2555, 2555, "ET"],
  [2558, 2558, "NSM"],
  [2561, 2562, "NSM"],
  [2620, 2620, "NSM"],
  [2625, 2626, "NSM"],
  [2631, 2632, "NSM"],
  [2635, 2637, "NSM"],
  [2641, 2641, "NSM"],
  [2672, 2673, "NSM"],
  [2677, 2677, "NSM"],
  [2689, 2690, "NSM"],
  [2748, 2748, "NSM"],
  [2753, 2757, "NSM"],
  [2759, 2760, "NSM"],
  [2765, 2765, "NSM"],
  [2786, 2787, "NSM"],
  [2801, 2801, "ET"],
  [2810, 2815, "NSM"],
  [2817, 2817, "NSM"],
  [2876, 2876, "NSM"],
  [2879, 2879, "NSM"],
  [2881, 2884, "NSM"],
  [2893, 2893, "NSM"],
  [2901, 2902, "NSM"],
  [2914, 2915, "NSM"],
  [2946, 2946, "NSM"],
  [3008, 3008, "NSM"],
  [3021, 3021, "NSM"],
  [3059, 3064, "ON"],
  [3065, 3065, "ET"],
  [3066, 3066, "ON"],
  [3072, 3072, "NSM"],
  [3076, 3076, "NSM"],
  [3132, 3132, "NSM"],
  [3134, 3136, "NSM"],
  [3142, 3144, "NSM"],
  [3146, 3149, "NSM"],
  [3157, 3158, "NSM"],
  [3170, 3171, "NSM"],
  [3192, 3198, "ON"],
  [3201, 3201, "NSM"],
  [3260, 3260, "NSM"],
  [3276, 3277, "NSM"],
  [3298, 3299, "NSM"],
  [3328, 3329, "NSM"],
  [3387, 3388, "NSM"],
  [3393, 3396, "NSM"],
  [3405, 3405, "NSM"],
  [3426, 3427, "NSM"],
  [3457, 3457, "NSM"],
  [3530, 3530, "NSM"],
  [3538, 3540, "NSM"],
  [3542, 3542, "NSM"],
  [3633, 3633, "NSM"],
  [3636, 3642, "NSM"],
  [3647, 3647, "ET"],
  [3655, 3662, "NSM"],
  [3761, 3761, "NSM"],
  [3764, 3772, "NSM"],
  [3784, 3790, "NSM"],
  [3864, 3865, "NSM"],
  [3893, 3893, "NSM"],
  [3895, 3895, "NSM"],
  [3897, 3897, "NSM"],
  [3898, 3901, "ON"],
  [3953, 3966, "NSM"],
  [3968, 3972, "NSM"],
  [3974, 3975, "NSM"],
  [3981, 3991, "NSM"],
  [3993, 4028, "NSM"],
  [4038, 4038, "NSM"],
  [4141, 4144, "NSM"],
  [4146, 4151, "NSM"],
  [4153, 4154, "NSM"],
  [4157, 4158, "NSM"],
  [4184, 4185, "NSM"],
  [4190, 4192, "NSM"],
  [4209, 4212, "NSM"],
  [4226, 4226, "NSM"],
  [4229, 4230, "NSM"],
  [4237, 4237, "NSM"],
  [4253, 4253, "NSM"],
  [4957, 4959, "NSM"],
  [5008, 5017, "ON"],
  [5120, 5120, "ON"],
  [5760, 5760, "WS"],
  [5787, 5788, "ON"],
  [5906, 5908, "NSM"],
  [5938, 5939, "NSM"],
  [5970, 5971, "NSM"],
  [6002, 6003, "NSM"],
  [6068, 6069, "NSM"],
  [6071, 6077, "NSM"],
  [6086, 6086, "NSM"],
  [6089, 6099, "NSM"],
  [6107, 6107, "ET"],
  [6109, 6109, "NSM"],
  [6128, 6137, "ON"],
  [6144, 6154, "ON"],
  [6155, 6157, "NSM"],
  [6158, 6158, "BN"],
  [6159, 6159, "NSM"],
  [6277, 6278, "NSM"],
  [6313, 6313, "NSM"],
  [6432, 6434, "NSM"],
  [6439, 6440, "NSM"],
  [6450, 6450, "NSM"],
  [6457, 6459, "NSM"],
  [6464, 6464, "ON"],
  [6468, 6469, "ON"],
  [6622, 6655, "ON"],
  [6679, 6680, "NSM"],
  [6683, 6683, "NSM"],
  [6742, 6742, "NSM"],
  [6744, 6750, "NSM"],
  [6752, 6752, "NSM"],
  [6754, 6754, "NSM"],
  [6757, 6764, "NSM"],
  [6771, 6780, "NSM"],
  [6783, 6783, "NSM"],
  [6832, 6877, "NSM"],
  [6880, 6891, "NSM"],
  [6912, 6915, "NSM"],
  [6964, 6964, "NSM"],
  [6966, 6970, "NSM"],
  [6972, 6972, "NSM"],
  [6978, 6978, "NSM"],
  [7019, 7027, "NSM"],
  [7040, 7041, "NSM"],
  [7074, 7077, "NSM"],
  [7080, 7081, "NSM"],
  [7083, 7085, "NSM"],
  [7142, 7142, "NSM"],
  [7144, 7145, "NSM"],
  [7149, 7149, "NSM"],
  [7151, 7153, "NSM"],
  [7212, 7219, "NSM"],
  [7222, 7223, "NSM"],
  [7376, 7378, "NSM"],
  [7380, 7392, "NSM"],
  [7394, 7400, "NSM"],
  [7405, 7405, "NSM"],
  [7412, 7412, "NSM"],
  [7416, 7417, "NSM"],
  [7616, 7679, "NSM"],
  [8125, 8125, "ON"],
  [8127, 8129, "ON"],
  [8141, 8143, "ON"],
  [8157, 8159, "ON"],
  [8173, 8175, "ON"],
  [8189, 8190, "ON"],
  [8192, 8202, "WS"],
  [8203, 8205, "BN"],
  [8207, 8207, "R"],
  [8208, 8231, "ON"],
  [8232, 8232, "WS"],
  [8233, 8233, "B"],
  [8234, 8238, "BN"],
  [8239, 8239, "CS"],
  [8240, 8244, "ET"],
  [8245, 8259, "ON"],
  [8260, 8260, "CS"],
  [8261, 8286, "ON"],
  [8287, 8287, "WS"],
  [8288, 8303, "BN"],
  [8304, 8304, "EN"],
  [8308, 8313, "EN"],
  [8314, 8315, "ES"],
  [8316, 8318, "ON"],
  [8320, 8329, "EN"],
  [8330, 8331, "ES"],
  [8332, 8334, "ON"],
  [8352, 8399, "ET"],
  [8400, 8432, "NSM"],
  [8448, 8449, "ON"],
  [8451, 8454, "ON"],
  [8456, 8457, "ON"],
  [8468, 8468, "ON"],
  [8470, 8472, "ON"],
  [8478, 8483, "ON"],
  [8485, 8485, "ON"],
  [8487, 8487, "ON"],
  [8489, 8489, "ON"],
  [8494, 8494, "ET"],
  [8506, 8507, "ON"],
  [8512, 8516, "ON"],
  [8522, 8525, "ON"],
  [8528, 8543, "ON"],
  [8585, 8587, "ON"],
  [8592, 8721, "ON"],
  [8722, 8722, "ES"],
  [8723, 8723, "ET"],
  [8724, 9013, "ON"],
  [9083, 9108, "ON"],
  [9110, 9257, "ON"],
  [9280, 9290, "ON"],
  [9312, 9351, "ON"],
  [9352, 9371, "EN"],
  [9450, 9899, "ON"],
  [9901, 10239, "ON"],
  [10496, 11123, "ON"],
  [11126, 11263, "ON"],
  [11493, 11498, "ON"],
  [11503, 11505, "NSM"],
  [11513, 11519, "ON"],
  [11647, 11647, "NSM"],
  [11744, 11775, "NSM"],
  [11776, 11869, "ON"],
  [11904, 11929, "ON"],
  [11931, 12019, "ON"],
  [12032, 12245, "ON"],
  [12272, 12287, "ON"],
  [12288, 12288, "WS"],
  [12289, 12292, "ON"],
  [12296, 12320, "ON"],
  [12330, 12333, "NSM"],
  [12336, 12336, "ON"],
  [12342, 12343, "ON"],
  [12349, 12351, "ON"],
  [12441, 12442, "NSM"],
  [12443, 12444, "ON"],
  [12448, 12448, "ON"],
  [12539, 12539, "ON"],
  [12736, 12773, "ON"],
  [12783, 12783, "ON"],
  [12829, 12830, "ON"],
  [12880, 12895, "ON"],
  [12924, 12926, "ON"],
  [12977, 12991, "ON"],
  [13004, 13007, "ON"],
  [13175, 13178, "ON"],
  [13278, 13279, "ON"],
  [13311, 13311, "ON"],
  [19904, 19967, "ON"],
  [42128, 42182, "ON"],
  [42509, 42511, "ON"],
  [42607, 42610, "NSM"],
  [42611, 42611, "ON"],
  [42612, 42621, "NSM"],
  [42622, 42623, "ON"],
  [42654, 42655, "NSM"],
  [42736, 42737, "NSM"],
  [42752, 42785, "ON"],
  [42888, 42888, "ON"],
  [43010, 43010, "NSM"],
  [43014, 43014, "NSM"],
  [43019, 43019, "NSM"],
  [43045, 43046, "NSM"],
  [43048, 43051, "ON"],
  [43052, 43052, "NSM"],
  [43064, 43065, "ET"],
  [43124, 43127, "ON"],
  [43204, 43205, "NSM"],
  [43232, 43249, "NSM"],
  [43263, 43263, "NSM"],
  [43302, 43309, "NSM"],
  [43335, 43345, "NSM"],
  [43392, 43394, "NSM"],
  [43443, 43443, "NSM"],
  [43446, 43449, "NSM"],
  [43452, 43453, "NSM"],
  [43493, 43493, "NSM"],
  [43561, 43566, "NSM"],
  [43569, 43570, "NSM"],
  [43573, 43574, "NSM"],
  [43587, 43587, "NSM"],
  [43596, 43596, "NSM"],
  [43644, 43644, "NSM"],
  [43696, 43696, "NSM"],
  [43698, 43700, "NSM"],
  [43703, 43704, "NSM"],
  [43710, 43711, "NSM"],
  [43713, 43713, "NSM"],
  [43756, 43757, "NSM"],
  [43766, 43766, "NSM"],
  [43882, 43883, "ON"],
  [44005, 44005, "NSM"],
  [44008, 44008, "NSM"],
  [44013, 44013, "NSM"],
  [64285, 64285, "R"],
  [64286, 64286, "NSM"],
  [64287, 64296, "R"],
  [64297, 64297, "ES"],
  [64298, 64335, "R"],
  [64336, 64450, "AL"],
  [64451, 64466, "ON"],
  [64467, 64829, "AL"],
  [64830, 64847, "ON"],
  [64848, 64911, "AL"],
  [64912, 64913, "ON"],
  [64914, 64967, "AL"],
  [64968, 64975, "ON"],
  [64976, 65007, "BN"],
  [65008, 65020, "AL"],
  [65021, 65023, "ON"],
  [65024, 65039, "NSM"],
  [65040, 65049, "ON"],
  [65056, 65071, "NSM"],
  [65072, 65103, "ON"],
  [65104, 65104, "CS"],
  [65105, 65105, "ON"],
  [65106, 65106, "CS"],
  [65108, 65108, "ON"],
  [65109, 65109, "CS"],
  [65110, 65118, "ON"],
  [65119, 65119, "ET"],
  [65120, 65121, "ON"],
  [65122, 65123, "ES"],
  [65124, 65126, "ON"],
  [65128, 65128, "ON"],
  [65129, 65130, "ET"],
  [65131, 65131, "ON"],
  [65136, 65278, "AL"],
  [65279, 65279, "BN"],
  [65281, 65282, "ON"],
  [65283, 65285, "ET"],
  [65286, 65290, "ON"],
  [65291, 65291, "ES"],
  [65292, 65292, "CS"],
  [65293, 65293, "ES"],
  [65294, 65295, "CS"],
  [65296, 65305, "EN"],
  [65306, 65306, "CS"],
  [65307, 65312, "ON"],
  [65339, 65344, "ON"],
  [65371, 65381, "ON"],
  [65504, 65505, "ET"],
  [65506, 65508, "ON"],
  [65509, 65510, "ET"],
  [65512, 65518, "ON"],
  [65520, 65528, "BN"],
  [65529, 65533, "ON"],
  [65534, 65535, "BN"],
  [65793, 65793, "ON"],
  [65856, 65932, "ON"],
  [65936, 65948, "ON"],
  [65952, 65952, "ON"],
  [66045, 66045, "NSM"],
  [66272, 66272, "NSM"],
  [66273, 66299, "EN"],
  [66422, 66426, "NSM"],
  [67584, 67870, "R"],
  [67871, 67871, "ON"],
  [67872, 68096, "R"],
  [68097, 68099, "NSM"],
  [68100, 68100, "R"],
  [68101, 68102, "NSM"],
  [68103, 68107, "R"],
  [68108, 68111, "NSM"],
  [68112, 68151, "R"],
  [68152, 68154, "NSM"],
  [68155, 68158, "R"],
  [68159, 68159, "NSM"],
  [68160, 68324, "R"],
  [68325, 68326, "NSM"],
  [68327, 68408, "R"],
  [68409, 68415, "ON"],
  [68416, 68863, "R"],
  [68864, 68899, "AL"],
  [68900, 68903, "NSM"],
  [68904, 68911, "AL"],
  [68912, 68921, "AN"],
  [68922, 68927, "AL"],
  [68928, 68937, "AN"],
  [68938, 68968, "R"],
  [68969, 68973, "NSM"],
  [68974, 68974, "ON"],
  [68975, 69215, "R"],
  [69216, 69246, "AN"],
  [69247, 69290, "R"],
  [69291, 69292, "NSM"],
  [69293, 69311, "R"],
  [69312, 69327, "AL"],
  [69328, 69336, "ON"],
  [69337, 69369, "AL"],
  [69370, 69375, "NSM"],
  [69376, 69423, "R"],
  [69424, 69445, "AL"],
  [69446, 69456, "NSM"],
  [69457, 69487, "AL"],
  [69488, 69505, "R"],
  [69506, 69509, "NSM"],
  [69510, 69631, "R"],
  [69633, 69633, "NSM"],
  [69688, 69702, "NSM"],
  [69714, 69733, "ON"],
  [69744, 69744, "NSM"],
  [69747, 69748, "NSM"],
  [69759, 69761, "NSM"],
  [69811, 69814, "NSM"],
  [69817, 69818, "NSM"],
  [69826, 69826, "NSM"],
  [69888, 69890, "NSM"],
  [69927, 69931, "NSM"],
  [69933, 69940, "NSM"],
  [70003, 70003, "NSM"],
  [70016, 70017, "NSM"],
  [70070, 70078, "NSM"],
  [70089, 70092, "NSM"],
  [70095, 70095, "NSM"],
  [70191, 70193, "NSM"],
  [70196, 70196, "NSM"],
  [70198, 70199, "NSM"],
  [70206, 70206, "NSM"],
  [70209, 70209, "NSM"],
  [70367, 70367, "NSM"],
  [70371, 70378, "NSM"],
  [70400, 70401, "NSM"],
  [70459, 70460, "NSM"],
  [70464, 70464, "NSM"],
  [70502, 70508, "NSM"],
  [70512, 70516, "NSM"],
  [70587, 70592, "NSM"],
  [70606, 70606, "NSM"],
  [70608, 70608, "NSM"],
  [70610, 70610, "NSM"],
  [70625, 70626, "NSM"],
  [70712, 70719, "NSM"],
  [70722, 70724, "NSM"],
  [70726, 70726, "NSM"],
  [70750, 70750, "NSM"],
  [70835, 70840, "NSM"],
  [70842, 70842, "NSM"],
  [70847, 70848, "NSM"],
  [70850, 70851, "NSM"],
  [71090, 71093, "NSM"],
  [71100, 71101, "NSM"],
  [71103, 71104, "NSM"],
  [71132, 71133, "NSM"],
  [71219, 71226, "NSM"],
  [71229, 71229, "NSM"],
  [71231, 71232, "NSM"],
  [71264, 71276, "ON"],
  [71339, 71339, "NSM"],
  [71341, 71341, "NSM"],
  [71344, 71349, "NSM"],
  [71351, 71351, "NSM"],
  [71453, 71453, "NSM"],
  [71455, 71455, "NSM"],
  [71458, 71461, "NSM"],
  [71463, 71467, "NSM"],
  [71727, 71735, "NSM"],
  [71737, 71738, "NSM"],
  [71995, 71996, "NSM"],
  [71998, 71998, "NSM"],
  [72003, 72003, "NSM"],
  [72148, 72151, "NSM"],
  [72154, 72155, "NSM"],
  [72160, 72160, "NSM"],
  [72193, 72198, "NSM"],
  [72201, 72202, "NSM"],
  [72243, 72248, "NSM"],
  [72251, 72254, "NSM"],
  [72263, 72263, "NSM"],
  [72273, 72278, "NSM"],
  [72281, 72283, "NSM"],
  [72330, 72342, "NSM"],
  [72344, 72345, "NSM"],
  [72544, 72544, "NSM"],
  [72546, 72548, "NSM"],
  [72550, 72550, "NSM"],
  [72752, 72758, "NSM"],
  [72760, 72765, "NSM"],
  [72850, 72871, "NSM"],
  [72874, 72880, "NSM"],
  [72882, 72883, "NSM"],
  [72885, 72886, "NSM"],
  [73009, 73014, "NSM"],
  [73018, 73018, "NSM"],
  [73020, 73021, "NSM"],
  [73023, 73029, "NSM"],
  [73031, 73031, "NSM"],
  [73104, 73105, "NSM"],
  [73109, 73109, "NSM"],
  [73111, 73111, "NSM"],
  [73459, 73460, "NSM"],
  [73472, 73473, "NSM"],
  [73526, 73530, "NSM"],
  [73536, 73536, "NSM"],
  [73538, 73538, "NSM"],
  [73562, 73562, "NSM"],
  [73685, 73692, "ON"],
  [73693, 73696, "ET"],
  [73697, 73713, "ON"],
  [78912, 78912, "NSM"],
  [78919, 78933, "NSM"],
  [90398, 90409, "NSM"],
  [90413, 90415, "NSM"],
  [92912, 92916, "NSM"],
  [92976, 92982, "NSM"],
  [94031, 94031, "NSM"],
  [94095, 94098, "NSM"],
  [94178, 94178, "ON"],
  [94180, 94180, "NSM"],
  [113821, 113822, "NSM"],
  [113824, 113827, "BN"],
  [117760, 117973, "ON"],
  [118e3, 118009, "EN"],
  [118010, 118012, "ON"],
  [118016, 118451, "ON"],
  [118458, 118480, "ON"],
  [118496, 118512, "ON"],
  [118528, 118573, "NSM"],
  [118576, 118598, "NSM"],
  [119143, 119145, "NSM"],
  [119155, 119162, "BN"],
  [119163, 119170, "NSM"],
  [119173, 119179, "NSM"],
  [119210, 119213, "NSM"],
  [119273, 119274, "ON"],
  [119296, 119361, "ON"],
  [119362, 119364, "NSM"],
  [119365, 119365, "ON"],
  [119552, 119638, "ON"],
  [120513, 120513, "ON"],
  [120539, 120539, "ON"],
  [120571, 120571, "ON"],
  [120597, 120597, "ON"],
  [120629, 120629, "ON"],
  [120655, 120655, "ON"],
  [120687, 120687, "ON"],
  [120713, 120713, "ON"],
  [120745, 120745, "ON"],
  [120771, 120771, "ON"],
  [120782, 120831, "EN"],
  [121344, 121398, "NSM"],
  [121403, 121452, "NSM"],
  [121461, 121461, "NSM"],
  [121476, 121476, "NSM"],
  [121499, 121503, "NSM"],
  [121505, 121519, "NSM"],
  [122880, 122886, "NSM"],
  [122888, 122904, "NSM"],
  [122907, 122913, "NSM"],
  [122915, 122916, "NSM"],
  [122918, 122922, "NSM"],
  [123023, 123023, "NSM"],
  [123184, 123190, "NSM"],
  [123566, 123566, "NSM"],
  [123628, 123631, "NSM"],
  [123647, 123647, "ET"],
  [124140, 124143, "NSM"],
  [124398, 124399, "NSM"],
  [124643, 124643, "NSM"],
  [124646, 124646, "NSM"],
  [124654, 124655, "NSM"],
  [124661, 124661, "NSM"],
  [124928, 125135, "R"],
  [125136, 125142, "NSM"],
  [125143, 125251, "R"],
  [125252, 125258, "NSM"],
  [125259, 126063, "R"],
  [126064, 126143, "AL"],
  [126144, 126207, "R"],
  [126208, 126287, "AL"],
  [126288, 126463, "R"],
  [126464, 126703, "AL"],
  [126704, 126705, "ON"],
  [126706, 126719, "AL"],
  [126720, 126975, "R"],
  [126976, 127019, "ON"],
  [127024, 127123, "ON"],
  [127136, 127150, "ON"],
  [127153, 127167, "ON"],
  [127169, 127183, "ON"],
  [127185, 127221, "ON"],
  [127232, 127242, "EN"],
  [127243, 127247, "ON"],
  [127279, 127279, "ON"],
  [127338, 127343, "ON"],
  [127405, 127405, "ON"],
  [127584, 127589, "ON"],
  [127744, 128728, "ON"],
  [128732, 128748, "ON"],
  [128752, 128764, "ON"],
  [128768, 128985, "ON"],
  [128992, 129003, "ON"],
  [129008, 129008, "ON"],
  [129024, 129035, "ON"],
  [129040, 129095, "ON"],
  [129104, 129113, "ON"],
  [129120, 129159, "ON"],
  [129168, 129197, "ON"],
  [129200, 129211, "ON"],
  [129216, 129217, "ON"],
  [129232, 129240, "ON"],
  [129280, 129623, "ON"],
  [129632, 129645, "ON"],
  [129648, 129660, "ON"],
  [129664, 129674, "ON"],
  [129678, 129734, "ON"],
  [129736, 129736, "ON"],
  [129741, 129756, "ON"],
  [129759, 129770, "ON"],
  [129775, 129784, "ON"],
  [129792, 129938, "ON"],
  [129940, 130031, "ON"],
  [130032, 130041, "EN"],
  [130042, 130042, "ON"],
  [131070, 131071, "BN"],
  [196606, 196607, "BN"],
  [262142, 262143, "BN"],
  [327678, 327679, "BN"],
  [393214, 393215, "BN"],
  [458750, 458751, "BN"],
  [524286, 524287, "BN"],
  [589822, 589823, "BN"],
  [655358, 655359, "BN"],
  [720894, 720895, "BN"],
  [786430, 786431, "BN"],
  [851966, 851967, "BN"],
  [917502, 917759, "BN"],
  [917760, 917999, "NSM"],
  [918e3, 921599, "BN"],
  [983038, 983039, "BN"],
  [1048574, 1048575, "BN"],
  [1114110, 1114111, "BN"]
];

// node_modules/@chenglou/pretext/dist/bidi.js
function classifyCodePoint(codePoint) {
  if (codePoint <= 255)
    return latin1BidiTypes[codePoint];
  let lo = 0;
  let hi = nonLatin1BidiRanges.length - 1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    const range = nonLatin1BidiRanges[mid];
    if (codePoint < range[0]) {
      hi = mid - 1;
      continue;
    }
    if (codePoint > range[1]) {
      lo = mid + 1;
      continue;
    }
    return range[2];
  }
  return "L";
}
function computeBidiLevels(str) {
  const len = str.length;
  if (len === 0)
    return null;
  const types = new Array(len);
  let sawBidi = false;
  for (let i6 = 0; i6 < len; ) {
    const first = str.charCodeAt(i6);
    let codePoint = first;
    let codeUnitLength = 1;
    if (first >= 55296 && first <= 56319 && i6 + 1 < len) {
      const second = str.charCodeAt(i6 + 1);
      if (second >= 56320 && second <= 57343) {
        codePoint = (first - 55296 << 10) + (second - 56320) + 65536;
        codeUnitLength = 2;
      }
    }
    const t4 = classifyCodePoint(codePoint);
    if (t4 === "R" || t4 === "AL" || t4 === "AN")
      sawBidi = true;
    for (let j = 0; j < codeUnitLength; j++) {
      types[i6 + j] = t4;
    }
    i6 += codeUnitLength;
  }
  if (!sawBidi)
    return null;
  let startLevel = 0;
  for (let i6 = 0; i6 < len; i6++) {
    const t4 = types[i6];
    if (t4 === "L") {
      startLevel = 0;
      break;
    }
    if (t4 === "R" || t4 === "AL") {
      startLevel = 1;
      break;
    }
  }
  const levels = new Int8Array(len);
  for (let i6 = 0; i6 < len; i6++)
    levels[i6] = startLevel;
  const e6 = startLevel & 1 ? "R" : "L";
  const sor = e6;
  let lastType = sor;
  for (let i6 = 0; i6 < len; i6++) {
    if (types[i6] === "NSM")
      types[i6] = lastType;
    else
      lastType = types[i6];
  }
  lastType = sor;
  for (let i6 = 0; i6 < len; i6++) {
    const t4 = types[i6];
    if (t4 === "EN")
      types[i6] = lastType === "AL" ? "AN" : "EN";
    else if (t4 === "R" || t4 === "L" || t4 === "AL")
      lastType = t4;
  }
  for (let i6 = 0; i6 < len; i6++) {
    if (types[i6] === "AL")
      types[i6] = "R";
  }
  for (let i6 = 1; i6 < len - 1; i6++) {
    if (types[i6] === "ES" && types[i6 - 1] === "EN" && types[i6 + 1] === "EN") {
      types[i6] = "EN";
    }
    if (types[i6] === "CS" && (types[i6 - 1] === "EN" || types[i6 - 1] === "AN") && types[i6 + 1] === types[i6 - 1]) {
      types[i6] = types[i6 - 1];
    }
  }
  for (let i6 = 0; i6 < len; i6++) {
    if (types[i6] !== "EN")
      continue;
    let j;
    for (j = i6 - 1; j >= 0 && types[j] === "ET"; j--)
      types[j] = "EN";
    for (j = i6 + 1; j < len && types[j] === "ET"; j++)
      types[j] = "EN";
  }
  for (let i6 = 0; i6 < len; i6++) {
    const t4 = types[i6];
    if (t4 === "WS" || t4 === "ES" || t4 === "ET" || t4 === "CS")
      types[i6] = "ON";
  }
  lastType = sor;
  for (let i6 = 0; i6 < len; i6++) {
    const t4 = types[i6];
    if (t4 === "EN")
      types[i6] = lastType === "L" ? "L" : "EN";
    else if (t4 === "R" || t4 === "L")
      lastType = t4;
  }
  for (let i6 = 0; i6 < len; i6++) {
    if (types[i6] !== "ON")
      continue;
    let end = i6 + 1;
    while (end < len && types[end] === "ON")
      end++;
    const before = i6 > 0 ? types[i6 - 1] : sor;
    const after = end < len ? types[end] : sor;
    const bDir = before !== "L" ? "R" : "L";
    const aDir = after !== "L" ? "R" : "L";
    if (bDir === aDir) {
      for (let j = i6; j < end; j++)
        types[j] = bDir;
    }
    i6 = end - 1;
  }
  for (let i6 = 0; i6 < len; i6++) {
    if (types[i6] === "ON")
      types[i6] = e6;
  }
  for (let i6 = 0; i6 < len; i6++) {
    const t4 = types[i6];
    if ((levels[i6] & 1) === 0) {
      if (t4 === "R")
        levels[i6]++;
      else if (t4 === "AN" || t4 === "EN")
        levels[i6] += 2;
    } else if (t4 === "L" || t4 === "AN" || t4 === "EN") {
      levels[i6]++;
    }
  }
  return levels;
}
function computeSegmentLevels(normalized, segStarts) {
  const bidiLevels = computeBidiLevels(normalized);
  if (bidiLevels === null)
    return null;
  const segLevels = new Int8Array(segStarts.length);
  for (let i6 = 0; i6 < segStarts.length; i6++) {
    segLevels[i6] = bidiLevels[segStarts[i6]];
  }
  return segLevels;
}

// node_modules/@chenglou/pretext/dist/analysis.js
var collapsibleWhitespaceRunRe = /[ \t\n\r\f]+/g;
var needsWhitespaceNormalizationRe = /[\t\n\r\f]| {2,}|^ | $/;
function getWhiteSpaceProfile(whiteSpace) {
  const mode = whiteSpace ?? "normal";
  return mode === "pre-wrap" ? { mode, preserveOrdinarySpaces: true, preserveHardBreaks: true } : { mode, preserveOrdinarySpaces: false, preserveHardBreaks: false };
}
function normalizeWhitespaceNormal(text) {
  if (!needsWhitespaceNormalizationRe.test(text))
    return text;
  let normalized = text.replace(collapsibleWhitespaceRunRe, " ");
  if (normalized.charCodeAt(0) === 32) {
    normalized = normalized.slice(1);
  }
  if (normalized.length > 0 && normalized.charCodeAt(normalized.length - 1) === 32) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
function normalizeWhitespacePreWrap(text) {
  if (!/[\r\f]/.test(text))
    return text;
  return text.replace(/\r\n/g, "\n").replace(/[\r\f]/g, "\n");
}
var sharedWordSegmenter = null;
var segmenterLocale;
function getSharedWordSegmenter() {
  if (sharedWordSegmenter === null) {
    sharedWordSegmenter = new Intl.Segmenter(segmenterLocale, { granularity: "word" });
  }
  return sharedWordSegmenter;
}
var arabicScriptRe = /\p{Script=Arabic}/u;
var combiningMarkRe = /\p{M}/u;
var decimalDigitRe = /\p{Nd}/u;
function containsArabicScript(text) {
  return arabicScriptRe.test(text);
}
function isCJKCodePoint(codePoint) {
  return codePoint >= 19968 && codePoint <= 40959 || codePoint >= 13312 && codePoint <= 19903 || codePoint >= 131072 && codePoint <= 173791 || codePoint >= 173824 && codePoint <= 177983 || codePoint >= 177984 && codePoint <= 178207 || codePoint >= 178208 && codePoint <= 183983 || codePoint >= 183984 && codePoint <= 191471 || codePoint >= 191472 && codePoint <= 192093 || codePoint >= 194560 && codePoint <= 195103 || codePoint >= 196608 && codePoint <= 201551 || codePoint >= 201552 && codePoint <= 205743 || codePoint >= 205744 && codePoint <= 210041 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 12288 && codePoint <= 12351 || codePoint >= 12352 && codePoint <= 12447 || codePoint >= 12448 && codePoint <= 12543 || codePoint >= 12592 && codePoint <= 12687 || codePoint >= 44032 && codePoint <= 55215 || codePoint >= 65280 && codePoint <= 65519;
}
function isCJK(s4) {
  for (let i6 = 0; i6 < s4.length; i6++) {
    const first = s4.charCodeAt(i6);
    if (first < 12288)
      continue;
    if (first >= 55296 && first <= 56319 && i6 + 1 < s4.length) {
      const second = s4.charCodeAt(i6 + 1);
      if (second >= 56320 && second <= 57343) {
        const codePoint = (first - 55296 << 10) + (second - 56320) + 65536;
        if (isCJKCodePoint(codePoint))
          return true;
        i6++;
        continue;
      }
    }
    if (isCJKCodePoint(first))
      return true;
  }
  return false;
}
function endsWithLineStartProhibitedText(text) {
  const last = getLastCodePoint(text);
  return last !== null && (kinsokuStart.has(last) || leftStickyPunctuation.has(last));
}
var keepAllGlueChars = /* @__PURE__ */ new Set([
  "\xA0",
  "\u202F",
  "\u2060",
  "\uFEFF"
]);
function containsCJKText(text) {
  return isCJK(text);
}
function endsWithKeepAllGlueText(text) {
  const last = getLastCodePoint(text);
  return last !== null && keepAllGlueChars.has(last);
}
function canContinueKeepAllTextRun(previousText) {
  return !endsWithLineStartProhibitedText(previousText) && !endsWithKeepAllGlueText(previousText);
}
var kinsokuStart = /* @__PURE__ */ new Set([
  "\uFF0C",
  "\uFF0E",
  "\uFF01",
  "\uFF1A",
  "\uFF1B",
  "\uFF1F",
  "\u3001",
  "\u3002",
  "\u30FB",
  "\uFF09",
  "\u3015",
  "\u3009",
  "\u300B",
  "\u300D",
  "\u300F",
  "\u3011",
  "\u3017",
  "\u3019",
  "\u301B",
  "\u30FC",
  "\u3005",
  "\u303B",
  "\u309D",
  "\u309E",
  "\u30FD",
  "\u30FE"
]);
var kinsokuEnd = /* @__PURE__ */ new Set([
  '"',
  "(",
  "[",
  "{",
  "\u201C",
  "\u2018",
  "\xAB",
  "\u2039",
  "\uFF08",
  "\u3014",
  "\u3008",
  "\u300A",
  "\u300C",
  "\u300E",
  "\u3010",
  "\u3016",
  "\u3018",
  "\u301A"
]);
var forwardStickyGlue = /* @__PURE__ */ new Set([
  "'",
  "\u2019"
]);
var leftStickyPunctuation = /* @__PURE__ */ new Set([
  ".",
  ",",
  "!",
  "?",
  ":",
  ";",
  "\u060C",
  "\u061B",
  "\u061F",
  "\u0964",
  "\u0965",
  "\u104A",
  "\u104B",
  "\u104C",
  "\u104D",
  "\u104F",
  ")",
  "]",
  "}",
  "%",
  '"',
  "\u201D",
  "\u2019",
  "\xBB",
  "\u203A",
  "\u2026"
]);
var arabicNoSpaceTrailingPunctuation = /* @__PURE__ */ new Set([
  ":",
  ".",
  "\u060C",
  "\u061B"
]);
var myanmarMedialGlue = /* @__PURE__ */ new Set([
  "\u104F"
]);
var closingQuoteChars = /* @__PURE__ */ new Set([
  "\u201D",
  "\u2019",
  "\xBB",
  "\u203A",
  "\u300D",
  "\u300F",
  "\u3011",
  "\u300B",
  "\u3009",
  "\u3015",
  "\uFF09"
]);
function isLeftStickyPunctuationSegment(segment) {
  if (isEscapedQuoteClusterSegment(segment))
    return true;
  let sawPunctuation = false;
  for (const ch of segment) {
    if (leftStickyPunctuation.has(ch)) {
      sawPunctuation = true;
      continue;
    }
    if (sawPunctuation && combiningMarkRe.test(ch))
      continue;
    return false;
  }
  return sawPunctuation;
}
function isCJKLineStartProhibitedSegment(segment) {
  for (const ch of segment) {
    if (!kinsokuStart.has(ch) && !leftStickyPunctuation.has(ch))
      return false;
  }
  return segment.length > 0;
}
function isForwardStickyClusterSegment(segment) {
  if (isEscapedQuoteClusterSegment(segment))
    return true;
  for (const ch of segment) {
    if (!kinsokuEnd.has(ch) && !forwardStickyGlue.has(ch) && !combiningMarkRe.test(ch))
      return false;
  }
  return segment.length > 0;
}
function isEscapedQuoteClusterSegment(segment) {
  let sawQuote = false;
  for (const ch of segment) {
    if (ch === "\\" || combiningMarkRe.test(ch))
      continue;
    if (kinsokuEnd.has(ch) || leftStickyPunctuation.has(ch) || forwardStickyGlue.has(ch)) {
      sawQuote = true;
      continue;
    }
    return false;
  }
  return sawQuote;
}
function previousCodePointStart(text, end) {
  const last = end - 1;
  if (last <= 0)
    return Math.max(last, 0);
  const lastCodeUnit = text.charCodeAt(last);
  if (lastCodeUnit < 56320 || lastCodeUnit > 57343)
    return last;
  const maybeHigh = last - 1;
  if (maybeHigh < 0)
    return last;
  const highCodeUnit = text.charCodeAt(maybeHigh);
  return highCodeUnit >= 55296 && highCodeUnit <= 56319 ? maybeHigh : last;
}
function getLastCodePoint(text) {
  if (text.length === 0)
    return null;
  const start = previousCodePointStart(text, text.length);
  return text.slice(start);
}
function splitTrailingForwardStickyCluster(text) {
  const chars = Array.from(text);
  let splitIndex = chars.length;
  while (splitIndex > 0) {
    const ch = chars[splitIndex - 1];
    if (combiningMarkRe.test(ch)) {
      splitIndex--;
      continue;
    }
    if (kinsokuEnd.has(ch) || forwardStickyGlue.has(ch)) {
      splitIndex--;
      continue;
    }
    break;
  }
  if (splitIndex <= 0 || splitIndex === chars.length)
    return null;
  return {
    head: chars.slice(0, splitIndex).join(""),
    tail: chars.slice(splitIndex).join("")
  };
}
function getRepeatableSingleCharRunChar(text, isWordLike, kind) {
  return kind === "text" && !isWordLike && text.length === 1 && text !== "-" && text !== "\u2014" ? text : null;
}
function materializeDeferredSingleCharRun(texts, chars, lengths, index) {
  const ch = chars[index];
  const text = texts[index];
  if (ch == null)
    return text;
  const length = lengths[index];
  if (text.length === length)
    return text;
  const materialized = ch.repeat(length);
  texts[index] = materialized;
  return materialized;
}
function hasArabicNoSpacePunctuation(containsArabic, lastCodePoint) {
  return containsArabic && lastCodePoint !== null && arabicNoSpaceTrailingPunctuation.has(lastCodePoint);
}
function endsWithMyanmarMedialGlue(segment) {
  const lastCodePoint = getLastCodePoint(segment);
  return lastCodePoint !== null && myanmarMedialGlue.has(lastCodePoint);
}
function splitLeadingSpaceAndMarks(segment) {
  if (segment.length < 2 || segment[0] !== " ")
    return null;
  const marks = segment.slice(1);
  if (/^\p{M}+$/u.test(marks)) {
    return { space: " ", marks };
  }
  return null;
}
function endsWithClosingQuote(text) {
  let end = text.length;
  while (end > 0) {
    const start = previousCodePointStart(text, end);
    const ch = text.slice(start, end);
    if (closingQuoteChars.has(ch))
      return true;
    if (!leftStickyPunctuation.has(ch))
      return false;
    end = start;
  }
  return false;
}
function classifySegmentBreakChar(ch, whiteSpaceProfile) {
  if (whiteSpaceProfile.preserveOrdinarySpaces || whiteSpaceProfile.preserveHardBreaks) {
    if (ch === " ")
      return "preserved-space";
    if (ch === "	")
      return "tab";
    if (whiteSpaceProfile.preserveHardBreaks && ch === "\n")
      return "hard-break";
  }
  if (ch === " ")
    return "space";
  if (ch === "\xA0" || ch === "\u202F" || ch === "\u2060" || ch === "\uFEFF") {
    return "glue";
  }
  if (ch === "\u200B")
    return "zero-width-break";
  if (ch === "\xAD")
    return "soft-hyphen";
  return "text";
}
var breakCharRe = /[\x20\t\n\xA0\xAD\u200B\u202F\u2060\uFEFF]/;
function joinTextParts(parts) {
  return parts.length === 1 ? parts[0] : parts.join("");
}
function joinReversedPrefixParts(prefixParts, tail) {
  const parts = [];
  for (let i6 = prefixParts.length - 1; i6 >= 0; i6--) {
    parts.push(prefixParts[i6]);
  }
  parts.push(tail);
  return joinTextParts(parts);
}
function splitSegmentByBreakKind(segment, isWordLike, start, whiteSpaceProfile) {
  if (!breakCharRe.test(segment)) {
    return [{ text: segment, isWordLike, kind: "text", start }];
  }
  const pieces = [];
  let currentKind = null;
  let currentTextParts = [];
  let currentStart = start;
  let currentWordLike = false;
  let offset = 0;
  for (const ch of segment) {
    const kind = classifySegmentBreakChar(ch, whiteSpaceProfile);
    const wordLike = kind === "text" && isWordLike;
    if (currentKind !== null && kind === currentKind && wordLike === currentWordLike) {
      currentTextParts.push(ch);
      offset += ch.length;
      continue;
    }
    if (currentKind !== null) {
      pieces.push({
        text: joinTextParts(currentTextParts),
        isWordLike: currentWordLike,
        kind: currentKind,
        start: currentStart
      });
    }
    currentKind = kind;
    currentTextParts = [ch];
    currentStart = start + offset;
    currentWordLike = wordLike;
    offset += ch.length;
  }
  if (currentKind !== null) {
    pieces.push({
      text: joinTextParts(currentTextParts),
      isWordLike: currentWordLike,
      kind: currentKind,
      start: currentStart
    });
  }
  return pieces;
}
function isTextRunBoundary(kind) {
  return kind === "space" || kind === "preserved-space" || kind === "zero-width-break" || kind === "hard-break";
}
var urlSchemeSegmentRe = /^[A-Za-z][A-Za-z0-9+.-]*:$/;
function isUrlLikeRunStart(segmentation, index) {
  const text = segmentation.texts[index];
  if (text.startsWith("www."))
    return true;
  return urlSchemeSegmentRe.test(text) && index + 1 < segmentation.len && segmentation.kinds[index + 1] === "text" && segmentation.texts[index + 1] === "//";
}
function isUrlQueryBoundarySegment(text) {
  return text.includes("?") && (text.includes("://") || text.startsWith("www."));
}
function mergeUrlLikeRuns(segmentation) {
  const texts = segmentation.texts.slice();
  const isWordLike = segmentation.isWordLike.slice();
  const kinds = segmentation.kinds.slice();
  const starts = segmentation.starts.slice();
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    if (kinds[i6] !== "text" || !isUrlLikeRunStart(segmentation, i6))
      continue;
    const mergedParts = [texts[i6]];
    let j = i6 + 1;
    while (j < segmentation.len && !isTextRunBoundary(kinds[j])) {
      mergedParts.push(texts[j]);
      isWordLike[i6] = true;
      const endsQueryPrefix = texts[j].includes("?");
      kinds[j] = "text";
      texts[j] = "";
      j++;
      if (endsQueryPrefix)
        break;
    }
    texts[i6] = joinTextParts(mergedParts);
  }
  let compactLen = 0;
  for (let read = 0; read < texts.length; read++) {
    const text = texts[read];
    if (text.length === 0)
      continue;
    if (compactLen !== read) {
      texts[compactLen] = text;
      isWordLike[compactLen] = isWordLike[read];
      kinds[compactLen] = kinds[read];
      starts[compactLen] = starts[read];
    }
    compactLen++;
  }
  texts.length = compactLen;
  isWordLike.length = compactLen;
  kinds.length = compactLen;
  starts.length = compactLen;
  return {
    len: compactLen,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function mergeUrlQueryRuns(segmentation) {
  const texts = [];
  const isWordLike = [];
  const kinds = [];
  const starts = [];
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    const text = segmentation.texts[i6];
    texts.push(text);
    isWordLike.push(segmentation.isWordLike[i6]);
    kinds.push(segmentation.kinds[i6]);
    starts.push(segmentation.starts[i6]);
    if (!isUrlQueryBoundarySegment(text))
      continue;
    const nextIndex = i6 + 1;
    if (nextIndex >= segmentation.len || isTextRunBoundary(segmentation.kinds[nextIndex])) {
      continue;
    }
    const queryParts = [];
    const queryStart = segmentation.starts[nextIndex];
    let j = nextIndex;
    while (j < segmentation.len && !isTextRunBoundary(segmentation.kinds[j])) {
      queryParts.push(segmentation.texts[j]);
      j++;
    }
    if (queryParts.length > 0) {
      texts.push(joinTextParts(queryParts));
      isWordLike.push(true);
      kinds.push("text");
      starts.push(queryStart);
      i6 = j - 1;
    }
  }
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
var numericJoinerChars = /* @__PURE__ */ new Set([
  ":",
  "-",
  "/",
  "\xD7",
  ",",
  ".",
  "+",
  "\u2013",
  "\u2014"
]);
var asciiPunctuationChainSegmentRe = /^[A-Za-z0-9_]+[,:;]*$/;
var asciiPunctuationChainTrailingJoinersRe = /[,:;]+$/;
function segmentContainsDecimalDigit(text) {
  for (const ch of text) {
    if (decimalDigitRe.test(ch))
      return true;
  }
  return false;
}
function isNumericRunSegment(text) {
  if (text.length === 0)
    return false;
  for (const ch of text) {
    if (decimalDigitRe.test(ch) || numericJoinerChars.has(ch))
      continue;
    return false;
  }
  return true;
}
function mergeNumericRuns(segmentation) {
  const texts = [];
  const isWordLike = [];
  const kinds = [];
  const starts = [];
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    const text = segmentation.texts[i6];
    const kind = segmentation.kinds[i6];
    if (kind === "text" && isNumericRunSegment(text) && segmentContainsDecimalDigit(text)) {
      const mergedParts = [text];
      let j = i6 + 1;
      while (j < segmentation.len && segmentation.kinds[j] === "text" && isNumericRunSegment(segmentation.texts[j])) {
        mergedParts.push(segmentation.texts[j]);
        j++;
      }
      texts.push(joinTextParts(mergedParts));
      isWordLike.push(true);
      kinds.push("text");
      starts.push(segmentation.starts[i6]);
      i6 = j - 1;
      continue;
    }
    texts.push(text);
    isWordLike.push(segmentation.isWordLike[i6]);
    kinds.push(kind);
    starts.push(segmentation.starts[i6]);
  }
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function mergeAsciiPunctuationChains(segmentation) {
  const texts = [];
  const isWordLike = [];
  const kinds = [];
  const starts = [];
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    const text = segmentation.texts[i6];
    const kind = segmentation.kinds[i6];
    const wordLike = segmentation.isWordLike[i6];
    if (kind === "text" && wordLike && asciiPunctuationChainSegmentRe.test(text)) {
      const mergedParts = [text];
      let endsWithJoiners = asciiPunctuationChainTrailingJoinersRe.test(text);
      let j = i6 + 1;
      while (endsWithJoiners && j < segmentation.len && segmentation.kinds[j] === "text" && segmentation.isWordLike[j] && asciiPunctuationChainSegmentRe.test(segmentation.texts[j])) {
        const nextText = segmentation.texts[j];
        mergedParts.push(nextText);
        endsWithJoiners = asciiPunctuationChainTrailingJoinersRe.test(nextText);
        j++;
      }
      texts.push(joinTextParts(mergedParts));
      isWordLike.push(true);
      kinds.push("text");
      starts.push(segmentation.starts[i6]);
      i6 = j - 1;
      continue;
    }
    texts.push(text);
    isWordLike.push(wordLike);
    kinds.push(kind);
    starts.push(segmentation.starts[i6]);
  }
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function splitHyphenatedNumericRuns(segmentation) {
  const texts = [];
  const isWordLike = [];
  const kinds = [];
  const starts = [];
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    const text = segmentation.texts[i6];
    if (segmentation.kinds[i6] === "text" && text.includes("-")) {
      const parts = text.split("-");
      let shouldSplit = parts.length > 1;
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        if (!shouldSplit)
          break;
        if (part.length === 0 || !segmentContainsDecimalDigit(part) || !isNumericRunSegment(part)) {
          shouldSplit = false;
        }
      }
      if (shouldSplit) {
        let offset = 0;
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j];
          const splitText = j < parts.length - 1 ? `${part}-` : part;
          texts.push(splitText);
          isWordLike.push(true);
          kinds.push("text");
          starts.push(segmentation.starts[i6] + offset);
          offset += splitText.length;
        }
        continue;
      }
    }
    texts.push(text);
    isWordLike.push(segmentation.isWordLike[i6]);
    kinds.push(segmentation.kinds[i6]);
    starts.push(segmentation.starts[i6]);
  }
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function mergeGlueConnectedTextRuns(segmentation) {
  const texts = [];
  const isWordLike = [];
  const kinds = [];
  const starts = [];
  let read = 0;
  while (read < segmentation.len) {
    const textParts = [segmentation.texts[read]];
    let wordLike = segmentation.isWordLike[read];
    let kind = segmentation.kinds[read];
    let start = segmentation.starts[read];
    if (kind === "glue") {
      const glueParts = [textParts[0]];
      const glueStart = start;
      read++;
      while (read < segmentation.len && segmentation.kinds[read] === "glue") {
        glueParts.push(segmentation.texts[read]);
        read++;
      }
      const glueText = joinTextParts(glueParts);
      if (read < segmentation.len && segmentation.kinds[read] === "text") {
        textParts[0] = glueText;
        textParts.push(segmentation.texts[read]);
        wordLike = segmentation.isWordLike[read];
        kind = "text";
        start = glueStart;
        read++;
      } else {
        texts.push(glueText);
        isWordLike.push(false);
        kinds.push("glue");
        starts.push(glueStart);
        continue;
      }
    } else {
      read++;
    }
    if (kind === "text") {
      while (read < segmentation.len && segmentation.kinds[read] === "glue") {
        const glueParts = [];
        while (read < segmentation.len && segmentation.kinds[read] === "glue") {
          glueParts.push(segmentation.texts[read]);
          read++;
        }
        const glueText = joinTextParts(glueParts);
        if (read < segmentation.len && segmentation.kinds[read] === "text") {
          textParts.push(glueText, segmentation.texts[read]);
          wordLike = wordLike || segmentation.isWordLike[read];
          read++;
          continue;
        }
        textParts.push(glueText);
      }
    }
    texts.push(joinTextParts(textParts));
    isWordLike.push(wordLike);
    kinds.push(kind);
    starts.push(start);
  }
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function carryTrailingForwardStickyAcrossCJKBoundary(segmentation) {
  const texts = segmentation.texts.slice();
  const isWordLike = segmentation.isWordLike.slice();
  const kinds = segmentation.kinds.slice();
  const starts = segmentation.starts.slice();
  for (let i6 = 0; i6 < texts.length - 1; i6++) {
    if (kinds[i6] !== "text" || kinds[i6 + 1] !== "text")
      continue;
    if (!isCJK(texts[i6]) || !isCJK(texts[i6 + 1]))
      continue;
    const split = splitTrailingForwardStickyCluster(texts[i6]);
    if (split === null)
      continue;
    texts[i6] = split.head;
    texts[i6 + 1] = split.tail + texts[i6 + 1];
    starts[i6 + 1] = starts[i6] + split.head.length;
  }
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function buildMergedSegmentation(normalized, profile, whiteSpaceProfile) {
  const wordSegmenter = getSharedWordSegmenter();
  let mergedLen = 0;
  const mergedTexts = [];
  const mergedTextParts = [];
  const mergedWordLike = [];
  const mergedKinds = [];
  const mergedStarts = [];
  const mergedSingleCharRunChars = [];
  const mergedSingleCharRunLengths = [];
  const mergedContainsCJK = [];
  const mergedContainsArabicScript = [];
  const mergedEndsWithClosingQuote = [];
  const mergedEndsWithMyanmarMedialGlue = [];
  const mergedHasArabicNoSpacePunctuation = [];
  for (const s4 of wordSegmenter.segment(normalized)) {
    for (const piece of splitSegmentByBreakKind(s4.segment, s4.isWordLike ?? false, s4.index, whiteSpaceProfile)) {
      let appendPieceToPrevious = function() {
        if (mergedSingleCharRunChars[prevIndex] !== null) {
          mergedTextParts[prevIndex] = [
            materializeDeferredSingleCharRun(mergedTexts, mergedSingleCharRunChars, mergedSingleCharRunLengths, prevIndex)
          ];
          mergedSingleCharRunChars[prevIndex] = null;
        }
        mergedTextParts[prevIndex].push(piece.text);
        mergedWordLike[prevIndex] = mergedWordLike[prevIndex] || piece.isWordLike;
        mergedContainsCJK[prevIndex] = mergedContainsCJK[prevIndex] || pieceContainsCJK;
        mergedContainsArabicScript[prevIndex] = mergedContainsArabicScript[prevIndex] || pieceContainsArabicScript;
        mergedEndsWithClosingQuote[prevIndex] = pieceEndsWithClosingQuote;
        mergedEndsWithMyanmarMedialGlue[prevIndex] = pieceEndsWithMyanmarMedialGlue;
        mergedHasArabicNoSpacePunctuation[prevIndex] = hasArabicNoSpacePunctuation(mergedContainsArabicScript[prevIndex], pieceLastCodePoint);
      };
      const isText = piece.kind === "text";
      const repeatableSingleCharRunChar = getRepeatableSingleCharRunChar(piece.text, piece.isWordLike, piece.kind);
      const pieceContainsCJK = isCJK(piece.text);
      const pieceContainsArabicScript = containsArabicScript(piece.text);
      const pieceLastCodePoint = getLastCodePoint(piece.text);
      const pieceEndsWithClosingQuote = endsWithClosingQuote(piece.text);
      const pieceEndsWithMyanmarMedialGlue = endsWithMyanmarMedialGlue(piece.text);
      const prevIndex = mergedLen - 1;
      if (profile.carryCJKAfterClosingQuote && isText && mergedLen > 0 && mergedKinds[prevIndex] === "text" && pieceContainsCJK && mergedContainsCJK[prevIndex] && mergedEndsWithClosingQuote[prevIndex]) {
        appendPieceToPrevious();
      } else if (isText && mergedLen > 0 && mergedKinds[prevIndex] === "text" && isCJKLineStartProhibitedSegment(piece.text) && mergedContainsCJK[prevIndex]) {
        appendPieceToPrevious();
      } else if (isText && mergedLen > 0 && mergedKinds[prevIndex] === "text" && mergedEndsWithMyanmarMedialGlue[prevIndex]) {
        appendPieceToPrevious();
      } else if (isText && mergedLen > 0 && mergedKinds[prevIndex] === "text" && piece.isWordLike && pieceContainsArabicScript && mergedHasArabicNoSpacePunctuation[prevIndex]) {
        appendPieceToPrevious();
        mergedWordLike[prevIndex] = true;
      } else if (repeatableSingleCharRunChar !== null && mergedLen > 0 && mergedKinds[prevIndex] === "text" && mergedSingleCharRunChars[prevIndex] === repeatableSingleCharRunChar) {
        mergedSingleCharRunLengths[prevIndex] = (mergedSingleCharRunLengths[prevIndex] ?? 1) + 1;
      } else if (isText && !piece.isWordLike && mergedLen > 0 && mergedKinds[prevIndex] === "text" && !mergedContainsCJK[prevIndex] && (isLeftStickyPunctuationSegment(piece.text) || piece.text === "-" && mergedWordLike[prevIndex])) {
        appendPieceToPrevious();
      } else {
        mergedTexts[mergedLen] = piece.text;
        mergedTextParts[mergedLen] = [piece.text];
        mergedWordLike[mergedLen] = piece.isWordLike;
        mergedKinds[mergedLen] = piece.kind;
        mergedStarts[mergedLen] = piece.start;
        mergedSingleCharRunChars[mergedLen] = repeatableSingleCharRunChar;
        mergedSingleCharRunLengths[mergedLen] = repeatableSingleCharRunChar === null ? 0 : 1;
        mergedContainsCJK[mergedLen] = pieceContainsCJK;
        mergedContainsArabicScript[mergedLen] = pieceContainsArabicScript;
        mergedEndsWithClosingQuote[mergedLen] = pieceEndsWithClosingQuote;
        mergedEndsWithMyanmarMedialGlue[mergedLen] = pieceEndsWithMyanmarMedialGlue;
        mergedHasArabicNoSpacePunctuation[mergedLen] = hasArabicNoSpacePunctuation(pieceContainsArabicScript, pieceLastCodePoint);
        mergedLen++;
      }
    }
  }
  for (let i6 = 0; i6 < mergedLen; i6++) {
    if (mergedSingleCharRunChars[i6] !== null) {
      mergedTexts[i6] = materializeDeferredSingleCharRun(mergedTexts, mergedSingleCharRunChars, mergedSingleCharRunLengths, i6);
      continue;
    }
    mergedTexts[i6] = joinTextParts(mergedTextParts[i6]);
  }
  for (let i6 = 1; i6 < mergedLen; i6++) {
    if (mergedKinds[i6] === "text" && !mergedWordLike[i6] && isEscapedQuoteClusterSegment(mergedTexts[i6]) && mergedKinds[i6 - 1] === "text" && !mergedContainsCJK[i6 - 1]) {
      mergedTexts[i6 - 1] += mergedTexts[i6];
      mergedWordLike[i6 - 1] = mergedWordLike[i6 - 1] || mergedWordLike[i6];
      mergedTexts[i6] = "";
    }
  }
  const forwardStickyPrefixParts = Array.from({ length: mergedLen }, () => null);
  let nextLiveIndex = -1;
  for (let i6 = mergedLen - 1; i6 >= 0; i6--) {
    const text = mergedTexts[i6];
    if (text.length === 0)
      continue;
    if (mergedKinds[i6] === "text" && !mergedWordLike[i6] && isForwardStickyClusterSegment(text) && nextLiveIndex >= 0 && mergedKinds[nextLiveIndex] === "text") {
      const prefixParts = forwardStickyPrefixParts[nextLiveIndex] ?? [];
      prefixParts.push(text);
      forwardStickyPrefixParts[nextLiveIndex] = prefixParts;
      mergedStarts[nextLiveIndex] = mergedStarts[i6];
      mergedTexts[i6] = "";
      continue;
    }
    nextLiveIndex = i6;
  }
  for (let i6 = 0; i6 < mergedLen; i6++) {
    const prefixParts = forwardStickyPrefixParts[i6];
    if (prefixParts == null)
      continue;
    mergedTexts[i6] = joinReversedPrefixParts(prefixParts, mergedTexts[i6]);
  }
  let compactLen = 0;
  for (let read = 0; read < mergedLen; read++) {
    const text = mergedTexts[read];
    if (text.length === 0)
      continue;
    if (compactLen !== read) {
      mergedTexts[compactLen] = text;
      mergedWordLike[compactLen] = mergedWordLike[read];
      mergedKinds[compactLen] = mergedKinds[read];
      mergedStarts[compactLen] = mergedStarts[read];
    }
    compactLen++;
  }
  mergedTexts.length = compactLen;
  mergedWordLike.length = compactLen;
  mergedKinds.length = compactLen;
  mergedStarts.length = compactLen;
  const compacted = mergeGlueConnectedTextRuns({
    len: compactLen,
    texts: mergedTexts,
    isWordLike: mergedWordLike,
    kinds: mergedKinds,
    starts: mergedStarts
  });
  const withMergedUrls = carryTrailingForwardStickyAcrossCJKBoundary(mergeAsciiPunctuationChains(splitHyphenatedNumericRuns(mergeNumericRuns(mergeUrlQueryRuns(mergeUrlLikeRuns(compacted))))));
  for (let i6 = 0; i6 < withMergedUrls.len - 1; i6++) {
    const split = splitLeadingSpaceAndMarks(withMergedUrls.texts[i6]);
    if (split === null)
      continue;
    if (withMergedUrls.kinds[i6] !== "space" && withMergedUrls.kinds[i6] !== "preserved-space" || withMergedUrls.kinds[i6 + 1] !== "text" || !containsArabicScript(withMergedUrls.texts[i6 + 1])) {
      continue;
    }
    withMergedUrls.texts[i6] = split.space;
    withMergedUrls.isWordLike[i6] = false;
    withMergedUrls.kinds[i6] = withMergedUrls.kinds[i6] === "preserved-space" ? "preserved-space" : "space";
    withMergedUrls.texts[i6 + 1] = split.marks + withMergedUrls.texts[i6 + 1];
    withMergedUrls.starts[i6 + 1] = withMergedUrls.starts[i6] + split.space.length;
  }
  return withMergedUrls;
}
function compileAnalysisChunks(segmentation, whiteSpaceProfile) {
  if (segmentation.len === 0)
    return [];
  if (!whiteSpaceProfile.preserveHardBreaks) {
    return [{
      startSegmentIndex: 0,
      endSegmentIndex: segmentation.len,
      consumedEndSegmentIndex: segmentation.len
    }];
  }
  const chunks = [];
  let startSegmentIndex = 0;
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    if (segmentation.kinds[i6] !== "hard-break")
      continue;
    chunks.push({
      startSegmentIndex,
      endSegmentIndex: i6,
      consumedEndSegmentIndex: i6 + 1
    });
    startSegmentIndex = i6 + 1;
  }
  if (startSegmentIndex < segmentation.len) {
    chunks.push({
      startSegmentIndex,
      endSegmentIndex: segmentation.len,
      consumedEndSegmentIndex: segmentation.len
    });
  }
  return chunks;
}
function mergeKeepAllTextSegments(segmentation) {
  if (segmentation.len <= 1)
    return segmentation;
  const texts = [];
  const isWordLike = [];
  const kinds = [];
  const starts = [];
  let pendingTextParts = null;
  let pendingWordLike = false;
  let pendingStart = 0;
  let pendingContainsCJK = false;
  let pendingCanContinue = false;
  function flushPendingText() {
    if (pendingTextParts === null)
      return;
    texts.push(joinTextParts(pendingTextParts));
    isWordLike.push(pendingWordLike);
    kinds.push("text");
    starts.push(pendingStart);
    pendingTextParts = null;
  }
  for (let i6 = 0; i6 < segmentation.len; i6++) {
    const text = segmentation.texts[i6];
    const kind = segmentation.kinds[i6];
    const wordLike = segmentation.isWordLike[i6];
    const start = segmentation.starts[i6];
    if (kind === "text") {
      const textContainsCJK = containsCJKText(text);
      const textCanContinue = canContinueKeepAllTextRun(text);
      if (pendingTextParts !== null && pendingContainsCJK && pendingCanContinue) {
        pendingTextParts.push(text);
        pendingWordLike = pendingWordLike || wordLike;
        pendingContainsCJK = pendingContainsCJK || textContainsCJK;
        pendingCanContinue = textCanContinue;
        continue;
      }
      flushPendingText();
      pendingTextParts = [text];
      pendingWordLike = wordLike;
      pendingStart = start;
      pendingContainsCJK = textContainsCJK;
      pendingCanContinue = textCanContinue;
      continue;
    }
    flushPendingText();
    texts.push(text);
    isWordLike.push(wordLike);
    kinds.push(kind);
    starts.push(start);
  }
  flushPendingText();
  return {
    len: texts.length,
    texts,
    isWordLike,
    kinds,
    starts
  };
}
function analyzeText(text, profile, whiteSpace = "normal", wordBreak = "normal") {
  const whiteSpaceProfile = getWhiteSpaceProfile(whiteSpace);
  const normalized = whiteSpaceProfile.mode === "pre-wrap" ? normalizeWhitespacePreWrap(text) : normalizeWhitespaceNormal(text);
  if (normalized.length === 0) {
    return {
      normalized,
      chunks: [],
      len: 0,
      texts: [],
      isWordLike: [],
      kinds: [],
      starts: []
    };
  }
  const segmentation = wordBreak === "keep-all" ? mergeKeepAllTextSegments(buildMergedSegmentation(normalized, profile, whiteSpaceProfile)) : buildMergedSegmentation(normalized, profile, whiteSpaceProfile);
  return {
    normalized,
    chunks: compileAnalysisChunks(segmentation, whiteSpaceProfile),
    ...segmentation
  };
}

// node_modules/@chenglou/pretext/dist/measurement.js
var measureContext = null;
var segmentMetricCaches = /* @__PURE__ */ new Map();
var cachedEngineProfile = null;
var MAX_PREFIX_FIT_GRAPHEMES = 96;
var emojiPresentationRe = /\p{Emoji_Presentation}/u;
var maybeEmojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u;
var sharedGraphemeSegmenter = null;
var emojiCorrectionCache = /* @__PURE__ */ new Map();
function getMeasureContext() {
  if (measureContext !== null)
    return measureContext;
  if (typeof OffscreenCanvas !== "undefined") {
    measureContext = new OffscreenCanvas(1, 1).getContext("2d");
    return measureContext;
  }
  if (typeof document !== "undefined") {
    measureContext = document.createElement("canvas").getContext("2d");
    return measureContext;
  }
  throw new Error("Text measurement requires OffscreenCanvas or a DOM canvas context.");
}
function getSegmentMetricCache(font) {
  let cache = segmentMetricCaches.get(font);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    segmentMetricCaches.set(font, cache);
  }
  return cache;
}
function getSegmentMetrics(seg, cache) {
  let metrics = cache.get(seg);
  if (metrics === void 0) {
    const ctx = getMeasureContext();
    metrics = {
      width: ctx.measureText(seg).width,
      containsCJK: isCJK(seg)
    };
    cache.set(seg, metrics);
  }
  return metrics;
}
function getEngineProfile() {
  if (cachedEngineProfile !== null)
    return cachedEngineProfile;
  if (typeof navigator === "undefined") {
    cachedEngineProfile = {
      lineFitEpsilon: 5e-3,
      carryCJKAfterClosingQuote: false,
      preferPrefixWidthsForBreakableRuns: false,
      preferEarlySoftHyphenBreak: false
    };
    return cachedEngineProfile;
  }
  const ua = navigator.userAgent;
  const vendor = navigator.vendor;
  const isSafari = vendor === "Apple Computer, Inc." && ua.includes("Safari/") && !ua.includes("Chrome/") && !ua.includes("Chromium/") && !ua.includes("CriOS/") && !ua.includes("FxiOS/") && !ua.includes("EdgiOS/");
  const isChromium = ua.includes("Chrome/") || ua.includes("Chromium/") || ua.includes("CriOS/") || ua.includes("Edg/");
  cachedEngineProfile = {
    lineFitEpsilon: isSafari ? 1 / 64 : 5e-3,
    carryCJKAfterClosingQuote: isChromium,
    preferPrefixWidthsForBreakableRuns: isSafari,
    preferEarlySoftHyphenBreak: isSafari
  };
  return cachedEngineProfile;
}
function parseFontSize(font) {
  const m2 = font.match(/(\d+(?:\.\d+)?)\s*px/);
  return m2 ? parseFloat(m2[1]) : 16;
}
function getSharedGraphemeSegmenter() {
  if (sharedGraphemeSegmenter === null) {
    sharedGraphemeSegmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
  }
  return sharedGraphemeSegmenter;
}
function isEmojiGrapheme(g2) {
  return emojiPresentationRe.test(g2) || g2.includes("\uFE0F");
}
function textMayContainEmoji(text) {
  return maybeEmojiRe.test(text);
}
function getEmojiCorrection(font, fontSize) {
  let correction = emojiCorrectionCache.get(font);
  if (correction !== void 0)
    return correction;
  const ctx = getMeasureContext();
  ctx.font = font;
  const canvasW = ctx.measureText("\u{1F600}").width;
  correction = 0;
  if (canvasW > fontSize + 0.5 && typeof document !== "undefined" && document.body !== null) {
    const span = document.createElement("span");
    span.style.font = font;
    span.style.display = "inline-block";
    span.style.visibility = "hidden";
    span.style.position = "absolute";
    span.textContent = "\u{1F600}";
    document.body.appendChild(span);
    const domW = span.getBoundingClientRect().width;
    document.body.removeChild(span);
    if (canvasW - domW > 0.5) {
      correction = canvasW - domW;
    }
  }
  emojiCorrectionCache.set(font, correction);
  return correction;
}
function countEmojiGraphemes(text) {
  let count = 0;
  const graphemeSegmenter = getSharedGraphemeSegmenter();
  for (const g2 of graphemeSegmenter.segment(text)) {
    if (isEmojiGrapheme(g2.segment))
      count++;
  }
  return count;
}
function getEmojiCount(seg, metrics) {
  if (metrics.emojiCount === void 0) {
    metrics.emojiCount = countEmojiGraphemes(seg);
  }
  return metrics.emojiCount;
}
function getCorrectedSegmentWidth(seg, metrics, emojiCorrection) {
  if (emojiCorrection === 0)
    return metrics.width;
  return metrics.width - getEmojiCount(seg, metrics) * emojiCorrection;
}
function getSegmentBreakableFitAdvances(seg, metrics, cache, emojiCorrection, mode) {
  if (metrics.breakableFitAdvances !== void 0 && metrics.breakableFitMode === mode) {
    return metrics.breakableFitAdvances;
  }
  metrics.breakableFitMode = mode;
  const graphemeSegmenter = getSharedGraphemeSegmenter();
  const graphemes = [];
  for (const gs of graphemeSegmenter.segment(seg)) {
    graphemes.push(gs.segment);
  }
  if (graphemes.length <= 1) {
    metrics.breakableFitAdvances = null;
    return metrics.breakableFitAdvances;
  }
  if (mode === "sum-graphemes") {
    const advances2 = [];
    for (const grapheme of graphemes) {
      const graphemeMetrics = getSegmentMetrics(grapheme, cache);
      advances2.push(getCorrectedSegmentWidth(grapheme, graphemeMetrics, emojiCorrection));
    }
    metrics.breakableFitAdvances = advances2;
    return metrics.breakableFitAdvances;
  }
  if (mode === "pair-context" || graphemes.length > MAX_PREFIX_FIT_GRAPHEMES) {
    const advances2 = [];
    let previousGrapheme = null;
    let previousWidth = 0;
    for (const grapheme of graphemes) {
      const graphemeMetrics = getSegmentMetrics(grapheme, cache);
      const currentWidth = getCorrectedSegmentWidth(grapheme, graphemeMetrics, emojiCorrection);
      if (previousGrapheme === null) {
        advances2.push(currentWidth);
      } else {
        const pair = previousGrapheme + grapheme;
        const pairMetrics = getSegmentMetrics(pair, cache);
        advances2.push(getCorrectedSegmentWidth(pair, pairMetrics, emojiCorrection) - previousWidth);
      }
      previousGrapheme = grapheme;
      previousWidth = currentWidth;
    }
    metrics.breakableFitAdvances = advances2;
    return metrics.breakableFitAdvances;
  }
  const advances = [];
  let prefix = "";
  let prefixWidth = 0;
  for (const grapheme of graphemes) {
    prefix += grapheme;
    const prefixMetrics = getSegmentMetrics(prefix, cache);
    const nextPrefixWidth = getCorrectedSegmentWidth(prefix, prefixMetrics, emojiCorrection);
    advances.push(nextPrefixWidth - prefixWidth);
    prefixWidth = nextPrefixWidth;
  }
  metrics.breakableFitAdvances = advances;
  return metrics.breakableFitAdvances;
}
function getFontMeasurementState(font, needsEmojiCorrection) {
  const ctx = getMeasureContext();
  ctx.font = font;
  const cache = getSegmentMetricCache(font);
  const fontSize = parseFontSize(font);
  const emojiCorrection = needsEmojiCorrection ? getEmojiCorrection(font, fontSize) : 0;
  return { cache, fontSize, emojiCorrection };
}

// node_modules/@chenglou/pretext/dist/line-break.js
function consumesAtLineStart(kind) {
  return kind === "space" || kind === "zero-width-break" || kind === "soft-hyphen";
}
function breaksAfter(kind) {
  return kind === "space" || kind === "preserved-space" || kind === "tab" || kind === "zero-width-break" || kind === "soft-hyphen";
}
function normalizeLineStartSegmentIndex(prepared, segmentIndex, endSegmentIndex = prepared.widths.length) {
  while (segmentIndex < endSegmentIndex) {
    const kind = prepared.kinds[segmentIndex];
    if (!consumesAtLineStart(kind))
      break;
    segmentIndex++;
  }
  return segmentIndex;
}
function getTabAdvance(lineWidth, tabStopAdvance) {
  if (tabStopAdvance <= 0)
    return 0;
  const remainder = lineWidth % tabStopAdvance;
  if (Math.abs(remainder) <= 1e-6)
    return tabStopAdvance;
  return tabStopAdvance - remainder;
}
function getLeadingLetterSpacing(prepared, hasContent, segmentIndex) {
  return prepared.letterSpacing !== 0 && hasContent && prepared.spacingGraphemeCounts[segmentIndex] > 0 ? prepared.letterSpacing : 0;
}
function getLineEndContribution(leadingSpacing, segmentContribution) {
  return segmentContribution === 0 ? 0 : leadingSpacing + segmentContribution;
}
function getTabTrailingLetterSpacing(prepared, segmentIndex) {
  return prepared.letterSpacing !== 0 && prepared.spacingGraphemeCounts[segmentIndex] > 0 ? prepared.letterSpacing : 0;
}
function getWholeSegmentFitContribution(prepared, kind, segmentIndex, leadingSpacing, segmentWidth) {
  const segmentContribution = kind === "tab" ? segmentWidth + getTabTrailingLetterSpacing(prepared, segmentIndex) : prepared.lineEndFitAdvances[segmentIndex];
  return getLineEndContribution(leadingSpacing, segmentContribution);
}
function getBreakOpportunityFitContribution(prepared, kind, segmentIndex, leadingSpacing) {
  const segmentContribution = kind === "tab" ? 0 : prepared.lineEndFitAdvances[segmentIndex];
  return getLineEndContribution(leadingSpacing, segmentContribution);
}
function getLineEndPaintContribution(prepared, kind, segmentIndex, leadingSpacing, segmentWidth) {
  const segmentContribution = kind === "tab" ? segmentWidth : prepared.lineEndPaintAdvances[segmentIndex];
  return getLineEndContribution(leadingSpacing, segmentContribution);
}
function getBreakableGraphemeAdvance(prepared, hasContent, baseAdvance) {
  return prepared.letterSpacing !== 0 && hasContent ? baseAdvance + prepared.letterSpacing : baseAdvance;
}
function getBreakableCandidateFitWidth(prepared, candidatePaintWidth) {
  return prepared.letterSpacing === 0 ? candidatePaintWidth : candidatePaintWidth + prepared.letterSpacing;
}
function fitSoftHyphenBreak(graphemeFitAdvances, initialWidth, maxWidth, lineFitEpsilon, discretionaryHyphenWidth, letterSpacing) {
  let fitCount = 0;
  let fittedWidth = initialWidth;
  while (fitCount < graphemeFitAdvances.length) {
    const nextWidth = fittedWidth + graphemeFitAdvances[fitCount] + letterSpacing;
    const nextLineWidth = fitCount + 1 < graphemeFitAdvances.length ? nextWidth + discretionaryHyphenWidth : nextWidth;
    if (nextLineWidth > maxWidth + lineFitEpsilon)
      break;
    fittedWidth = nextWidth;
    fitCount++;
  }
  return { fitCount, fittedWidth };
}
function walkPreparedLinesSimple(prepared, maxWidth, onLine) {
  const { widths, kinds, breakableFitAdvances } = prepared;
  if (widths.length === 0)
    return 0;
  const engineProfile = getEngineProfile();
  const lineFitEpsilon = engineProfile.lineFitEpsilon;
  const fitLimit = maxWidth + lineFitEpsilon;
  let lineCount = 0;
  let lineW = 0;
  let hasContent = false;
  let lineStartSegmentIndex = 0;
  let lineStartGraphemeIndex = 0;
  let lineEndSegmentIndex = 0;
  let lineEndGraphemeIndex = 0;
  let pendingBreakSegmentIndex = -1;
  let pendingBreakPaintWidth = 0;
  function clearPendingBreak() {
    pendingBreakSegmentIndex = -1;
    pendingBreakPaintWidth = 0;
  }
  function emitCurrentLine(endSegmentIndex = lineEndSegmentIndex, endGraphemeIndex = lineEndGraphemeIndex, width = lineW) {
    lineCount++;
    onLine?.(width, lineStartSegmentIndex, lineStartGraphemeIndex, endSegmentIndex, endGraphemeIndex);
    lineW = 0;
    hasContent = false;
    clearPendingBreak();
  }
  function startLineAtSegment(segmentIndex, width) {
    hasContent = true;
    lineStartSegmentIndex = segmentIndex;
    lineStartGraphemeIndex = 0;
    lineEndSegmentIndex = segmentIndex + 1;
    lineEndGraphemeIndex = 0;
    lineW = width;
  }
  function startLineAtGrapheme(segmentIndex, graphemeIndex, width) {
    hasContent = true;
    lineStartSegmentIndex = segmentIndex;
    lineStartGraphemeIndex = graphemeIndex;
    lineEndSegmentIndex = segmentIndex;
    lineEndGraphemeIndex = graphemeIndex + 1;
    lineW = width;
  }
  function appendWholeSegment(segmentIndex, width) {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width);
      return;
    }
    lineW += width;
    lineEndSegmentIndex = segmentIndex + 1;
    lineEndGraphemeIndex = 0;
  }
  function appendBreakableSegmentFrom(segmentIndex, startGraphemeIndex) {
    const fitAdvances = breakableFitAdvances[segmentIndex];
    for (let g2 = startGraphemeIndex; g2 < fitAdvances.length; g2++) {
      const gw = fitAdvances[g2];
      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g2, gw);
      } else if (lineW + gw > fitLimit) {
        emitCurrentLine();
        startLineAtGrapheme(segmentIndex, g2, gw);
      } else {
        lineW += gw;
        lineEndSegmentIndex = segmentIndex;
        lineEndGraphemeIndex = g2 + 1;
      }
    }
    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === fitAdvances.length) {
      lineEndSegmentIndex = segmentIndex + 1;
      lineEndGraphemeIndex = 0;
    }
  }
  let i6 = 0;
  while (i6 < widths.length) {
    if (!hasContent) {
      i6 = normalizeLineStartSegmentIndex(prepared, i6);
      if (i6 >= widths.length)
        break;
    }
    const w2 = widths[i6];
    const kind = kinds[i6];
    const breakAfter = breaksAfter(kind);
    if (!hasContent) {
      if (w2 > fitLimit && breakableFitAdvances[i6] !== null) {
        appendBreakableSegmentFrom(i6, 0);
      } else {
        startLineAtSegment(i6, w2);
      }
      if (breakAfter) {
        pendingBreakSegmentIndex = i6 + 1;
        pendingBreakPaintWidth = lineW - w2;
      }
      i6++;
      continue;
    }
    const newW = lineW + w2;
    if (newW > fitLimit) {
      if (breakAfter) {
        appendWholeSegment(i6, w2);
        emitCurrentLine(i6 + 1, 0, lineW - w2);
        i6++;
        continue;
      }
      if (pendingBreakSegmentIndex >= 0) {
        if (lineEndSegmentIndex > pendingBreakSegmentIndex || lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0) {
          emitCurrentLine();
          continue;
        }
        emitCurrentLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth);
        continue;
      }
      if (w2 > fitLimit && breakableFitAdvances[i6] !== null) {
        emitCurrentLine();
        appendBreakableSegmentFrom(i6, 0);
        i6++;
        continue;
      }
      emitCurrentLine();
      continue;
    }
    appendWholeSegment(i6, w2);
    if (breakAfter) {
      pendingBreakSegmentIndex = i6 + 1;
      pendingBreakPaintWidth = lineW - w2;
    }
    i6++;
  }
  if (hasContent)
    emitCurrentLine();
  return lineCount;
}
function walkPreparedLinesRaw(prepared, maxWidth, onLine) {
  if (prepared.simpleLineWalkFastPath) {
    return walkPreparedLinesSimple(prepared, maxWidth, onLine);
  }
  const { widths, kinds, breakableFitAdvances, discretionaryHyphenWidth, chunks } = prepared;
  if (widths.length === 0 || chunks.length === 0)
    return 0;
  const engineProfile = getEngineProfile();
  const lineFitEpsilon = engineProfile.lineFitEpsilon;
  const fitLimit = maxWidth + lineFitEpsilon;
  let lineCount = 0;
  let lineW = 0;
  let hasContent = false;
  let lineStartSegmentIndex = 0;
  let lineStartGraphemeIndex = 0;
  let lineEndSegmentIndex = 0;
  let lineEndGraphemeIndex = 0;
  let pendingBreakSegmentIndex = -1;
  let pendingBreakFitWidth = 0;
  let pendingBreakPaintWidth = 0;
  let pendingBreakKind = null;
  function clearPendingBreak() {
    pendingBreakSegmentIndex = -1;
    pendingBreakFitWidth = 0;
    pendingBreakPaintWidth = 0;
    pendingBreakKind = null;
  }
  function emitCurrentLine(endSegmentIndex = lineEndSegmentIndex, endGraphemeIndex = lineEndGraphemeIndex, width = lineW) {
    lineCount++;
    onLine?.(width, lineStartSegmentIndex, lineStartGraphemeIndex, endSegmentIndex, endGraphemeIndex);
    lineW = 0;
    hasContent = false;
    clearPendingBreak();
  }
  function startLineAtSegment(segmentIndex, width) {
    hasContent = true;
    lineStartSegmentIndex = segmentIndex;
    lineStartGraphemeIndex = 0;
    lineEndSegmentIndex = segmentIndex + 1;
    lineEndGraphemeIndex = 0;
    lineW = width;
  }
  function startLineAtGrapheme(segmentIndex, graphemeIndex, width) {
    hasContent = true;
    lineStartSegmentIndex = segmentIndex;
    lineStartGraphemeIndex = graphemeIndex;
    lineEndSegmentIndex = segmentIndex;
    lineEndGraphemeIndex = graphemeIndex + 1;
    lineW = width;
  }
  function appendWholeSegment(segmentIndex, advance) {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, advance);
      return;
    }
    lineW += advance;
    lineEndSegmentIndex = segmentIndex + 1;
    lineEndGraphemeIndex = 0;
  }
  function updatePendingBreakForWholeSegment(kind, breakAfter, segmentIndex, segmentWidth, leadingSpacing, advance) {
    if (!breakAfter)
      return;
    const fitAdvance = getBreakOpportunityFitContribution(prepared, kind, segmentIndex, leadingSpacing);
    const paintAdvance = getLineEndPaintContribution(prepared, kind, segmentIndex, leadingSpacing, segmentWidth);
    pendingBreakSegmentIndex = segmentIndex + 1;
    pendingBreakFitWidth = lineW - advance + fitAdvance;
    pendingBreakPaintWidth = lineW - advance + paintAdvance;
    pendingBreakKind = kind;
  }
  function appendBreakableSegmentFrom(segmentIndex, startGraphemeIndex) {
    const fitAdvances = breakableFitAdvances[segmentIndex];
    for (let g2 = startGraphemeIndex; g2 < fitAdvances.length; g2++) {
      const baseGw = fitAdvances[g2];
      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g2, baseGw);
      } else {
        const gw = getBreakableGraphemeAdvance(prepared, true, baseGw);
        const candidatePaintWidth = lineW + gw;
        if (getBreakableCandidateFitWidth(prepared, candidatePaintWidth) > fitLimit) {
          emitCurrentLine();
          startLineAtGrapheme(segmentIndex, g2, baseGw);
        } else {
          lineW = candidatePaintWidth;
          lineEndSegmentIndex = segmentIndex;
          lineEndGraphemeIndex = g2 + 1;
        }
      }
    }
    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === fitAdvances.length) {
      lineEndSegmentIndex = segmentIndex + 1;
      lineEndGraphemeIndex = 0;
    }
  }
  function continueSoftHyphenBreakableSegment(segmentIndex) {
    if (pendingBreakKind !== "soft-hyphen")
      return false;
    const fitWidths = breakableFitAdvances[segmentIndex];
    if (fitWidths == null)
      return false;
    const { fitCount, fittedWidth } = fitSoftHyphenBreak(fitWidths, lineW, maxWidth, lineFitEpsilon, discretionaryHyphenWidth, prepared.letterSpacing);
    if (fitCount === 0)
      return false;
    lineW = fittedWidth;
    lineEndSegmentIndex = segmentIndex;
    lineEndGraphemeIndex = fitCount;
    clearPendingBreak();
    if (fitCount === fitWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1;
      lineEndGraphemeIndex = 0;
      return true;
    }
    emitCurrentLine(segmentIndex, fitCount, fittedWidth + discretionaryHyphenWidth);
    appendBreakableSegmentFrom(segmentIndex, fitCount);
    return true;
  }
  function emitEmptyChunk(chunk) {
    lineCount++;
    onLine?.(0, chunk.startSegmentIndex, 0, chunk.consumedEndSegmentIndex, 0);
    clearPendingBreak();
  }
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    if (chunk.startSegmentIndex === chunk.endSegmentIndex) {
      emitEmptyChunk(chunk);
      continue;
    }
    hasContent = false;
    lineW = 0;
    lineStartSegmentIndex = chunk.startSegmentIndex;
    lineStartGraphemeIndex = 0;
    lineEndSegmentIndex = chunk.startSegmentIndex;
    lineEndGraphemeIndex = 0;
    clearPendingBreak();
    let i6 = chunk.startSegmentIndex;
    while (i6 < chunk.endSegmentIndex) {
      if (!hasContent) {
        i6 = normalizeLineStartSegmentIndex(prepared, i6, chunk.endSegmentIndex);
        if (i6 >= chunk.endSegmentIndex)
          break;
      }
      const kind = kinds[i6];
      const breakAfter = breaksAfter(kind);
      const leadingSpacing = getLeadingLetterSpacing(prepared, hasContent, i6);
      const w2 = kind === "tab" ? getTabAdvance(lineW + leadingSpacing, prepared.tabStopAdvance) : widths[i6];
      const advance = leadingSpacing + w2;
      const fitAdvance = getWholeSegmentFitContribution(prepared, kind, i6, leadingSpacing, w2);
      if (kind === "soft-hyphen") {
        if (hasContent) {
          lineEndSegmentIndex = i6 + 1;
          lineEndGraphemeIndex = 0;
          pendingBreakSegmentIndex = i6 + 1;
          pendingBreakFitWidth = lineW + discretionaryHyphenWidth;
          pendingBreakPaintWidth = lineW + discretionaryHyphenWidth;
          pendingBreakKind = kind;
        }
        i6++;
        continue;
      }
      if (!hasContent) {
        if (fitAdvance > fitLimit && breakableFitAdvances[i6] !== null) {
          appendBreakableSegmentFrom(i6, 0);
        } else {
          startLineAtSegment(i6, w2);
        }
        updatePendingBreakForWholeSegment(kind, breakAfter, i6, w2, leadingSpacing, advance);
        i6++;
        continue;
      }
      const newFitW = lineW + fitAdvance;
      if (newFitW > fitLimit) {
        const currentBreakFitWidth = lineW + getBreakOpportunityFitContribution(prepared, kind, i6, leadingSpacing);
        const currentBreakPaintWidth = lineW + getLineEndPaintContribution(prepared, kind, i6, leadingSpacing, w2);
        if (pendingBreakKind === "soft-hyphen" && engineProfile.preferEarlySoftHyphenBreak && pendingBreakFitWidth <= fitLimit) {
          emitCurrentLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth);
          continue;
        }
        if (pendingBreakKind === "soft-hyphen" && continueSoftHyphenBreakableSegment(i6)) {
          i6++;
          continue;
        }
        if (breakAfter && currentBreakFitWidth <= fitLimit) {
          appendWholeSegment(i6, advance);
          emitCurrentLine(i6 + 1, 0, currentBreakPaintWidth);
          i6++;
          continue;
        }
        if (pendingBreakSegmentIndex >= 0 && pendingBreakFitWidth <= fitLimit) {
          if (lineEndSegmentIndex > pendingBreakSegmentIndex || lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0) {
            emitCurrentLine();
            continue;
          }
          const nextSegmentIndex = pendingBreakSegmentIndex;
          emitCurrentLine(nextSegmentIndex, 0, pendingBreakPaintWidth);
          i6 = nextSegmentIndex;
          continue;
        }
        if (fitAdvance > fitLimit && breakableFitAdvances[i6] !== null) {
          emitCurrentLine();
          appendBreakableSegmentFrom(i6, 0);
          i6++;
          continue;
        }
        emitCurrentLine();
        continue;
      }
      appendWholeSegment(i6, advance);
      updatePendingBreakForWholeSegment(kind, breakAfter, i6, w2, leadingSpacing, advance);
      i6++;
    }
    if (hasContent) {
      const finalPaintWidth = pendingBreakSegmentIndex === chunk.consumedEndSegmentIndex ? pendingBreakPaintWidth : lineW;
      emitCurrentLine(chunk.consumedEndSegmentIndex, 0, finalPaintWidth);
    }
  }
  return lineCount;
}

// node_modules/@chenglou/pretext/dist/layout.js
var sharedGraphemeSegmenter2 = null;
function getSharedGraphemeSegmenter2() {
  if (sharedGraphemeSegmenter2 === null) {
    sharedGraphemeSegmenter2 = new Intl.Segmenter(void 0, { granularity: "grapheme" });
  }
  return sharedGraphemeSegmenter2;
}
function createEmptyPrepared(includeSegments) {
  if (includeSegments) {
    return {
      widths: [],
      lineEndFitAdvances: [],
      lineEndPaintAdvances: [],
      kinds: [],
      simpleLineWalkFastPath: true,
      segLevels: null,
      breakableFitAdvances: [],
      letterSpacing: 0,
      spacingGraphemeCounts: [],
      discretionaryHyphenWidth: 0,
      tabStopAdvance: 0,
      chunks: [],
      segments: []
    };
  }
  return {
    widths: [],
    lineEndFitAdvances: [],
    lineEndPaintAdvances: [],
    kinds: [],
    simpleLineWalkFastPath: true,
    segLevels: null,
    breakableFitAdvances: [],
    letterSpacing: 0,
    spacingGraphemeCounts: [],
    discretionaryHyphenWidth: 0,
    tabStopAdvance: 0,
    chunks: []
  };
}
function buildBaseCjkUnits(segText, engineProfile) {
  const units = [];
  let unitParts = [];
  let unitStart = 0;
  let unitContainsCJK = false;
  let unitEndsWithClosingQuote = false;
  let unitIsSingleKinsokuEnd = false;
  function pushUnit() {
    if (unitParts.length === 0)
      return;
    units.push({
      text: unitParts.length === 1 ? unitParts[0] : unitParts.join(""),
      start: unitStart
    });
    unitParts = [];
    unitContainsCJK = false;
    unitEndsWithClosingQuote = false;
    unitIsSingleKinsokuEnd = false;
  }
  function startUnit(grapheme, start, graphemeContainsCJK) {
    unitParts = [grapheme];
    unitStart = start;
    unitContainsCJK = graphemeContainsCJK;
    unitEndsWithClosingQuote = endsWithClosingQuote(grapheme);
    unitIsSingleKinsokuEnd = kinsokuEnd.has(grapheme);
  }
  function appendToUnit(grapheme, graphemeContainsCJK) {
    unitParts.push(grapheme);
    unitContainsCJK = unitContainsCJK || graphemeContainsCJK;
    const graphemeEndsWithClosingQuote = endsWithClosingQuote(grapheme);
    if (grapheme.length === 1 && leftStickyPunctuation.has(grapheme)) {
      unitEndsWithClosingQuote = unitEndsWithClosingQuote || graphemeEndsWithClosingQuote;
    } else {
      unitEndsWithClosingQuote = graphemeEndsWithClosingQuote;
    }
    unitIsSingleKinsokuEnd = false;
  }
  for (const gs of getSharedGraphemeSegmenter2().segment(segText)) {
    const grapheme = gs.segment;
    const graphemeContainsCJK = isCJK(grapheme);
    if (unitParts.length === 0) {
      startUnit(grapheme, gs.index, graphemeContainsCJK);
      continue;
    }
    if (unitIsSingleKinsokuEnd || kinsokuStart.has(grapheme) || leftStickyPunctuation.has(grapheme) || engineProfile.carryCJKAfterClosingQuote && graphemeContainsCJK && unitEndsWithClosingQuote) {
      appendToUnit(grapheme, graphemeContainsCJK);
      continue;
    }
    if (!unitContainsCJK && !graphemeContainsCJK) {
      appendToUnit(grapheme, graphemeContainsCJK);
      continue;
    }
    pushUnit();
    startUnit(grapheme, gs.index, graphemeContainsCJK);
  }
  pushUnit();
  return units;
}
function mergeKeepAllTextUnits(units) {
  if (units.length <= 1)
    return units;
  const merged = [];
  let currentTextParts = [units[0].text];
  let currentStart = units[0].start;
  let currentContainsCJK = isCJK(units[0].text);
  let currentCanContinue = canContinueKeepAllTextRun(units[0].text);
  function flushCurrent() {
    merged.push({
      text: currentTextParts.length === 1 ? currentTextParts[0] : currentTextParts.join(""),
      start: currentStart
    });
  }
  for (let i6 = 1; i6 < units.length; i6++) {
    const next = units[i6];
    const nextContainsCJK = isCJK(next.text);
    const nextCanContinue = canContinueKeepAllTextRun(next.text);
    if (currentContainsCJK && currentCanContinue) {
      currentTextParts.push(next.text);
      currentContainsCJK = currentContainsCJK || nextContainsCJK;
      currentCanContinue = nextCanContinue;
      continue;
    }
    flushCurrent();
    currentTextParts = [next.text];
    currentStart = next.start;
    currentContainsCJK = nextContainsCJK;
    currentCanContinue = nextCanContinue;
  }
  flushCurrent();
  return merged;
}
function countRenderedSpacingGraphemes(text, kind) {
  if (kind === "zero-width-break" || kind === "soft-hyphen" || kind === "hard-break") {
    return 0;
  }
  if (kind === "tab")
    return 1;
  let count = 0;
  const graphemeSegmenter = getSharedGraphemeSegmenter2();
  for (const _2 of graphemeSegmenter.segment(text))
    count++;
  return count;
}
function addInternalLetterSpacing(width, graphemeCount, letterSpacing) {
  return graphemeCount > 1 ? width + (graphemeCount - 1) * letterSpacing : width;
}
function measureAnalysis(analysis, font, includeSegments, wordBreak, letterSpacing) {
  const engineProfile = getEngineProfile();
  const { cache, emojiCorrection } = getFontMeasurementState(font, textMayContainEmoji(analysis.normalized));
  const discretionaryHyphenWidth = getCorrectedSegmentWidth("-", getSegmentMetrics("-", cache), emojiCorrection) + (letterSpacing === 0 ? 0 : letterSpacing);
  const spaceWidth = getCorrectedSegmentWidth(" ", getSegmentMetrics(" ", cache), emojiCorrection);
  const tabStopAdvance = spaceWidth * 8;
  const hasLetterSpacing = letterSpacing !== 0;
  if (analysis.len === 0)
    return createEmptyPrepared(includeSegments);
  const widths = [];
  const lineEndFitAdvances = [];
  const lineEndPaintAdvances = [];
  const kinds = [];
  let simpleLineWalkFastPath = analysis.chunks.length <= 1 && !hasLetterSpacing;
  const segStarts = includeSegments ? [] : null;
  const breakableFitAdvances = [];
  const spacingGraphemeCounts = [];
  const segments = includeSegments ? [] : null;
  const preparedStartByAnalysisIndex = Array.from({ length: analysis.len });
  function pushMeasuredSegment(text, width, lineEndFitAdvance, lineEndPaintAdvance, kind, start, breakableFitAdvance, spacingGraphemeCount) {
    if (kind !== "text" && kind !== "space" && kind !== "zero-width-break") {
      simpleLineWalkFastPath = false;
    }
    widths.push(width);
    lineEndFitAdvances.push(lineEndFitAdvance);
    lineEndPaintAdvances.push(lineEndPaintAdvance);
    kinds.push(kind);
    segStarts?.push(start);
    breakableFitAdvances.push(breakableFitAdvance);
    if (hasLetterSpacing)
      spacingGraphemeCounts.push(spacingGraphemeCount);
    if (segments !== null)
      segments.push(text);
  }
  function pushMeasuredTextSegment(text, kind, start, wordLike, allowOverflowBreaks) {
    const textMetrics = getSegmentMetrics(text, cache);
    const spacingGraphemeCount = hasLetterSpacing ? countRenderedSpacingGraphemes(text, kind) : 0;
    const width = addInternalLetterSpacing(getCorrectedSegmentWidth(text, textMetrics, emojiCorrection), spacingGraphemeCount, letterSpacing);
    const baseLineEndFitAdvance = kind === "space" || kind === "preserved-space" || kind === "zero-width-break" ? 0 : width;
    const lineEndFitAdvance = baseLineEndFitAdvance === 0 ? 0 : baseLineEndFitAdvance + (spacingGraphemeCount > 0 ? letterSpacing : 0);
    const lineEndPaintAdvance = kind === "space" || kind === "zero-width-break" ? 0 : width;
    if (allowOverflowBreaks && wordLike && text.length > 1) {
      let fitMode = "sum-graphemes";
      if (letterSpacing !== 0) {
        fitMode = "segment-prefixes";
      } else if (isNumericRunSegment(text)) {
        fitMode = "pair-context";
      } else if (engineProfile.preferPrefixWidthsForBreakableRuns) {
        fitMode = "segment-prefixes";
      }
      const fitAdvances = getSegmentBreakableFitAdvances(text, textMetrics, cache, emojiCorrection, fitMode);
      pushMeasuredSegment(text, width, lineEndFitAdvance, lineEndPaintAdvance, kind, start, fitAdvances, spacingGraphemeCount);
      return;
    }
    pushMeasuredSegment(text, width, lineEndFitAdvance, lineEndPaintAdvance, kind, start, null, spacingGraphemeCount);
  }
  for (let mi = 0; mi < analysis.len; mi++) {
    preparedStartByAnalysisIndex[mi] = widths.length;
    const segText = analysis.texts[mi];
    const segWordLike = analysis.isWordLike[mi];
    const segKind = analysis.kinds[mi];
    const segStart = analysis.starts[mi];
    if (segKind === "soft-hyphen") {
      pushMeasuredSegment(segText, 0, discretionaryHyphenWidth, discretionaryHyphenWidth, segKind, segStart, null, 0);
      continue;
    }
    if (segKind === "hard-break") {
      pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null, 0);
      continue;
    }
    if (segKind === "tab") {
      pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null, hasLetterSpacing ? countRenderedSpacingGraphemes(segText, segKind) : 0);
      continue;
    }
    const segMetrics = getSegmentMetrics(segText, cache);
    if (segKind === "text" && segMetrics.containsCJK) {
      const baseUnits = buildBaseCjkUnits(segText, engineProfile);
      const measuredUnits = wordBreak === "keep-all" ? mergeKeepAllTextUnits(baseUnits) : baseUnits;
      for (let i6 = 0; i6 < measuredUnits.length; i6++) {
        const unit = measuredUnits[i6];
        pushMeasuredTextSegment(unit.text, "text", segStart + unit.start, segWordLike, wordBreak === "keep-all" || !isCJK(unit.text));
      }
      continue;
    }
    pushMeasuredTextSegment(segText, segKind, segStart, segWordLike, true);
  }
  const chunks = mapAnalysisChunksToPreparedChunks(analysis.chunks, preparedStartByAnalysisIndex, widths.length);
  const segLevels = segStarts === null ? null : computeSegmentLevels(analysis.normalized, segStarts);
  if (segments !== null) {
    return {
      widths,
      lineEndFitAdvances,
      lineEndPaintAdvances,
      kinds,
      simpleLineWalkFastPath,
      segLevels,
      breakableFitAdvances,
      letterSpacing,
      spacingGraphemeCounts,
      discretionaryHyphenWidth,
      tabStopAdvance,
      chunks,
      segments
    };
  }
  return {
    widths,
    lineEndFitAdvances,
    lineEndPaintAdvances,
    kinds,
    simpleLineWalkFastPath,
    segLevels,
    breakableFitAdvances,
    letterSpacing,
    spacingGraphemeCounts,
    discretionaryHyphenWidth,
    tabStopAdvance,
    chunks
  };
}
function mapAnalysisChunksToPreparedChunks(chunks, preparedStartByAnalysisIndex, preparedEndSegmentIndex) {
  const preparedChunks = [];
  for (let i6 = 0; i6 < chunks.length; i6++) {
    const chunk = chunks[i6];
    const startSegmentIndex = chunk.startSegmentIndex < preparedStartByAnalysisIndex.length ? preparedStartByAnalysisIndex[chunk.startSegmentIndex] : preparedEndSegmentIndex;
    const endSegmentIndex = chunk.endSegmentIndex < preparedStartByAnalysisIndex.length ? preparedStartByAnalysisIndex[chunk.endSegmentIndex] : preparedEndSegmentIndex;
    const consumedEndSegmentIndex = chunk.consumedEndSegmentIndex < preparedStartByAnalysisIndex.length ? preparedStartByAnalysisIndex[chunk.consumedEndSegmentIndex] : preparedEndSegmentIndex;
    preparedChunks.push({
      startSegmentIndex,
      endSegmentIndex,
      consumedEndSegmentIndex
    });
  }
  return preparedChunks;
}
function prepareInternal(text, font, includeSegments, options) {
  const wordBreak = options?.wordBreak ?? "normal";
  const letterSpacing = options?.letterSpacing ?? 0;
  const analysis = analyzeText(text, getEngineProfile(), options?.whiteSpace, wordBreak);
  return measureAnalysis(analysis, font, includeSegments, wordBreak, letterSpacing);
}
function prepareWithSegments(text, font, options) {
  return prepareInternal(text, font, true, options);
}
function getInternalPrepared(prepared) {
  return prepared;
}
function measureNaturalWidth(prepared) {
  let maxWidth = 0;
  walkPreparedLinesRaw(getInternalPrepared(prepared), Number.POSITIVE_INFINITY, (width) => {
    if (width > maxWidth)
      maxWidth = width;
  });
  return maxWidth;
}

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
  var rawStylePairs = Array.isArray(safePayload.stylePairs) ? safePayload.stylePairs : [];
  normalized.stylePairs = [0, 1, 2, 3, 4].map(function(index) {
    var safePair = asObject(rawStylePairs[index]);
    return {
      origin: blankFallback(safePair.origin),
      note: normalizeHandwrittenText(safePair.note)
    };
  });
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
function pxFromComputedLength(value) {
  var parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function computedCanvasFont(style) {
  var fontStyle = style.fontStyle && style.fontStyle !== "normal" ? style.fontStyle + " " : "";
  var fontVariant = style.fontVariant && style.fontVariant !== "normal" ? style.fontVariant + " " : "";
  var fontWeight = style.fontWeight && style.fontWeight !== "normal" ? style.fontWeight + " " : "";
  return fontStyle + fontVariant + fontWeight + style.fontSize + " " + style.fontFamily;
}
function syncMeasuredMobileTabSymbol(host, model) {
  var symbolNode = host.querySelector(".icono-label-mobile-peek-tab-symbol");
  if (!symbolNode || !model || !model.symbol) return;
  var style = getComputedStyle(symbolNode);
  try {
    var measured = measureNaturalWidth(
      prepareWithSegments(String(model.symbol), computedCanvasFont(style), {
        letterSpacing: pxFromComputedLength(style.letterSpacing)
      })
    );
    host.style.setProperty("--icono-label-mobile-tab-symbol-measured-width", Math.ceil(measured) + "px");
  } catch (error) {
    console.warn("[Iconoplasm] Pretext mobile tab measurement failed:", error);
  }
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
  var sheetVoteHtml = model.voteHtml;
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
    <div
      role="button"
      tabindex="0"
      class="icono-label-mobile-peek-toggle"
      data-icono-label-mobile-toggle
      aria-expanded="false"
    >
      <span class="icono-label-mobile-peek-tab" aria-hidden="true">
        <span class="icono-label-mobile-peek-tab-symbol">${model.symbol}</span>
      </span>
      <span class="icono-label-mobile-peek-topline">
        <span class="icono-label-mobile-peek-kicker">full name</span>
      </span>
      <span class="icono-label-mobile-peek-summary">
        <span class="icono-label-mobile-peek-name">${model.fullName}</span>
      </span>
      <span class="icono-label-mobile-peek-swipe">${voteShellTemplate(model.voteHtml)}</span>
    </div>
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
    syncMeasuredMobileTabSymbol(this, this._model);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => syncMeasuredMobileTabSymbol(this, this._model));
    }
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
